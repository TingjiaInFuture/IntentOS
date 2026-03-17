/**
 * IntentOS - AI-Native Enterprise Workflow Engine
 * Main entry point and example usage
 */

export * from './types';
export * from './agents/base-agent';
export * from './agents/hr-agent';
export * from './agents/finance-agent';
export * from './agents/legal-agent';
export * from './intent/extractor';
export * from './workflow/state-machine';
export * from './memory/memory-system';
export * from './approval/approval-system';
export * from './security/security-manager';
export * from './tools/tool-registry';
export * from './orchestrator/intentos';

import { IntentOS } from './orchestrator/intentos';
import { SystemConfig, UserRole } from './types';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Create and configure IntentOS instance
 */
export function createIntentOS(config?: Partial<SystemConfig>): IntentOS {
  const defaultConfig: SystemConfig = {
    llm: {
      provider: 'openai',
      model: process.env.LLM_MODEL || 'gpt-4',
      temperature: 0.7,
      maxTokens: 4000,
      apiKey: process.env.OPENAI_API_KEY,
    },
    database: {
      url: process.env.DATABASE_URL || 'postgresql://localhost:5432/intentos',
    },
    vectorStore: {
      provider: (process.env.VECTOR_STORE_PROVIDER as 'pinecone' | 'milvus') || 'pinecone',
      config: {
        topK: Number(process.env.VECTOR_TOP_K || 5),
        dimension: Number(process.env.EMBEDDING_DIMENSION || 1536),
        namespace: process.env.PINECONE_NAMESPACE || 'intentos',
        apiKey: process.env.PINECONE_API_KEY,
        indexName: process.env.PINECONE_INDEX,
        address: process.env.MILVUS_ADDRESS,
        username: process.env.MILVUS_USERNAME,
        password: process.env.MILVUS_PASSWORD,
        collectionName: process.env.MILVUS_COLLECTION || 'intentos_memory',
        metricType: (process.env.MILVUS_METRIC_TYPE as 'COSINE' | 'L2' | 'IP') || 'COSINE',
      },
      embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      apiKey: process.env.OPENAI_API_KEY,
    },
    graphDB: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      user: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD || 'password',
      database: process.env.NEO4J_DATABASE || 'neo4j',
    },
    integrations: {
      database: {
        connectionString: process.env.DATABASE_URL,
      },
      email: {
        endpoint: process.env.EMAIL_API_ENDPOINT,
        apiKey: process.env.EMAIL_API_KEY,
        from: process.env.EMAIL_FROM,
      },
      document: {
        endpoint: process.env.DOC_API_ENDPOINT,
        apiKey: process.env.DOC_API_KEY,
      },
      calendar: {
        endpoint: process.env.CALENDAR_API_ENDPOINT,
        apiKey: process.env.CALENDAR_API_KEY,
      },
      slack: {
        botToken: process.env.SLACK_BOT_TOKEN,
      },
      salesforce: {
        instanceUrl: process.env.SALESFORCE_INSTANCE_URL,
        accessToken: process.env.SALESFORCE_ACCESS_TOKEN,
        apiVersion: process.env.SALESFORCE_API_VERSION || 'v61.0',
      },
      sap: {
        baseUrl: process.env.SAP_BASE_URL,
        username: process.env.SAP_USERNAME,
        password: process.env.SAP_PASSWORD,
        client: process.env.SAP_CLIENT,
        apiKey: process.env.SAP_API_KEY,
      },
      rpa: {
        endpoint: process.env.RPA_API_ENDPOINT,
        apiKey: process.env.RPA_API_KEY,
      },
    },
    security: {
      jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
      jwtExpiry: process.env.JWT_EXPIRY || '24h',
    },
  };

  const finalConfig = { ...defaultConfig, ...config };
  return new IntentOS(finalConfig);
}

/**
 * Example usage
 */
async function example() {
  // Create IntentOS instance
  const intentOS = createIntentOS();

  // Register a user
  const securityManager = intentOS.getSecurityManager();
  const user = await securityManager.registerUser(
    'john_doe',
    'john@example.com',
    'password123',
    UserRole.EMPLOYEE,
    'Engineering'
  );

  console.log('User registered:', user.username);

  // Process natural language intent
  const result = await intentOS.processIntent(
    user.id,
    'I need to submit an expense claim for $250 for a client dinner last week'
  );

  console.log('Intent extracted:', result.intent.extractedIntent);
  console.log('Workflow created:', result.workflow.id);

  // Check if we need more information
  if (result.followUpQuestions && result.followUpQuestions.length > 0) {
    console.log('Follow-up questions:', result.followUpQuestions);
  } else {
    // Execute workflow
    const execution = await intentOS.executeWorkflow(result.workflow.id);
    console.log('Workflow execution:', execution);

    // Check workflow status
    const status = intentOS.getWorkflowStatus(result.workflow.id);
    console.log('Workflow status:', status);
  }

  // Get system metrics
  const metrics = intentOS.getSystemMetrics();
  console.log('System metrics:', metrics);
}

// Run example if this file is executed directly
if (require.main === module) {
  example().catch(console.error);
}
