/**
 * IntentOS Orchestrator
 * Main orchestrator that coordinates agents, workflows, and system components
 */

import OpenAI from 'openai';
import { IntentExtractor } from '../intent/extractor';
import { WorkflowStateMachine } from '../workflow/state-machine';
import { MemorySystem, createMemorySystemFromConfig } from '../memory/memory-system';
import { ApprovalSystem } from '../approval/approval-system';
import { AuditLogger } from '../audit/audit-log';
import { SecurityManager } from '../security/security-manager';
import { EmailWorker } from '../workers/email-worker';
import { ToolRegistry, createDefaultToolRegistry } from '../tools/tool-registry';
import { BaseAgent } from '../agents/base-agent';
import { HRAgent } from '../agents/hr-agent';
import { FinanceAgent } from '../agents/finance-agent';
import { LegalAgent } from '../agents/legal-agent';
import { OperationsAgent } from '../agents/operations-agent';
import { SalesAgent } from '../agents/sales-agent';
import { MarketingAgent } from '../agents/marketing-agent';
import { ITAgent } from '../agents/it-agent';
import { ProcurementAgent } from '../agents/procurement-agent';
import {
  AgentRole,
  TaskStatus,
  TaskPriority,
  Intent,
  WorkflowState,
  SystemConfig,
} from '../types';

export class IntentOS {
  private config: SystemConfig;
  private intentExtractor: IntentExtractor;
  private workflowStateMachine: WorkflowStateMachine;
  private memorySystem: MemorySystem;
  private approvalSystem: ApprovalSystem;
  private auditLogger: AuditLogger;
  private securityManager: SecurityManager;
  private toolRegistry: ToolRegistry;
  private agents: Map<AgentRole, BaseAgent>;
  private emailWorker?: EmailWorker;
  private openAIClient?: OpenAI;
  private ready: Promise<void>;

  constructor(config: SystemConfig) {
    this.config = config;

    // Initialize core systems
    this.intentExtractor = new IntentExtractor({
      provider: config.llm.provider,
      model: config.llm.model,
      temperature: config.llm.temperature,
      apiKey: config.llm.apiKey,
    });

    this.workflowStateMachine = new WorkflowStateMachine(config.database.url);
    this.memorySystem = createMemorySystemFromConfig(config);
    this.approvalSystem = new ApprovalSystem(config.database.url);
    this.auditLogger = new AuditLogger(config.database.url);
    this.securityManager = new SecurityManager(
      config.security.jwtSecret,
      config.security.jwtExpiry,
      config.database.url
    );
    this.emailWorker = config.smtp ? new EmailWorker(config.database.url, config.smtp) : undefined;
    this.toolRegistry = createDefaultToolRegistry(config, this.emailWorker);
    this.ready = Promise.all([
      this.workflowStateMachine.ready,
      this.approvalSystem.ready,
      this.securityManager.ready,
    ]).then(() => undefined);

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
      apiKey: config.llm.apiKey,
    };

    // Create HR Agent
    this.agents.set(
      AgentRole.HR,
      new HRAgent({
        ...agentConfig,
        permissions: this.securityManager.getAgentPermissions(AgentRole.HR),
        availableToolNames: this.securityManager.getAgentPermissions(AgentRole.HR).allowedTools,
      })
    );

    // Create Finance Agent
    this.agents.set(
      AgentRole.FINANCE,
      new FinanceAgent({
        ...agentConfig,
        permissions: this.securityManager.getAgentPermissions(AgentRole.FINANCE),
        availableToolNames:
          this.securityManager.getAgentPermissions(AgentRole.FINANCE).allowedTools,
      })
    );

    // Create Legal Agent
    this.agents.set(
      AgentRole.LEGAL,
      new LegalAgent({
        ...agentConfig,
        permissions: this.securityManager.getAgentPermissions(AgentRole.LEGAL),
        availableToolNames: this.securityManager.getAgentPermissions(AgentRole.LEGAL).allowedTools,
      })
    );

    // Create Operations Agent
    this.agents.set(
      AgentRole.OPERATIONS,
      new OperationsAgent({
        ...agentConfig,
        permissions: this.securityManager.getAgentPermissions(AgentRole.OPERATIONS),
        availableToolNames:
          this.securityManager.getAgentPermissions(AgentRole.OPERATIONS).allowedTools,
      })
    );

