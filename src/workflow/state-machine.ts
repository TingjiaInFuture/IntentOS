/**
 * State Machine for workflow persistence and management
 * Implements checkpointing for reliability and recovery
 */

import { v4 as uuidv4 } from 'uuid';
import { Pool } from 'pg';
import {
  WorkflowState,
  TaskNode,
  TaskStatus,
  TaskPriority,
  Checkpoint,
  AgentRole,
} from '../types';

const workflowPoolCache = new Map<string, Pool>();

function getWorkflowPool(connectionString: string): Pool {
  const existing = workflowPoolCache.get(connectionString);
  if (existing) {
    return existing;
  }

  const pool = new Pool({ connectionString });
  workflowPoolCache.set(connectionString, pool);
  return pool;
}

export class WorkflowStateMachine {
  private workflows: Map<string, WorkflowState>;
  private checkpointInterval: number;
  private databaseUrl?: string;
  private persistQueue: Map<string, Promise<void>>;
  public readonly ready: Promise<void>;

  constructor(databaseUrlOrCheckpointInterval?: string | number, checkpointInterval: number = 5000) {
    this.workflows = new Map();
    this.persistQueue = new Map();
    if (typeof databaseUrlOrCheckpointInterval === 'string') {
      this.databaseUrl = databaseUrlOrCheckpointInterval || undefined;
      this.checkpointInterval = checkpointInterval;
    } else {
      this.databaseUrl = undefined;
      this.checkpointInterval = typeof databaseUrlOrCheckpointInterval === 'number' ? databaseUrlOrCheckpointInterval : checkpointInterval;
    }

    this.ready = this.loadWorkflowsFromDatabase().catch((error) => {
      console.warn('Failed to load workflows from database:', error);
    });
  }

