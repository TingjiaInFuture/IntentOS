/**
 * IntentOS Orchestrator
 * Main orchestrator that coordinates agents, workflows, and system components
 */

import { v4 as uuidv4 } from 'uuid';
import { IntentExtractor } from '../intent/extractor';
import { WorkflowStateMachine } from '../workflow/state-machine';
import { MemorySystem, createMemorySystemFromConfig } from '../memory/memory-system';
import { ApprovalSystem } from '../approval/approval-system';
import { SecurityManager } from '../security/security-manager';
import { ToolRegistry, createDefaultToolRegistry } from '../tools/tool-registry';
import { BaseAgent } from '../agents/base-agent';
import { HRAgent } from '../agents/hr-agent';
import { FinanceAgent } from '../agents/finance-agent';
import { LegalAgent } from '../agents/legal-agent';
import {
  AgentRole,
  TaskStatus,
  TaskPriority,
  Intent,
  WorkflowState,
  SystemConfig,
} from '../types';

export class IntentOS {
  private intentExtractor: IntentExtractor;
  private workflowStateMachine: WorkflowStateMachine;
  private memorySystem: MemorySystem;
  private approvalSystem: ApprovalSystem;
  private securityManager: SecurityManager;
  private toolRegistry: ToolRegistry;
  private agents: Map<AgentRole, BaseAgent>;

  constructor(config: SystemConfig) {
    // Initialize core systems
    this.intentExtractor = new IntentExtractor({
      provider: config.llm.provider,
      model: config.llm.model,
      temperature: config.llm.temperature,
      apiKey: config.llm.apiKey,
    });

    this.workflowStateMachine = new WorkflowStateMachine();
    this.memorySystem = createMemorySystemFromConfig(config);
    this.approvalSystem = new ApprovalSystem();
    this.securityManager = new SecurityManager(
      config.security.jwtSecret,
      config.security.jwtExpiry
    );
    this.toolRegistry = createDefaultToolRegistry(config.integrations, config.database.url);

    // Initialize agents
    this.agents = new Map();
    this.initializeAgents(config);
  }

  /**
   * Initialize agents with their configurations
   */
  private initializeAgents(config: SystemConfig): void {
    const agentConfig = {
      model: config.llm.model,
      temperature: config.llm.temperature,
      permissions: this.securityManager.getAgentPermissions(AgentRole.HR),
    };

    // Create HR Agent
    this.agents.set(
      AgentRole.HR,
      new HRAgent({
        ...agentConfig,
        permissions: this.securityManager.getAgentPermissions(AgentRole.HR),
      })
    );

    // Create Finance Agent
    this.agents.set(
      AgentRole.FINANCE,
      new FinanceAgent({
        ...agentConfig,
        permissions: this.securityManager.getAgentPermissions(AgentRole.FINANCE),
      })
    );

    // Create Legal Agent
    this.agents.set(
      AgentRole.LEGAL,
      new LegalAgent({
        ...agentConfig,
        permissions: this.securityManager.getAgentPermissions(AgentRole.LEGAL),
      })
    );

    // Register tools for each agent
    const allTools = this.toolRegistry.getAll();
    for (const [role, agent] of this.agents.entries()) {
      const permissions = this.securityManager.getAgentPermissions(role);
      for (const tool of allTools) {
        if (permissions.allowedTools.includes(tool.name)) {
          agent.registerTool(tool);
        }
      }
    }
  }

  /**
   * Process natural language input from user
   */
  async processIntent(
    userId: string,
    input: string,
    conversationId?: string
  ): Promise<{
    intent: Intent;
    workflow: WorkflowState;
    followUpQuestions?: string[];
  }> {
    // Get user context from memory
    const userContext = await this.memorySystem.getRelevantContext(userId, input);

    // Extract intent and entities
    const intent = await this.intentExtractor.extract(userId, input, undefined, {
      userInfo: userContext.userInfo,
      relatedEntities: userContext.relatedEntities,
    });

    // Check if we need more information
    if (!this.intentExtractor.isComplete(intent)) {
      const followUpQuestions = this.intentExtractor.generateFollowUpQuestions(intent);
      return {
        intent,
        workflow: this.workflowStateMachine.createWorkflow(intent.id),
        followUpQuestions,
      };
    }

    // Create workflow for the intent
    const workflow = await this.createWorkflowFromIntent(intent, userId);

    // Store interaction in memory
    await this.memorySystem.store(input, {
      userId,
      intentId: intent.id,
      workflowId: workflow.id,
      timestamp: new Date().toISOString(),
    });

    return { intent, workflow };
  }

  /**
   * Create and initialize workflow from extracted intent
   */
  private async createWorkflowFromIntent(
    intent: Intent,
    userId: string
  ): Promise<WorkflowState> {
    const workflow = this.workflowStateMachine.createWorkflow(intent.id, {
      userId,
      intent: intent.extractedIntent,
      entities: intent.entities,
    });

    // Determine which agent(s) should handle this intent
    const assignedAgent = this.selectAgentForIntent(intent);

    // Create initial task
    this.workflowStateMachine.addTask(workflow.id, intent.extractedIntent, 'root', {
      priority: TaskPriority.MEDIUM,
      assignedAgent,
      input: intent.entities,
    });

    return workflow;
  }