    // Create Sales Agent
    this.agents.set(
      AgentRole.SALES,
      new SalesAgent({
        ...agentConfig,
        permissions: this.securityManager.getAgentPermissions(AgentRole.SALES),
        availableToolNames: this.securityManager.getAgentPermissions(AgentRole.SALES).allowedTools,
      })
    );

    // Create Marketing Agent
    this.agents.set(
      AgentRole.MARKETING,
      new MarketingAgent({
        ...agentConfig,
        permissions: this.securityManager.getAgentPermissions(AgentRole.MARKETING),
        availableToolNames:
          this.securityManager.getAgentPermissions(AgentRole.MARKETING).allowedTools,
      })
    );

    // Create IT Agent
    this.agents.set(
      AgentRole.IT,
      new ITAgent({
        ...agentConfig,
        permissions: this.securityManager.getAgentPermissions(AgentRole.IT),
        availableToolNames: this.securityManager.getAgentPermissions(AgentRole.IT).allowedTools,
      })
    );

    // Create Procurement Agent
    this.agents.set(
      AgentRole.PROCUREMENT,
      new ProcurementAgent({
        ...agentConfig,
        permissions: this.securityManager.getAgentPermissions(AgentRole.PROCUREMENT),
        availableToolNames:
          this.securityManager.getAgentPermissions(AgentRole.PROCUREMENT).allowedTools,
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
    await this.ensureReady();

    // Get user context from memory
    const userContext = await this.memorySystem.getRelevantContext(userId, input, conversationId);

    // Extract intent and entities
    const intent = await this.intentExtractor.extract(userId, input, undefined, {
      userInfo: userContext.userInfo,
      relatedEntities: userContext.relatedEntities,
      relevantMemories: userContext.relevantMemories,
      conversationHistory: userContext.conversationHistory,
      conversationId,
    });

    // Check if we need more information
    if (!this.intentExtractor.isComplete(intent)) {
      const followUpQuestions = this.intentExtractor.generateFollowUpQuestions(intent);
      const workflow = this.workflowStateMachine.createWorkflow(intent.id, {
        userId,
        conversationId,
        intent: intent.extractedIntent,
        entities: intent.entities,
        needsFollowUp: true,
      });

      await this.memorySystem.store(input, {
        userId,
        conversationId,
        intentId: intent.id,
        workflowId: workflow.id,
        timestamp: new Date().toISOString(),
        requiresFollowUp: true,
      });

      await this.recordConversationTurn({
        conversationId,
        userId,
        input,
        intent,
        workflow,
        followUpQuestions,
      });

      await this.logAudit({
        actor: userId,
        action: 'process_intent',
        resource: `workflow:${workflow.id}`,
        details: {
          intent: intent.extractedIntent,
          confidence: intent.confidence,
          conversationId,
          requiresFollowUp: true,
          followUpQuestions,
        },
        outcome: 'success',
      });

      return {
        intent,
        workflow,
        followUpQuestions,
      };
    }

    // Create workflow for the intent
    const workflow = await this.createWorkflowFromIntent(intent, userId, conversationId);

    // Store interaction in memory
    await this.memorySystem.store(input, {
      userId,
      conversationId,
      intentId: intent.id,
      workflowId: workflow.id,
      timestamp: new Date().toISOString(),
    });

    await this.recordConversationTurn({
      conversationId,
      userId,
      input,
      intent,
      workflow,
    });

    await this.logAudit({
      actor: userId,
      action: 'process_intent',
      resource: `workflow:${workflow.id}`,
      details: {
        intent: intent.extractedIntent,
        confidence: intent.confidence,
        conversationId,
      },
      outcome: 'success',
    });

    return { intent, workflow };
  }

  /**
   * Create and initialize workflow from extracted intent
   */
  private async createWorkflowFromIntent(
    intent: Intent,
    userId: string,
    conversationId?: string
  ): Promise<WorkflowState> {
    await this.ensureReady();

    const workflow = this.workflowStateMachine.createWorkflow(intent.id, {
      userId,
      conversationId,
      intent: intent.extractedIntent,
      entities: intent.entities,
    });

    // Determine which agent(s) should handle this intent
    const assignedAgent = await this.selectAgentForIntent(intent);

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
  private async selectAgentForIntent(intent: Intent): Promise<AgentRole> {
    const apiKey = this.config.llm.apiKey || process.env.OPENAI_API_KEY;

    if (this.config.llm.provider === 'openai' && apiKey) {
      try {
        const client = this.getOpenAIClient();
        const completion = await client.chat.completions.create({
          model: this.config.llm.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `You are an enterprise request router. Select the single best agent for the user intent.
Available agents: ${Object.values(AgentRole).join(', ')}
Agent descriptions:
- hr: employee management, leave, hiring, performance, onboarding
- finance: expenses, budgets, invoices, payments, financial reporting
- legal: contracts, compliance, risk assessment, regulations
- operations: cross-functional coordination, incidents, SLAs, process
- sales: leads, pipeline, deals, revenue, quotes
- marketing: campaigns, content, brand, funnel, audience
- it: incidents, access, systems, troubleshooting, infrastructure
- procurement: vendors, purchasing, POs, sourcing

Return JSON only: {"agent":"hr"}`,
            },
            {
              role: 'user',
              content: JSON.stringify({
                intent: intent.extractedIntent,
                entities: intent.entities,
                confidence: intent.confidence,
              }),
            },
          ],
        });

        const content = completion.choices[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content) as { agent?: string };
          const selected = parsed.agent?.trim().toLowerCase();
          if (selected && Object.values(AgentRole).includes(selected as AgentRole)) {
            return selected as AgentRole;
          }
        }
      } catch (error) {
        console.warn('LLM agent routing failed, falling back to heuristics:', error);
      }
    }

    return this.selectAgentByRules(intent);
  }

