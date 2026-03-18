/**
 * Memory System with RAG and GraphRAG support
 * Provides vector retrieval and graph knowledge management with production backends
 */

import { v4 as uuidv4 } from 'uuid';
import { Pool } from 'pg';
import { Pinecone } from '@pinecone-database/pinecone';
import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';
import neo4j, { Driver } from 'neo4j-driver';
import OpenAI from 'openai';
import { MemoryEntry, GraphEntity, GraphRelationship, SystemConfig } from '../types';

/**
 * Vector store interface for RAG
 */
export interface VectorStore {
  add(id: string, content: string, metadata: Record<string, any>): Promise<void>;
  search(query: string, topK: number): Promise<MemoryEntry[]>;
  delete(id: string): Promise<void>;
}

/**
 * Graph database interface for GraphRAG
 */
export interface GraphDatabase {
  createEntity(type: string, properties: Record<string, any>): Promise<GraphEntity>;
  createRelationship(
    type: string,
    fromEntityId: string,
    toEntityId: string,
    properties: Record<string, any>
  ): Promise<GraphRelationship>;
  queryEntities(cypherOrFilter: string): Promise<GraphEntity[]>;
  queryRelationships(cypherOrFilter: string): Promise<GraphRelationship[]>;
  getNeighbors(entityId: string, depth: number): Promise<GraphEntity[]>;
  close?(): Promise<void>;
}

interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export interface ConversationTurn {
  id: string;
  conversationId: string;
  userId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, any>;
  createdAt: Date;
}

interface ConversationTurnInput {
  conversationId: string;
  userId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, any>;
}

const conversationPoolCache = new Map<string, Pool>();

function getConversationPool(connectionString: string): Pool {
  const existing = conversationPoolCache.get(connectionString);
  if (existing) {
    return existing;
  }

  const pool = new Pool({ connectionString });
  conversationPoolCache.set(connectionString, pool);
  return pool;
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'text-embedding-3-small') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });

    return response.data[0].embedding;
  }
}

/**
 * In-memory vector store implementation (fallback only)
 */
export class InMemoryVectorStore implements VectorStore {
  private entries: Map<string, MemoryEntry>;

  constructor() {
    this.entries = new Map();
  }

  async add(id: string, content: string, metadata: Record<string, any>): Promise<void> {
    const entry: MemoryEntry = {
      id,
      content,
      metadata,
      timestamp: new Date(),
      embedding: this.mockEmbedding(content),
    };
    this.entries.set(id, entry);
  }