  /**
   * Create a new workflow
   */
  createWorkflow(intentId: string, context: Record<string, any> = {}): WorkflowState {
    const workflow: WorkflowState = {
      id: uuidv4(),
      intentId,
      status: TaskStatus.PENDING,
      tasks: new Map(),
      context,
      checkpoints: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.workflows.set(workflow.id, workflow);
    this.schedulePersistWorkflow(workflow);
    return workflow;
  }

  /**
   * Get workflow by ID
   */
  getWorkflow(workflowId: string): WorkflowState | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * Add a task to the workflow
   */
  addTask(
    workflowId: string,
    description: string,
    type: string,
    options: {
      priority?: TaskPriority;
      assignedAgent?: AgentRole;
      dependencies?: string[];
      requiresApproval?: boolean;
      input?: Record<string, any>;
    } = {}
  ): TaskNode {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const task: TaskNode = {
      id: uuidv4(),
      type,
      description,
      status: TaskStatus.PENDING,
      priority: options.priority || TaskPriority.MEDIUM,
      assignedAgent: options.assignedAgent,
      dependencies: options.dependencies || [],
      input: options.input,
      createdAt: new Date(),
      updatedAt: new Date(),
      requiresApproval: options.requiresApproval || false,
    };

    workflow.tasks.set(task.id, task);
    workflow.updatedAt = new Date();

    // Create checkpoint
    this.createCheckpoint(workflowId);

    return task;
  }

  /**
   * Update task status
   */
  updateTaskStatus(
    workflowId: string,
    taskId: string,
    status: TaskStatus,
    output?: Record<string, any>,
    error?: string
  ): void {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const task = workflow.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found in workflow ${workflowId}`);
    }

    task.status = status;
    task.updatedAt = new Date();

    if (output) {
      task.output = output;
    }

    if (error) {
      task.error = error;
    }

    workflow.updatedAt = new Date();

    // Update workflow status based on tasks
    this.updateWorkflowStatus(workflowId);

    // Create checkpoint
    this.createCheckpoint(workflowId);
  }

  /**
   * Update workflow status based on task statuses
   */
  private updateWorkflowStatus(workflowId: string): void {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return;

    const tasks = Array.from(workflow.tasks.values());

    // Check if all tasks are completed
    if (tasks.every((t) => this.isTaskDone(t.status))) {
      workflow.status = TaskStatus.COMPLETED;
    }
    // Check if any task failed
    else if (tasks.some((t) => t.status === TaskStatus.FAILED)) {
      workflow.status = TaskStatus.FAILED;
    }
    // Check if any task is waiting for approval
    else if (tasks.some((t) => t.status === TaskStatus.WAITING_APPROVAL)) {
      workflow.status = TaskStatus.WAITING_APPROVAL;
    }
    // Check if any task is in progress
    else if (tasks.some((t) => t.status === TaskStatus.IN_PROGRESS)) {
      workflow.status = TaskStatus.IN_PROGRESS;
    }
  }

  /**
   * Get next executable task (dependencies met, not started)
   */
  getNextTask(workflowId: string): TaskNode | undefined {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const tasks = Array.from(workflow.tasks.values());

    // Find a pending task whose dependencies are all completed
    return tasks.find((task) => {
      if (task.status !== TaskStatus.PENDING) {
        return false;
      }

      // Check if all dependencies are completed
      return task.dependencies.every((depId) => {
        const depTask = workflow.tasks.get(depId);
        return depTask && this.isTaskDone(depTask.status);
      });
    });
  }

  /**
   * Create a checkpoint for state persistence
   */
  createCheckpoint(workflowId: string): Checkpoint {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const checkpoint: Checkpoint = {
      id: uuidv4(),
      workflowId,
      state: this.serializeWorkflow(workflow),
      timestamp: new Date(),
      version: workflow.checkpoints.length + 1,
    };

    workflow.checkpoints.push(checkpoint);

    // Keep only last 10 checkpoints
    if (workflow.checkpoints.length > 10) {
      workflow.checkpoints = workflow.checkpoints.slice(-10);
    }

    this.schedulePersistWorkflow(workflow);

    return checkpoint;
  }

  /**
   * Restore workflow from checkpoint
   */
  restoreFromCheckpoint(checkpointId: string): WorkflowState {
    // Find checkpoint in all workflows
    for (const workflow of this.workflows.values()) {
      const checkpoint = workflow.checkpoints.find((cp) => cp.id === checkpointId);
      if (checkpoint) {
        const restoredWorkflow = this.deserializeWorkflow(checkpoint.state);
        this.workflows.set(restoredWorkflow.id, restoredWorkflow);
        this.schedulePersistWorkflow(restoredWorkflow);
        return restoredWorkflow;
      }
    }

    throw new Error(`Checkpoint ${checkpointId} not found`);
  }

  /**
   * Serialize workflow to string
   */
  private serializeWorkflow(workflow: WorkflowState): string {
    return JSON.stringify(this.serializeWorkflowRecord(workflow));
  }

  private serializeWorkflowRecord(workflow: WorkflowState): Record<string, any> {
    return {
      ...workflow,
      tasks: Array.from(workflow.tasks.entries()).map(([taskId, task]) => [
        taskId,
        this.serializeTask(task),
      ]),
      checkpoints: workflow.checkpoints.map((checkpoint) => this.serializeCheckpoint(checkpoint)),
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    };
  }

  /**
   * Deserialize workflow from string
   */
  private deserializeWorkflow(state: string | Record<string, any>): WorkflowState {
    const parsed = typeof state === 'string' ? JSON.parse(state) : state;
    return {
      id: String(parsed.id),
      intentId: String(parsed.intentId || parsed.intent_id || ''),
      status: parsed.status as TaskStatus,
      tasks: new Map(
        (parsed.tasks || []).map(([taskId, task]: [string, any]) => [taskId, this.deserializeTask(task)])
      ),
      currentTaskId: parsed.currentTaskId || parsed.current_task_id,
      context: this.normalizeJson(parsed.context) || {},
      checkpoints: (parsed.checkpoints || []).map((checkpoint: any) =>
        this.deserializeCheckpoint(checkpoint)
      ),
      createdAt: new Date(parsed.createdAt || parsed.created_at),
      updatedAt: new Date(parsed.updatedAt || parsed.updated_at),
    };
  }

  /**
   * Get workflow statistics
   */
  getWorkflowStats(workflowId: string): {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
    waitingApproval: number;
  } {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const tasks = Array.from(workflow.tasks.values());

    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === TaskStatus.PENDING).length,
      inProgress: tasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length,
      completed: tasks.filter((t) => this.isTaskDone(t.status)).length,
      failed: tasks.filter((t) => t.status === TaskStatus.FAILED).length,
      waitingApproval: tasks.filter((t) => t.status === TaskStatus.WAITING_APPROVAL).length,
    };
  }

  /**
   * Update workflow context
   */
  updateContext(workflowId: string, context: Record<string, any>): void {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    workflow.context = { ...workflow.context, ...context };
    workflow.updatedAt = new Date();
    this.schedulePersistWorkflow(workflow);
  }

  /**
   * Cancel workflow
   */
  cancelWorkflow(workflowId: string): void {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    workflow.status = TaskStatus.CANCELLED;
    workflow.updatedAt = new Date();

    // Cancel all pending tasks
    for (const task of workflow.tasks.values()) {
      if (
        task.status === TaskStatus.PENDING ||
        task.status === TaskStatus.IN_PROGRESS ||
        task.status === TaskStatus.WAITING_APPROVAL
      ) {
        task.status = TaskStatus.CANCELLED;
        task.updatedAt = new Date();
      }
    }

    this.createCheckpoint(workflowId);
  }

  /**
   * Get all workflows
   */
  getAllWorkflows(): WorkflowState[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Get workflows by status
   */
  getWorkflowsByStatus(status: TaskStatus): WorkflowState[] {
    return Array.from(this.workflows.values()).filter((w) => w.status === status);
  }

  private async loadWorkflowsFromDatabase(): Promise<void> {
    if (!this.databaseUrl) {
      return;
    }

    const pool = getWorkflowPool(this.databaseUrl);
    const result = await pool.query(`SELECT * FROM workflows ORDER BY created_at ASC`);

    for (const row of result.rows) {
      const workflow = this.deserializeWorkflow({
        id: row.id,
        intentId: row.intent_id,
        status: row.status,
        context: row.context,
        tasks: row.tasks,
        checkpoints: row.checkpoints,
        currentTaskId: row.current_task_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });

      this.workflows.set(workflow.id, workflow);
    }
  }

  private schedulePersistWorkflow(workflow: WorkflowState): void {
    const previous = this.persistQueue.get(workflow.id) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.persistWorkflow(workflow));

    this.persistQueue.set(
      workflow.id,
      next
        .catch(() => undefined)
        .then(() => undefined)
    );

    void next.catch((error) => {
      console.error('Error persisting workflow:', error);
    });
  }

  private async persistWorkflow(workflow: WorkflowState): Promise<void> {
    if (!this.databaseUrl) {
      return;
    }

    const pool = getWorkflowPool(this.databaseUrl);
    const record = this.serializeWorkflowRecord(workflow);

    await pool.query(
      `INSERT INTO workflows (id, intent_id, status, context, tasks, checkpoints, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         intent_id = EXCLUDED.intent_id,
         status = EXCLUDED.status,
         context = EXCLUDED.context,
         tasks = EXCLUDED.tasks,
         checkpoints = EXCLUDED.checkpoints,
         updated_at = EXCLUDED.updated_at`,
      [
        workflow.id,
        workflow.intentId,
        workflow.status,
        record.context,
        record.tasks,
        record.checkpoints,
        workflow.createdAt,
        workflow.updatedAt,
      ]
    );
  }

  private serializeTask(task: TaskNode): Record<string, any> {
    return {
      ...task,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      approvalData: task.approvalData ? this.serializeApprovalRequest(task.approvalData) : undefined,
    };
  }

  private deserializeTask(task: any): TaskNode {
    return {
      ...task,
      status: task.status as TaskStatus,
      priority: task.priority as TaskPriority,
      dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
      input: task.input,
      output: task.output,
      createdAt: new Date(task.createdAt || task.created_at),
      updatedAt: new Date(task.updatedAt || task.updated_at),
      approvalData: task.approvalData ? this.deserializeApprovalRequest(task.approvalData) : undefined,
    };
  }

  private serializeApprovalRequest(request: any): Record<string, any> {
    return {
      ...request,
      deadline: request.deadline ? new Date(request.deadline).toISOString() : undefined,
      reviewedAt: request.reviewedAt ? new Date(request.reviewedAt).toISOString() : undefined,
    };
  }

  private deserializeApprovalRequest(request: any): any {
    return {
      ...request,
      deadline: request.deadline ? new Date(request.deadline) : undefined,
      reviewedAt: request.reviewedAt ? new Date(request.reviewedAt) : undefined,
    };
  }

  private serializeCheckpoint(checkpoint: Checkpoint): Record<string, any> {
    return {
      ...checkpoint,
      timestamp: checkpoint.timestamp.toISOString(),
      state: checkpoint.state,
    };
  }

  private deserializeCheckpoint(checkpoint: any): Checkpoint {
    return {
      id: String(checkpoint.id),
      workflowId: String(checkpoint.workflowId),
      state: String(checkpoint.state),
      timestamp: new Date(checkpoint.timestamp),
      version: Number(checkpoint.version || 0),
    };
  }

  private normalizeJson(value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }

    return value;
  }

  private isTaskDone(status: TaskStatus): boolean {
    return status === TaskStatus.COMPLETED || status === TaskStatus.APPROVED;
  }
}