  private selectAgentByRules(intent: Intent): AgentRole {
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

    if (
      intentType.includes('sales') ||
      intentType.includes('lead') ||
      intentType.includes('pipeline') ||
      intentType.includes('deal')
    ) {
      return AgentRole.SALES;
    }

    if (
      intentType.includes('marketing') ||
      intentType.includes('campaign') ||
      intentType.includes('brand') ||
      intentType.includes('funnel')
    ) {
      return AgentRole.MARKETING;
    }

    if (
      intentType.includes('it') ||
      intentType.includes('incident') ||
      intentType.includes('access') ||
      intentType.includes('system outage')
    ) {
      return AgentRole.IT;
    }

    if (
      intentType.includes('procurement') ||
      intentType.includes('purchase') ||
      intentType.includes('vendor') ||
      intentType.includes('rfq')
    ) {
      return AgentRole.PROCUREMENT;
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
    await this.ensureReady();

    const workflow = this.workflowStateMachine.getWorkflow(workflowId);
    if (!workflow) {
      await this.logAudit({
        actor: 'system',
        action: 'execute_workflow',
        resource: `workflow:${workflowId}`,
        details: { error: 'Workflow not found' },
        outcome: 'failure',
      });

      return {
        success: false,
        status: TaskStatus.FAILED,
        error: 'Workflow not found',
      };
    }

    let task: any;
    let waitingApproval = false;

    try {
      // Update workflow status
      workflow.status = TaskStatus.IN_PROGRESS;

      // Get the next task to execute
      task = this.workflowStateMachine.getNextTask(workflowId);
      if (!task) {
        // No more tasks, workflow complete
        workflow.status = TaskStatus.COMPLETED;
        await this.recordWorkflowConversation(workflow, {
          role: 'assistant',
          content: `Workflow ${workflowId} completed successfully.`,
          metadata: { workflowId, status: TaskStatus.COMPLETED },
        });

        await this.logAudit({
          actor: 'system',
          action: 'execute_workflow',
          resource: `workflow:${workflowId}`,
          details: { status: TaskStatus.COMPLETED },
          outcome: 'success',
        });

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
        waitingApproval =
          Boolean(result.requiresApproval) ||
          (typeof result.error === 'string' && result.error.toLowerCase().includes('approval'));

        if (waitingApproval) {
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

      await this.recordWorkflowConversation(workflow, {
        role: waitingApproval ? 'assistant' : result.success ? 'assistant' : 'system',
        content:
          waitingApproval
            ? `Workflow ${workflowId} is waiting for approval on task ${task.id}.`
            : result.success
              ? `Workflow ${workflowId} executed task ${task.id} with status ${workflow.status}.`
              : `Workflow ${workflowId} failed on task ${task.id}: ${result.error || 'Unknown error'}`,
        metadata: {
          workflowId,
          taskId: task.id,
          status: workflow.status,
          requiresApproval: Boolean(result.requiresApproval),
        },
      });

      await this.logAudit({
        actor: task.assignedAgent || 'system',
        action: 'execute_workflow',
        resource: `workflow:${workflowId}`,
        details: {
          taskId: task.id,
          status: workflow.status,
          requiresApproval: Boolean(result.requiresApproval),
          success: Boolean(result.success),
        },
        outcome:
          waitingApproval || result.success ? 'success' : 'failure',
      });

      return {
        success: result.success,
        status: workflow.status,
        results: result.results,
        error: result.error,
      };
    } catch (error) {
      workflow.status = TaskStatus.FAILED;
      await this.logAudit({
        actor: task?.assignedAgent || 'system',
        action: 'execute_workflow',
        resource: `workflow:${workflowId}`,
        details: {
          taskId: task?.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        outcome: 'failure',
      });

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
    await this.ensureReady();

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

    await this.recordWorkflowConversation(this.workflowStateMachine.getWorkflow(approval.workflowId), {
      role: 'assistant',
      content:
        decision === 'approve'
          ? `Approval ${approvalId} approved by ${reviewerId}.`
          : `Approval ${approvalId} rejected by ${reviewerId}.`,
      metadata: {
        approvalId,
        reviewerId,
        decision,
        comments,
      },
    });

    await this.logAudit({
      actor: reviewerId,
      action: `approval_${decision}`,
      resource: `approval:${approvalId}`,
      details: { workflowId: approval.workflowId, taskId: approval.taskId, comments },
      outcome: 'success',
    });

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

  startBackgroundWorkers(): void {
    this.emailWorker?.start();
  }

  stopBackgroundWorkers(): void {
    this.emailWorker?.stop();
  }

  getEmailWorker(): EmailWorker | undefined {
    return this.emailWorker;
  }

  private getOpenAIClient(): OpenAI {
    if (this.openAIClient) {
      return this.openAIClient;
    }

    const apiKey = this.config.llm.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY required for agent routing');
    }

    this.openAIClient = new OpenAI({ apiKey });
    return this.openAIClient;
  }

  private async ensureReady(): Promise<void> {
    await this.ready;
  }

  private async logAudit(entry: {
    actor: string;
    action: string;
    resource: string;
    details: Record<string, any>;
    outcome: 'success' | 'failure' | 'denied';
  }): Promise<void> {
    try {
      await this.auditLogger.log(entry);
    } catch (error) {
      console.warn('Audit logging failed:', error);
    }
  }

  private async recordConversationTurn(options: {
    conversationId?: string;
    userId: string;
    input: string;
    intent: Intent;
    workflow: WorkflowState;
    followUpQuestions?: string[];
  }): Promise<void> {
    if (!options.conversationId) {
      return;
    }

    await this.memorySystem.storeConversationTurn({
      conversationId: options.conversationId,
      userId: options.userId,
      role: 'user',
      content: options.input,
      metadata: {
        intentId: options.intent.id,
        workflowId: options.workflow.id,
        extractedIntent: options.intent.extractedIntent,
        confidence: options.intent.confidence,
      },
    });

    if (options.followUpQuestions && options.followUpQuestions.length > 0) {
      await this.memorySystem.storeConversationTurn({
        conversationId: options.conversationId,
        userId: options.userId,
        role: 'assistant',
        content: options.followUpQuestions.join('\n'),
        metadata: {
          type: 'follow_up_questions',
          workflowId: options.workflow.id,
          intentId: options.intent.id,
        },
      });
    }
  }

  private async recordWorkflowConversation(
    workflow: WorkflowState | undefined,
    turn: {
      role: 'user' | 'assistant' | 'system';
      content: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const conversationId = workflow?.context?.conversationId;
    if (!conversationId) {
      return;
    }

    await this.memorySystem.storeConversationTurn({
      conversationId,
      userId: String(workflow?.context?.userId || 'system'),
      role: turn.role,
      content: turn.content,
      metadata: turn.metadata || {},
    });
  }
}
