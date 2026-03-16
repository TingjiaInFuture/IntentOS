/**
 * State Machine for workflow persistence and management
 * Implements checkpointing for reliability and recovery
 */

import { v4 as uuidv4 } from 'uuid';
import {
  WorkflowState,
  TaskNode,
  TaskStatus,
  TaskPriority,
  Checkpoint,
  AgentRole,
} from '../types';

export class WorkflowStateMachine {
  private workflows: Map<string, WorkflowState>;
  private checkpointInterval: number;

  constructor(checkpointInterval: number = 5000) {
    this.workflows = new Map();
    this.checkpointInterval = checkpointInterval;
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
    if (tasks.every((t) => t.status === TaskStatus.COMPLETED)) {
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
        return depTask && depTask.status === TaskStatus.COMPLETED;
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
        return restoredWorkflow;
      }
    }

    throw new Error(`Checkpoint ${checkpointId} not found`);
  }

  /**
   * Serialize workflow to string
   */
  private serializeWorkflow(workflow: WorkflowState): string {
    return JSON.stringify({
      ...workflow,
      tasks: Array.from(workflow.tasks.entries()),
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    });
  }

  /**
   * Deserialize workflow from string
   */
  private deserializeWorkflow(state: string): WorkflowState {
    const parsed = JSON.parse(state);
    return {
      ...parsed,
      tasks: new Map(parsed.tasks),
      createdAt: new Date(parsed.createdAt),
      updatedAt: new Date(parsed.updatedAt),
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
      completed: tasks.filter((t) => t.status === TaskStatus.COMPLETED).length,
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
}
