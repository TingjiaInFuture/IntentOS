/**
 * Core type definitions for IntentOS
 * AI-Native system definitions
 */

import { z } from 'zod';

// ============================================================================
// Agent Types
// ============================================================================

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

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

// ============================================================================
// Intent & Extraction Types
// ============================================================================

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

export const IntentSchema = z.object({
  intent: z.string().describe('The main intent/goal extracted from user input'),
  entities: z.record(z.any()).describe('Structured entities extracted from the input'),
  requiredFields: z.array(z.string()).describe('Fields that are still missing'),
  confidence: z.number().min(0).max(1).describe('Confidence score of the extraction'),
});

// ============================================================================
// Task & Workflow Types
// ============================================================================

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

export interface Checkpoint {
  id: string;
  workflowId: string;
  state: string;
  timestamp: Date;
  version: number;
}

// ============================================================================
// Human-in-the-Loop Types
// ============================================================================

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

export interface GraphEntity {
  id: string;
  type: string;
  properties: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GraphRelationship {
  id: string;
  type: string;
  fromEntityId: string;
  toEntityId: string;
  properties: Record<string, any>;
  createdAt: Date;
}

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

export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  execute: (params: any) => Promise<any>;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// Security & RBAC Types
// ============================================================================

export enum UserRole {
  ADMIN = 'admin',
  MANAGER = 'manager',
  EMPLOYEE = 'employee',
  GUEST = 'guest',
}

export interface Permission {
  resource: string;
  actions: string[];
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  permissions: Permission[];
  department?: string;
  metadata?: Record<string, any>;
}

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

export interface PlanStep {
  id: string;
  description: string;
  reasoning: string;
  expectedOutcome: string;
  dependencies: string[];
  toolsToUse?: string[];
  estimatedCost?: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ExecutionPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  totalEstimatedCost?: number;
  createdAt: Date;
  updatedAt: Date;
}

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

export interface AgentMetrics {
  workflowId?: string;
  agentRole: AgentRole;
  cost: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUSD: number;
  };
  latency: {
    totalDurationMs: number;
    planningDurationMs: number;
    executionDurationMs: number;
    avgStepDurationMs: number;
  };
  efficacy: {
    tasksCompleted: number;
    tasksFailed: number;
    successRate: number;
    goalAchieved: boolean;
  };
  assurance: {
    policyViolations: number;
    securityChecks: number;
    complianceScore: number;
  };
  reliability: {
    runId: string;
    consistencyScore: number;
    errorCount: number;
  };
  timestamp?: Date;
}

// ============================================================================
// Audit Types
// ============================================================================

export interface AuditEntry {
  id: string;
  timestamp: Date;
  actor: string;
  action: string;
  resource: string;
  details: Record<string, any>;
  outcome: 'success' | 'failure' | 'denied';
}

// ============================================================================
// Configuration - AI-Native
// ============================================================================

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
      apiKey?: string;
      indexName?: string;
      address?: string;
      username?: string;
      password?: string;
      collectionName?: string;
      metricType?: 'COSINE' | 'L2' | 'IP';
    };
    embeddingModel?: string;
    apiKey?: string;
  };
  graphDB?: {
    uri: string;
    user: string;
    password: string;
    database?: string;
  };
  smtp?: {
    host: string;
    port: number;
    user?: string;
    pass?: string;
    from: string;
  };
  security: {
    jwtSecret: string;
    jwtExpiry: string;
  };
}
