/**
 * Memory System with RAG and GraphRAG support
 * Provides both vector-based retrieval and graph-based knowledge management
 */

import { v4 as uuidv4 } from 'uuid';
import { MemoryEntry, GraphEntity, GraphRelationship } from '../types';

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
  queryEntities(cypher: string): Promise<GraphEntity[]>;
  queryRelationships(cypher: string): Promise<GraphRelationship[]>;
  getNeighbors(entityId: string, depth: number): Promise<GraphEntity[]>;
}

/**
 * In-memory vector store implementation (for development)
 * In production, use Pinecone, Milvus, or similar
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
      embedding: this.mockEmbedding(content), // In production, use actual embedding model
    };
    this.entries.set(id, entry);
  }

  async search(query: string, topK: number = 5): Promise<MemoryEntry[]> {
    const queryEmbedding = this.mockEmbedding(query);

    // Calculate similarity scores
    const results = Array.from(this.entries.values())
      .map((entry) => ({
        entry,
        score: this.cosineSimilarity(queryEmbedding, entry.embedding!),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((r) => r.entry);

    return results;
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  private mockEmbedding(text: string): number[] {
    // Mock embedding - in production use OpenAI, Cohere, etc.
    const embedding = new Array(384).fill(0);
    for (let i = 0; i < text.length && i < 384; i++) {
      embedding[i] = text.charCodeAt(i) / 255;
    }
    return embedding;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
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

/**
 * In-memory graph database implementation (for development)
 * In production, use Neo4j or similar
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
    // Simplified query - in production use Cypher with Neo4j
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

    const explore = async (id: string, currentDepth: number) => {
      if (currentDepth > depth || visited.has(id)) return;
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

/**
 * Unified Memory System combining RAG and GraphRAG
 */
export class MemorySystem {
  private vectorStore: VectorStore;
  private graphDB: GraphDatabase;

  constructor(vectorStore?: VectorStore, graphDB?: GraphDatabase) {
    this.vectorStore = vectorStore || new InMemoryVectorStore();
    this.graphDB = graphDB || new InMemoryGraphDatabase();
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
    taskDescription: string
  ): Promise<{
    userInfo: GraphEntity | null;
    relatedEntities: GraphEntity[];
    relevantMemories: MemoryEntry[];
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

    return {
      userInfo,
      relatedEntities,
      relevantMemories,
    };
  }
}