  async search(query: string, topK: number = 5): Promise<MemoryEntry[]> {
    const queryEmbedding = this.mockEmbedding(query);

    return Array.from(this.entries.values())
      .map((entry) => ({
        entry,
        score: this.cosineSimilarity(queryEmbedding, entry.embedding || []),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((r) => r.entry);
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  private mockEmbedding(text: string): number[] {
    const embedding = new Array(384).fill(0);
    for (let i = 0; i < text.length && i < 384; i++) {
      embedding[i] = text.charCodeAt(i) / 255;
    }
    return embedding;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0 || a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

interface PineconeVectorStoreConfig {
  apiKey: string;
  indexName: string;
  namespace?: string;
  topK?: number;
  embeddingProvider: EmbeddingProvider;
}

export class PineconeVectorStore implements VectorStore {
  private index: any;
  private namespace?: string;
  private topK: number;
  private embeddingProvider: EmbeddingProvider;

  constructor(config: PineconeVectorStoreConfig) {
    const pinecone = new Pinecone({ apiKey: config.apiKey });
    this.index = pinecone.index(config.indexName);
    this.namespace = config.namespace;
    this.topK = config.topK || 5;
    this.embeddingProvider = config.embeddingProvider;
  }

  async add(id: string, content: string, metadata: Record<string, any>): Promise<void> {
    const vector = await this.embeddingProvider.embed(content);
    const target = this.targetIndex();

    await target.upsert([
      {
        id,
        values: vector,
        metadata: this.serializeMetadata({
          ...metadata,
          content,
          timestamp: new Date().toISOString(),
        }),
      },
    ]);
  }

  async search(query: string, topK?: number): Promise<MemoryEntry[]> {
    const vector = await this.embeddingProvider.embed(query);
    const target = this.targetIndex();

    const results = await target.query({
      vector,
      topK: topK || this.topK,
      includeMetadata: true,
    });

    return (results.matches || []).map((match: any) => {
      const metadata = this.deserializeMetadata(match.metadata || {});
      const content = typeof metadata.content === 'string' ? metadata.content : '';
      const timestampValue = metadata.timestamp;

      delete metadata.content;
      delete metadata.timestamp;

      return {
        id: String(match.id),
        content,
        metadata,
        timestamp: timestampValue ? new Date(String(timestampValue)) : new Date(),
      };
    });
  }

  async delete(id: string): Promise<void> {
    const target = this.targetIndex();
    await target.deleteOne(id);
  }

  private targetIndex(): any {
    if (this.namespace) {
      return this.index.namespace(this.namespace);
    }
    return this.index;
  }

  private serializeMetadata(metadata: Record<string, any>): Record<string, string | number | boolean> {
    const serialized: Record<string, string | number | boolean> = {};

    for (const [key, value] of Object.entries(metadata)) {
      if (value === null || value === undefined) {
        continue;
      }

      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        serialized[key] = value;
      } else {
        serialized[key] = JSON.stringify(value);
      }
    }

    return serialized;
  }

  private deserializeMetadata(metadata: Record<string, any>): Record<string, any> {
    const deserialized: Record<string, any> = {};

    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value !== 'string') {
        deserialized[key] = value;
        continue;
      }

      try {
        deserialized[key] = JSON.parse(value);
      } catch {
        deserialized[key] = value;
      }
    }

    return deserialized;
  }
}

interface MilvusVectorStoreConfig {
  address: string;
  collectionName: string;
  dimension: number;
  topK?: number;
  metricType?: 'COSINE' | 'L2' | 'IP';
  username?: string;
  password?: string;
  embeddingProvider: EmbeddingProvider;
}

export class MilvusVectorStore implements VectorStore {
  private client: any;
  private collectionName: string;
  private topK: number;
  private metricType: 'COSINE' | 'L2' | 'IP';
  private embeddingProvider: EmbeddingProvider;
  private initPromise: Promise<void>;

  constructor(config: MilvusVectorStoreConfig) {
    this.client = new MilvusClient({
      address: config.address,
      username: config.username,
      password: config.password,
    });

    this.collectionName = config.collectionName;
    this.topK = config.topK || 5;
    this.metricType = config.metricType || 'COSINE';
    this.embeddingProvider = config.embeddingProvider;
    this.initPromise = this.ensureCollection(config.dimension);
  }

  async add(id: string, content: string, metadata: Record<string, any>): Promise<void> {
    await this.initPromise;

    const vector = await this.embeddingProvider.embed(content);

    await this.client.insert({
      collection_name: this.collectionName,
      data: [
        {
          id,
          embedding: vector,
          content,
          metadata_json: JSON.stringify(metadata),
          timestamp: Date.now(),
        },
      ],
    });

    await this.client.flushSync({ collection_names: [this.collectionName] });
  }

  async search(query: string, topK?: number): Promise<MemoryEntry[]> {
    await this.initPromise;

    const vector = await this.embeddingProvider.embed(query);

    const searchResult = await this.client.search({
      collection_name: this.collectionName,
      vector: [vector],
      anns_field: 'embedding',
      limit: topK || this.topK,
      metric_type: this.metricType,
      output_fields: ['id', 'content', 'metadata_json', 'timestamp'],
      params: JSON.stringify({ nprobe: 16 }),
    });

    const rows = (searchResult?.results || []) as any[];

    return rows.map((row) => {
      const entity = row.entity || row;
      const metadataText = entity.metadata_json || '{}';

      return {
        id: String(entity.id),
        content: String(entity.content || ''),
        metadata: JSON.parse(String(metadataText)),
        timestamp: new Date(Number(entity.timestamp || Date.now())),
      };
    });
  }

  async delete(id: string): Promise<void> {
    await this.initPromise;

    await this.client.deleteEntities({
      collection_name: this.collectionName,
      expr: `id in ["${id}"]`,
    });
  }

  private async ensureCollection(dimension: number): Promise<void> {
    const existsResult = await this.client.hasCollection({
      collection_name: this.collectionName,
    });

    const exists = Boolean(
      existsResult?.value || existsResult?.has_collection || existsResult?.hasCollection
    );

    if (!exists) {
      await this.client.createCollection({
        collection_name: this.collectionName,
        fields: [
          {
            name: 'id',
            data_type: DataType.VarChar,
            is_primary_key: true,
            max_length: 128,
          },
          {
            name: 'embedding',
            data_type: DataType.FloatVector,
            dim: dimension,
          },
          {
            name: 'content',
            data_type: DataType.VarChar,
            max_length: 65535,
          },
          {
            name: 'metadata_json',
            data_type: DataType.VarChar,
            max_length: 65535,
          },
          {
            name: 'timestamp',
            data_type: DataType.Int64,
          },
        ],
      });

      await this.client.createIndex({
        collection_name: this.collectionName,
        field_name: 'embedding',
        index_type: 'AUTOINDEX',
        metric_type: this.metricType,
      });
    }

    await this.client.loadCollectionSync({
      collection_name: this.collectionName,
    });
  }
}

/**
 * In-memory graph database implementation (fallback only)
 */
export class InMemoryGraphDatabase implements GraphDatabase {
  private entities: Map<string, GraphEntity>;
  private relationships: Map<string, GraphRelationship>;

  constructor() {
    this.entities = new Map();
    this.relationships = new Map();
  }

  async createEntity(type: string, properties: Record<string, any>): Promise<GraphEntity> {
    const entity: GraphEntity = {
      id: uuidv4(),
      type,
      properties,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.entities.set(entity.id, entity);
    return entity;
  }

  async createRelationship(
    type: string,
    fromEntityId: string,
    toEntityId: string,
    properties: Record<string, any> = {}
  ): Promise<GraphRelationship> {
    if (!this.entities.has(fromEntityId) || !this.entities.has(toEntityId)) {
      throw new Error('Both entities must exist');
    }

    const relationship: GraphRelationship = {
      id: uuidv4(),
      type,
      fromEntityId,
      toEntityId,
      properties,
      createdAt: new Date(),
    };
    this.relationships.set(relationship.id, relationship);
    return relationship;
  }

  async queryEntities(filter: string): Promise<GraphEntity[]> {
    return Array.from(this.entities.values()).filter((entity) =>
      JSON.stringify(entity).toLowerCase().includes(filter.toLowerCase())
    );
  }

  async queryRelationships(filter: string): Promise<GraphRelationship[]> {
    return Array.from(this.relationships.values()).filter((rel) =>
      JSON.stringify(rel).toLowerCase().includes(filter.toLowerCase())
    );
  }

  async getNeighbors(entityId: string, depth: number = 1): Promise<GraphEntity[]> {
    const visited = new Set<string>();
    const neighbors: GraphEntity[] = [];

    const explore = async (id: string, currentDepth: number): Promise<void> => {
      if (currentDepth > depth || visited.has(id)) {
        return;
      }
      visited.add(id);

      const outgoing = Array.from(this.relationships.values()).filter(
        (r) => r.fromEntityId === id
      );
      const incoming = Array.from(this.relationships.values()).filter((r) => r.toEntityId === id);

      for (const rel of [...outgoing, ...incoming]) {
        const neighborId = rel.fromEntityId === id ? rel.toEntityId : rel.fromEntityId;
        const neighbor = this.entities.get(neighborId);
        if (neighbor && !visited.has(neighborId)) {
          neighbors.push(neighbor);
          await explore(neighborId, currentDepth + 1);
        }
      }
    };

    await explore(entityId, 0);
    return neighbors;
  }
}

interface Neo4jGraphDatabaseConfig {
  uri: string;
  user: string;
  password: string;
  database?: string;
}

export class Neo4jGraphDatabase implements GraphDatabase {
  private driver: Driver;
  private database?: string;

  constructor(config: Neo4jGraphDatabaseConfig) {
    this.driver = neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password));
    this.database = config.database;
  }

  async createEntity(type: string, properties: Record<string, any>): Promise<GraphEntity> {
    const session = this.session();
    const id = uuidv4();
    const now = new Date().toISOString();

    try {
      const result = await session.run(
        `
        CREATE (e:Entity {
          id: $id,
          type: $type,
          properties: $properties,
          createdAt: $createdAt,
          updatedAt: $updatedAt
        })
        RETURN e
        `,
        {
          id,
          type,
          properties,
          createdAt: now,
          updatedAt: now,
        }
      );

      const node = result.records[0].get('e');
      return this.mapEntity(node);
    } finally {
      await session.close();
    }
  }

  async createRelationship(
    type: string,
    fromEntityId: string,
    toEntityId: string,
    properties: Record<string, any> = {}
  ): Promise<GraphRelationship> {
    const session = this.session();
    const id = uuidv4();
    const now = new Date().toISOString();

    try {
      const result = await session.run(
        `
        MATCH (source:Entity {id: $fromEntityId})
        MATCH (target:Entity {id: $toEntityId})
        CREATE (source)-[r:RELATES_TO {
          id: $id,
          type: $type,
          properties: $properties,
          createdAt: $createdAt
        }]->(target)
        RETURN r
        `,
        {
          fromEntityId,
          toEntityId,
          id,
          type,
          properties,
          createdAt: now,
        }
      );

      const relationship = result.records[0].get('r');
      return this.mapRelationship(relationship, fromEntityId, toEntityId);
    } finally {
      await session.close();
    }
  }

  async queryEntities(cypherOrFilter: string): Promise<GraphEntity[]> {
    const session = this.session();

    try {
      if (this.isCypher(cypherOrFilter)) {
        const result = await session.run(cypherOrFilter);
        return result.records
          .map((record: any) => record.get(0))
          .filter((value: any) => value?.labels?.includes('Entity'))
          .map((node: any) => this.mapEntity(node));
      }

      const result = await session.run(
        `
        MATCH (e:Entity)
        WHERE toLower(e.id) CONTAINS toLower($filter)
           OR toLower(e.type) CONTAINS toLower($filter)
           OR toLower(toString(e.properties)) CONTAINS toLower($filter)
        RETURN e
        LIMIT 50
        `,
        { filter: cypherOrFilter }
      );

      return result.records.map((record: any) => this.mapEntity(record.get('e')));
    } finally {
      await session.close();
    }
  }

  async queryRelationships(cypherOrFilter: string): Promise<GraphRelationship[]> {
    const session = this.session();

    try {
      if (this.isCypher(cypherOrFilter)) {
        const result = await session.run(cypherOrFilter);
        return result.records
          .map((record: any) => record.get(0))
          .filter((value: any) => value?.type === 'RELATES_TO')
          .map((rel: any) =>
            this.mapRelationship(
              rel,
              String(rel.start),
              String(rel.end)
            )
          );
      }

      const result = await session.run(
        `
        MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity)
        WHERE toLower(r.id) CONTAINS toLower($filter)
           OR toLower(r.type) CONTAINS toLower($filter)
           OR toLower(toString(r.properties)) CONTAINS toLower($filter)
           OR toLower(source.id) CONTAINS toLower($filter)
           OR toLower(target.id) CONTAINS toLower($filter)
        RETURN source.id AS sourceId, target.id AS targetId, r
        LIMIT 100
        `,
        { filter: cypherOrFilter }
      );

      return result.records.map((record: any) =>
        this.mapRelationship(record.get('r'), String(record.get('sourceId')), String(record.get('targetId')))
      );
    } finally {
      await session.close();
    }
  }

  async getNeighbors(entityId: string, depth: number = 1): Promise<GraphEntity[]> {
    const safeDepth = Math.max(1, Math.min(5, Math.floor(depth)));
    const session = this.session();

    try {
      const result = await session.run(
        `
        MATCH (source:Entity {id: $entityId})-[*1..${safeDepth}]-(neighbor:Entity)
        RETURN DISTINCT neighbor
        `,
        { entityId }
      );

      return result.records.map((record: any) => this.mapEntity(record.get('neighbor')));
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  private session(): any {
    if (this.database) {
      return this.driver.session({ database: this.database });
    }
    return this.driver.session();
  }

  private mapEntity(node: any): GraphEntity {
    const props = node.properties || {};

    return {
      id: String(props.id),
      type: String(props.type),
      properties: this.normalizeObject(props.properties),
      createdAt: new Date(String(props.createdAt)),
      updatedAt: new Date(String(props.updatedAt)),
    };
  }

  private mapRelationship(rel: any, fromEntityId: string, toEntityId: string): GraphRelationship {
    const props = rel.properties || {};

    return {
      id: String(props.id),
      type: String(props.type),
      fromEntityId,
      toEntityId,
      properties: this.normalizeObject(props.properties),
      createdAt: new Date(String(props.createdAt)),
    };
  }

  private normalizeObject(value: any): Record<string, any> {
    if (!value) {
      return {};
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return { value };
      }
    }

    return value;
  }

  private isCypher(query: string): boolean {
    const normalized = query.trim().toLowerCase();
    return normalized.startsWith('match') || normalized.startsWith('call');
  }
}

/**
 * Unified Memory System combining RAG and GraphRAG
 */
export class MemorySystem {
  private vectorStore: VectorStore;
  private graphDB: GraphDatabase;
  private databaseUrl?: string;
  private conversationCache: Map<string, ConversationTurn[]>;

  constructor(vectorStore?: VectorStore, graphDB?: GraphDatabase, databaseUrl?: string) {
    this.vectorStore = vectorStore || new InMemoryVectorStore();
    this.graphDB = graphDB || new InMemoryGraphDatabase();
    this.databaseUrl = databaseUrl;
    this.conversationCache = new Map();
  }

  /**
   * Store information in both vector and graph stores
   */
  async store(
    content: string,
    metadata: {
      entityType?: string;
      entityProperties?: Record<string, any>;
      relationships?: Array<{
        type: string;
        targetEntityId: string;
        properties?: Record<string, any>;
      }>;
    } & Record<string, any>
  ): Promise<{ memoryId: string; entityId?: string }> {
    const memoryId = uuidv4();

    // Store in vector store for semantic search
    await this.vectorStore.add(memoryId, content, metadata);

    // If entity type provided, store in graph database
    let entityId: string | undefined;
    if (metadata.entityType && metadata.entityProperties) {
      const entity = await this.graphDB.createEntity(
        metadata.entityType,
        metadata.entityProperties
      );
      entityId = entity.id;

      // Create relationships if provided
      if (metadata.relationships) {
        for (const rel of metadata.relationships) {
          await this.graphDB.createRelationship(
            rel.type,
            entity.id,
            rel.targetEntityId,
            rel.properties || {}
          );
        }
      }
    }

    return { memoryId, entityId };
  }

  /**
   * Store a conversation turn for later retrieval by conversationId.
   */
  async storeConversationTurn(turn: ConversationTurnInput): Promise<string> {
    const id = uuidv4();
    const entry: ConversationTurn = {
      id,
      conversationId: turn.conversationId,
      userId: turn.userId,
      role: turn.role,
      content: turn.content,
      metadata: turn.metadata || {},
      createdAt: new Date(),
    };

    const cachedTurns = this.conversationCache.get(turn.conversationId) || [];
    cachedTurns.push(entry);
    this.conversationCache.set(turn.conversationId, cachedTurns.slice(-50));

    if (!this.databaseUrl) {
      return id;
    }

    try {
      const pool = getConversationPool(this.databaseUrl);
      await pool.query(
        `INSERT INTO conversation_history (id, conversation_id, user_id, role, content, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          turn.conversationId,
          turn.userId || null,
          turn.role,
          turn.content,
          JSON.stringify(turn.metadata || {}),
          entry.createdAt,
        ]
      );
    } catch (error) {
      console.warn('Failed to persist conversation turn:', error);
    }

    return id;
  }

  /**
   * Retrieve recent conversation turns for a conversation.
   */
  async getConversationHistory(conversationId: string, limit: number = 10): Promise<ConversationTurn[]> {
    const cachedTurns = this.conversationCache.get(conversationId);
    if (cachedTurns && cachedTurns.length > 0) {
      return cachedTurns.slice(-limit);
    }

    if (!this.databaseUrl) {
      return [];
    }

    let history: ConversationTurn[] = [];
    try {
      const pool = getConversationPool(this.databaseUrl);
      const result = await pool.query(
        `SELECT * FROM conversation_history
         WHERE conversation_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [conversationId, limit]
      );

      history = result.rows.map((row: any) => this.mapConversationTurn(row)).reverse();
    } catch (error) {
      console.warn('Failed to load conversation history:', error);
      return cachedTurns ? cachedTurns.slice(-limit) : [];
    }

    this.conversationCache.set(conversationId, history.slice(-50));
    return history;
  }

  /**
   * Retrieve relevant memories using semantic search
   */
  async retrieve(query: string, topK: number = 5): Promise<MemoryEntry[]> {
    return this.vectorStore.search(query, topK);
  }

  /**
   * Query knowledge graph for structured information
   */
  async queryGraph(entityId: string, depth: number = 1): Promise<{
    entity: GraphEntity;
    neighbors: GraphEntity[];
    relationships: GraphRelationship[];
  }> {
    const neighbors = await this.graphDB.getNeighbors(entityId, depth);

    // Get relationships involving this entity
    const allRelationships = await this.graphDB.queryRelationships(entityId);

    // Get the entity itself
    const entities = await this.graphDB.queryEntities(entityId);
    const entity = entities[0];

    return {
      entity,
      neighbors,
      relationships: allRelationships,
    };
  }

  /**
   * Hybrid search: combine semantic and graph-based retrieval
   */
  async hybridSearch(query: string, options: { topK?: number; graphDepth?: number } = {}): Promise<{
    semanticResults: MemoryEntry[];
    graphResults: GraphEntity[];
  }> {
    const topK = options.topK || 5;
    const graphDepth = options.graphDepth || 1;

    // Semantic search
    const semanticResults = await this.retrieve(query, topK);

    // Extract entity IDs from semantic results
    const entityIds = semanticResults
      .map((r) => r.metadata.entityId)
      .filter((id) => id !== undefined);

    // Graph expansion
    const graphResults: GraphEntity[] = [];
    for (const entityId of entityIds) {
      const neighbors = await this.graphDB.getNeighbors(entityId as string, graphDepth);
      graphResults.push(...neighbors);
    }

    return {
      semanticResults,
      graphResults,
    };
  }

  /**
   * Store organizational context (employees, departments, etc.)
   */
  async storeOrganizationalContext(
    type: 'employee' | 'department' | 'project' | 'policy',
    data: Record<string, any>
  ): Promise<string> {
    const entity = await this.graphDB.createEntity(type, data);

    // Also store in vector store for semantic search
    const content = JSON.stringify(data);
    await this.vectorStore.add(entity.id, content, { entityType: type, entityId: entity.id });

    return entity.id;
  }

  /**
   * Create relationship between entities (e.g., employee works in department)
   */
  async createRelationship(
    fromEntityId: string,
    toEntityId: string,
    relationshipType: string,
    properties: Record<string, any> = {}
  ): Promise<GraphRelationship> {
    return this.graphDB.createRelationship(relationshipType, fromEntityId, toEntityId, properties);
  }

  /**
   * Get context relevant to a user's current task
   */
  async getRelevantContext(
    userId: string,
    taskDescription: string,
    conversationId?: string
  ): Promise<{
    userInfo: GraphEntity | null;
    relatedEntities: GraphEntity[];
    relevantMemories: MemoryEntry[];
    conversationHistory: ConversationTurn[];
  }> {
    // Get user entity
    const userEntities = await this.graphDB.queryEntities(userId);
    const userInfo = userEntities[0] || null;

    // Get related entities (colleagues, department, etc.)
    let relatedEntities: GraphEntity[] = [];
    if (userInfo) {
      relatedEntities = await this.graphDB.getNeighbors(userInfo.id, 2);
    }

    // Get relevant memories based on task
    const relevantMemories = await this.retrieve(taskDescription, 5);
    const conversationHistory = conversationId
      ? await this.getConversationHistory(conversationId, 10)
      : [];

    return {
      userInfo,
      relatedEntities,
      relevantMemories,
      conversationHistory,
    };
  }

  private mapConversationTurn(row: any): ConversationTurn {
    return {
      id: String(row.id),
      conversationId: String(row.conversation_id),
      userId: row.user_id ? String(row.user_id) : undefined,
      role: row.role,
      content: String(row.content || ''),
      metadata: this.normalizeMetadata(row.metadata),
      createdAt: new Date(row.created_at),
    };
  }

  private normalizeMetadata(value: any): Record<string, any> {
    if (!value) {
      return {};
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return { value };
      }
    }

    return value;
  }

  async close(): Promise<void> {
    if (this.graphDB.close) {
      await this.graphDB.close();
    }
  }
}

/**
 * Build production-ready memory system from system configuration.
 */
export function createMemorySystemFromConfig(config: SystemConfig): MemorySystem {
  const vectorConfig = config.vectorStore;
  const embeddingApiKey =
    vectorConfig?.apiKey || config.llm.apiKey || process.env.OPENAI_API_KEY;

  let embeddingProvider: EmbeddingProvider | undefined;
  if (embeddingApiKey) {
    embeddingProvider = new OpenAIEmbeddingProvider(
      embeddingApiKey,
      vectorConfig?.embeddingModel || 'text-embedding-3-small'
    );
  }

  let vectorStore: VectorStore = new InMemoryVectorStore();

  if (vectorConfig?.provider === 'pinecone') {
    const apiKey = vectorConfig.config.apiKey || process.env.PINECONE_API_KEY;
    const indexName = vectorConfig.config.indexName || process.env.PINECONE_INDEX;

    if (apiKey && indexName && embeddingProvider) {
      vectorStore = new PineconeVectorStore({
        apiKey,
        indexName,
        namespace: vectorConfig.config.namespace,
        topK: vectorConfig.config.topK,
        embeddingProvider,
      });
    } else {
      console.warn('Pinecone not fully configured. Falling back to in-memory vector store.');
    }
  } else if (vectorConfig?.provider === 'milvus') {
    const address = vectorConfig.config.address || process.env.MILVUS_ADDRESS;
    const collectionName =
      vectorConfig.config.collectionName || process.env.MILVUS_COLLECTION || 'intentos_memory';

    if (address && embeddingProvider) {
      vectorStore = new MilvusVectorStore({
        address,
        collectionName,
        dimension: vectorConfig.config.dimension || 1536,
        topK: vectorConfig.config.topK,
        metricType: vectorConfig.config.metricType,
        username: vectorConfig.config.username || process.env.MILVUS_USERNAME,
        password: vectorConfig.config.password || process.env.MILVUS_PASSWORD,
        embeddingProvider,
      });
    } else {
      console.warn('Milvus not fully configured. Falling back to in-memory vector store.');
    }
  }

  let graphDB: GraphDatabase = new InMemoryGraphDatabase();
  if (config.graphDB?.uri && config.graphDB.user && config.graphDB.password) {
    graphDB = new Neo4jGraphDatabase({
      uri: config.graphDB.uri,
      user: config.graphDB.user,
      password: config.graphDB.password,
      database: config.graphDB.database,
    });
  }

  return new MemorySystem(vectorStore, graphDB, config.database.url);
}