  /**
   * Select appropriate agent based on intent
   */
  private selectAgentForIntent(intent: Intent): AgentRole {
    const intentType = intent.extractedIntent.toLowerCase();

    if (
      intentType.includes('hire') ||
      intentType.includes('leave') ||
      intentType.includes('performance')
    ) {
      return AgentRole.HR;
    }

    if (
      intentType.includes('expense') ||
      intentType.includes('budget') ||
      intentType.includes('invoice') ||
      intentType.includes('payment')
    ) {
      return AgentRole.FINANCE;
    }

    if (
      intentType.includes('contract') ||
      intentType.includes('legal') ||
      intentType.includes('compliance')
    ) {
      return AgentRole.LEGAL;
    }

    // Default to operations
    return AgentRole.OPERATIONS;
  }

  /**
   * Execute workflow
   */
  async executeWorkflow(workflowId: string): Promise<{
    success: boolean;
    status: TaskStatus;
    results?: any;
    error?: string;
  }> {
    const workflow = this.workflowStateMachine.getWorkflow(workflowId);
    if (!workflow) {
      return {
        success: false,
        status: TaskStatus.FAILED,
        error: 'Workflow not found',
      };
    }

    try {
      // Update workflow status
      workflow.status = TaskStatus.IN_PROGRESS;

      // Get the next task to execute
      const task = this.workflowStateMachine.getNextTask(workflowId);
      if (!task) {
        // No more tasks, workflow complete
        workflow.status = TaskStatus.COMPLETED;
        return {
          success: true,
          status: TaskStatus.COMPLETED,
        };
      }

      // Get the assigned agent
      if (!task.assignedAgent) {
        throw new Error('No agent assigned to task');
      }

      const agent = this.agents.get(task.assignedAgent);
      if (!agent) {
        throw new Error(`Agent ${task.assignedAgent} not found`);
      }

      // Update task status
      this.workflowStateMachine.updateTaskStatus(workflowId, task.id, TaskStatus.IN_PROGRESS);

      // Execute with agent
      const result = await agent.run(task.description, workflow);

      if (result.success) {
        this.workflowStateMachine.updateTaskStatus(
          workflowId,
          task.id,
          TaskStatus.COMPLETED,
          result.results
        );
      } else {
        // Check if approval is needed
        const needsApproval =
          Boolean(result.requiresApproval) ||
          (typeof result.error === 'string' && result.error.toLowerCase().includes('approval'));

        if (needsApproval) {
          this.workflowStateMachine.updateTaskStatus(
            workflowId,
            task.id,
            TaskStatus.WAITING_APPROVAL
          );

          // Create approval request
          await this.approvalSystem.createApprovalRequest(
            workflowId,
            task.id,
            task.assignedAgent,
            task.description,
            task.input || {},
            'high'
          );
        } else {
          this.workflowStateMachine.updateTaskStatus(
            workflowId,
            task.id,
            TaskStatus.FAILED,
            undefined,
            result.error
          );
        }
      }

      return {
        success: result.success,
        status: workflow.status,
        results: result.results,
        error: result.error,
      };
    } catch (error) {
      workflow.status = TaskStatus.FAILED;
      return {
        success: false,
        status: TaskStatus.FAILED,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get workflow status
   */
  getWorkflowStatus(workflowId: string): {
    workflow?: WorkflowState;
    stats?: any;
    pendingApprovals?: any[];
  } {
    const workflow = this.workflowStateMachine.getWorkflow(workflowId);
    if (!workflow) {
      return {};
    }

    const stats = this.workflowStateMachine.getWorkflowStats(workflowId);
    const pendingApprovals = this.approvalSystem.getPendingApprovals(workflowId);

    return {
      workflow,
      stats,
      pendingApprovals,
    };
  }

  /**
   * Handle approval decision
   */
  async handleApproval(
    approvalId: string,
    reviewerId: string,
    decision: 'approve' | 'reject',
    comments?: string
  ): Promise<void> {
    const approval =
      decision === 'approve'
        ? await this.approvalSystem.approve(approvalId, reviewerId, comments)
        : await this.approvalSystem.reject(approvalId, reviewerId, comments!);

    // Update workflow task status
    const newStatus = decision === 'approve' ? TaskStatus.APPROVED : TaskStatus.REJECTED;
    this.workflowStateMachine.updateTaskStatus(
      approval.workflowId,
      approval.taskId,
      newStatus
    );

    // If approved, continue workflow execution
    if (decision === 'approve') {
      await this.executeWorkflow(approval.workflowId);
    }
  }

  /**
   * Get system metrics
   */
  getSystemMetrics(): {
    workflows: { total: number; active: number; completed: number; failed: number };
    agents: { role: AgentRole; metrics: any }[];
    pendingApprovals: number;
  } {
    const allWorkflows = this.workflowStateMachine.getAllWorkflows();

    return {
      workflows: {
        total: allWorkflows.length,
        active: allWorkflows.filter((w) => w.status === TaskStatus.IN_PROGRESS).length,
        completed: allWorkflows.filter((w) => w.status === TaskStatus.COMPLETED).length,
        failed: allWorkflows.filter((w) => w.status === TaskStatus.FAILED).length,
      },
      agents: Array.from(this.agents.entries()).map(([role, agent]) => ({
        role,
        metrics: agent.getMetrics(),
      })),
      pendingApprovals: this.approvalSystem.getPendingApprovals().length,
    };
  }

  // Expose subsystems for advanced usage
  getIntentExtractor(): IntentExtractor {
    return this.intentExtractor;
  }

  getWorkflowStateMachine(): WorkflowStateMachine {
    return this.workflowStateMachine;
  }

  getMemorySystem(): MemorySystem {
    return this.memorySystem;
  }

  getApprovalSystem(): ApprovalSystem {
    return this.approvalSystem;
  }

  getSecurityManager(): SecurityManager {
    return this.securityManager;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }
}
