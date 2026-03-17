/**
 * Core type definitions for IntentOS
 */

import { z } from 'zod';

// ============================================================================
// Agent Types
// ============================================================================

/**
 * Agent role defines the business domain an agent operates in
 */
export enum AgentRole {
  HR = 'hr',
  FINANCE = 'finance',
  LEGAL = 'legal',
  OPERATIONS = 'operations',
  SALES = 'sales',
  MARKETING = 'marketing',
  IT = 'it',
  PROCUREMENT = 'procurement',
}

/**
 * Task status in the workflow state machine
 */
export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  WAITING_APPROVAL = 'waiting_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * Priority levels for tasks
 */
export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

// ============================================================================
// Intent & Extraction Types
// ============================================================================

/**
 * User intent extracted from natural language
 */
export interface Intent {
  id: string;
  userId: string;
  rawInput: string;
  extractedIntent: string;
  confidence: number;
  entities: Record<string, any>;
  timestamp: Date;
  metadata?: Record<string, any>;
}

/**
 * Structured data schema for intent extraction
 */
export const IntentSchema = z.object({
  intent: z.string().describe('The main intent/goal extracted from user input'),
  entities: z.record(z.any()).describe('Structured entities extracted from the input'),
  requiredFields: z.array(z.string()).describe('Fields that are still missing'),
  confidence: z.number().min(0).max(1).describe('Confidence score of the extraction'),
});

// ============================================================================
// Task & Workflow Types
// ============================================================================

/**
 * A single task node in the workflow
 */
export interface TaskNode {
  id: string;
  type: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedAgent?: AgentRole;
  dependencies: string[];
  input?: Record<string, any>;
  output?: Record<string, any>;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  requiresApproval: boolean;
  approvalData?: ApprovalRequest;
}

/**
 * Workflow state containing all tasks and their relationships
 */
export interface WorkflowState {
  id: string;
  intentId: string;
  status: TaskStatus;
  tasks: Map<string, TaskNode>;
  currentTaskId?: string;
  context: Record<string, any>;
  checkpoints: Checkpoint[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Checkpoint for state persistence and recovery
 */
export interface Checkpoint {
  id: string;
  workflowId: string;
  state: string; // Serialized workflow state
  timestamp: Date;
  version: number;
}

// ============================================================================
// Human-in-the-Loop Types
// ============================================================================

/**
 * Approval request for human review
 */
export interface ApprovalRequest {
  id: string;
  workflowId: string;
  taskId: string;
  requestedBy: AgentRole;
  description: string;
  data: Record<string, any>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  deadline?: Date;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: Date;
  comments?: string;
}

/**
 * Dynamic confirmation card for UI display
 */
export interface ConfirmationCard {
  title: string;
  description: string;
  fields: Array<{
    label: string;
    value: any;
    type: 'text' | 'number' | 'currency' | 'date' | 'boolean';
  }>;
  actions: Array<{
    label: string;
    action: 'approve' | 'reject' | 'modify';
    variant: 'primary' | 'secondary' | 'danger';
  }>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

// ============================================================================
// Memory & Knowledge Graph Types
// ============================================================================

/**
 * Entity in the knowledge graph
 */
export interface GraphEntity {
  id: string;
  type: string;
  properties: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Relationship between entities in the knowledge graph
 */
export interface GraphRelationship {
  id: string;
  type: string;
  fromEntityId: string;
  toEntityId: string;
  properties: Record<string, any>;
  createdAt: Date;
}

/**
 * Memory entry for RAG system
 */
export interface MemoryEntry {
  id: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, any>;
  timestamp: Date;
}

// ============================================================================
// Tool Types
// ============================================================================

/**
 * Tool definition for agent capabilities
 */
export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  execute: (params: any) => Promise<any>;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// Security & RBAC Types
// ============================================================================

/**
 * User role in the system
 */
export enum UserRole {
  ADMIN = 'admin',
  MANAGER = 'manager',
  EMPLOYEE = 'employee',
  GUEST = 'guest',
}

/**
 * Permission definition
 */
export interface Permission {
  resource: string;
  actions: string[];
}

/**
 * User with authentication and authorization info
 */
export interface User {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  permissions: Permission[];
  department?: string;
  metadata?: Record<string, any>;
}

/**
 * Agent permissions and capabilities
 */
export interface AgentPermissions {
  role: AgentRole;
  allowedTools: string[];
  maxBudget?: number;
  canApproveUp?: number;
  restrictions: string[];
}

// ============================================================================
// Plan & Reflection Types
// ============================================================================

/**
 * Plan step in the Plan-and-Solve pattern
 */
export interface PlanStep {
  id: string;
  description: string;
  reasoning: string;
  expectedOutcome: string;
  dependencies: string[];
  estimatedCost?: number;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Complete execution plan
 */
export interface ExecutionPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  totalEstimatedCost?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Reflection on execution results
 */
export interface Reflection {
  id: string;
  workflowId: string;
  taskId: string;
  observation: string;
  issues: string[];
  adjustments: string[];
  shouldReplan: boolean;
  newPlan?: ExecutionPlan;
  timestamp: Date;
}

// ============================================================================
// CLEAR Framework Metrics
// ============================================================================

/**
 * Metrics for evaluating agent performance using CLEAR framework
 */
export interface AgentMetrics {
  workflowId: string;
  agentRole: AgentRole;

  // Cost: Token and compute resource usage
  cost: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUSD: number;
  };

  // Latency: Response times
  latency: {
    totalDurationMs: number;
    planningDurationMs: number;
    executionDurationMs: number;
    avgStepDurationMs: number;
  };

  // Efficacy: Task completion success
  efficacy: {
    tasksCompleted: number;
    tasksFailed: number;
    successRate: number;
    goalAchieved: boolean;
  };

  // Assurance: Compliance and safety
  assurance: {
    policyViolations: number;
    securityChecks: number;
    complianceScore: number;
  };

  // Reliability: Consistency across runs
  reliability: {
    runId: string;
    consistencyScore: number;
    errorCount: number;
  };

  timestamp: Date;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * System configuration
 */
export interface SystemConfig {
  llm: {
    provider: 'openai' | 'anthropic';
    model: string;
    temperature: number;
    maxTokens: number;
    apiKey?: string;
  };
  database: {
    url: string;
  };
  vectorStore?: {
    provider: 'pinecone' | 'milvus';
    config: {
      topK?: number;
      dimension?: number;
      namespace?: string;
      // Pinecone
      apiKey?: string;
      indexName?: string;
      // Milvus
      address?: string;
      username?: string;
      password?: string;
      collectionName?: string;
      metricType?: 'COSINE' | 'L2' | 'IP';
    };
    embeddingModel?: string;
    apiKey?: string;
  };
  graphDB: {
    uri: string;
    user: string;
    password: string;
    database?: string;
  };
  integrations?: {
    database?: {
      connectionString?: string;
    };
    email?: {
      endpoint?: string;
      apiKey?: string;
      from?: string;
    };
    document?: {
      endpoint?: string;
      apiKey?: string;
    };
    calendar?: {
      endpoint?: string;
      apiKey?: string;
    };
    slack?: {
      botToken?: string;
    };
    salesforce?: {
      instanceUrl?: string;
      accessToken?: string;
      apiVersion?: string;
    };
    sap?: {
      baseUrl?: string;
      username?: string;
      password?: string;
      client?: string;
      apiKey?: string;
    };
    rpa?: {
      endpoint?: string;
      apiKey?: string;
    };
  };
  security: {
    jwtSecret: string;
    jwtExpiry: string;
  };
}
