/**
 * Base Agent class implementing Plan-and-Solve pattern
 * Agents are autonomous entities that can plan, execute, and reflect on tasks
 */

import { v4 as uuidv4 } from 'uuid';
import {
  AgentRole,
  TaskNode,
  TaskStatus,
  ExecutionPlan,
  PlanStep,
  Reflection,
  AgentMetrics,
  Tool,
  WorkflowState,
  AgentPermissions,
} from '../types';

export interface AgentConfig {
  role: AgentRole;
  model: string;
  temperature?: number;
  maxIterations?: number;
  permissions: AgentPermissions;
}

export abstract class BaseAgent {
  protected role: AgentRole;
  protected model: string;
  protected temperature: number;
  protected maxIterations: number;
  protected permissions: AgentPermissions;
  protected tools: Map<string, Tool>;
  protected metrics: Partial<AgentMetrics>;

  constructor(config: AgentConfig) {
    this.role = config.role;
    this.model = config.model;
    this.temperature = config.temperature || 0.7;
    this.maxIterations = config.maxIterations || 10;
    this.permissions = config.permissions;
    this.tools = new Map();
    this.metrics = {
      agentRole: this.role,
      cost: { totalTokens: 0, promptTokens: 0, completionTokens: 0, estimatedCostUSD: 0 },
      latency: { totalDurationMs: 0, planningDurationMs: 0, executionDurationMs: 0, avgStepDurationMs: 0 },
      efficacy: { tasksCompleted: 0, tasksFailed: 0, successRate: 0, goalAchieved: false },
      assurance: { policyViolations: 0, securityChecks: 0, complianceScore: 1.0 },
      reliability: { runId: uuidv4(), consistencyScore: 1.0, errorCount: 0 },
    };
  }

  /**
   * Plan phase: Generate execution plan based on goal and context
   */
  protected async plan(goal: string, context: Record<string, any>): Promise<ExecutionPlan> {
    const startTime = Date.now();

    try {
      const steps = await this.generatePlanSteps(goal, context);

      const plan: ExecutionPlan = {
        id: uuidv4(),
        goal,
        steps,
        totalEstimatedCost: steps.reduce((sum, step) => sum + (step.estimatedCost || 0), 0),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.metrics.latency!.planningDurationMs = Date.now() - startTime;

      return plan;
    } catch (error) {
      this.metrics.reliability!.errorCount++;
      throw error;
    }
  }

  /**
   * Generate plan steps - to be implemented by concrete agents
   */
  protected abstract generatePlanSteps(
    goal: string,
    context: Record<string, any>
  ): Promise<PlanStep[]>;

  /**
   * Execute phase: Execute the plan step by step
   */
  protected async execute(
    plan: ExecutionPlan,
    workflow: WorkflowState
  ): Promise<Map<string, any>> {
    const startTime = Date.now();
    const results = new Map<string, any>();
    let iteration = 0;

    try {
      for (const step of plan.steps) {
        if (iteration >= this.maxIterations) {
          throw new Error('Max iterations reached');
        }

        // Check if dependencies are met
        const dependenciesMet = step.dependencies.every((depId) => results.has(depId));
        if (!dependenciesMet) {
          throw new Error(`Dependencies not met for step ${step.id}`);
        }

        // Execute the step
        const result = await this.executeStep(step, workflow, results);
        results.set(step.id, result);

        // Reflect on the result
        const reflection = await this.reflect(step, result, workflow);

        // If we need to replan, do it
        if (reflection.shouldReplan) {
          const newPlan = reflection.newPlan!;
          // Continue with new plan
          plan.steps = newPlan.steps;
          plan.updatedAt = new Date();
        }

        iteration++;
      }

      this.metrics.efficacy!.tasksCompleted++;
      this.metrics.efficacy!.goalAchieved = true;
      this.metrics.latency!.executionDurationMs = Date.now() - startTime;
      this.metrics.latency!.avgStepDurationMs =
        this.metrics.latency!.executionDurationMs / iteration;

      return results;
    } catch (error) {
      this.metrics.efficacy!.tasksFailed++;
      this.metrics.reliability!.errorCount++;
      throw error;
    }
  }

  /**
   * Execute a single plan step - to be implemented by concrete agents
   */
  protected abstract executeStep(
    step: PlanStep,
    workflow: WorkflowState,
    previousResults: Map<string, any>
  ): Promise<any>;

  /**
   * Reflect phase: Analyze execution results and decide if replanning is needed
   */
  protected async reflect(
    step: PlanStep,
    result: any,
    workflow: WorkflowState
  ): Promise<Reflection> {
    const reflection: Reflection = {
      id: uuidv4(),
      workflowId: workflow.id,
      taskId: step.id,
      observation: '',
      issues: [],
      adjustments: [],
      shouldReplan: false,
      timestamp: new Date(),
    };

    // Analyze the result
    if (result.error) {
      reflection.issues.push(`Step failed: ${result.error}`);
      reflection.shouldReplan = true;

      // Generate a new plan if needed
      if (reflection.shouldReplan) {
        reflection.newPlan = await this.replan(step, result, workflow);
      }
    } else {
      reflection.observation = 'Step completed successfully';
    }

    return reflection;
  }

  /**
   * Replan: Generate a new plan when obstacles are encountered
   */
  protected async replan(
    failedStep: PlanStep,
    result: any,
    workflow: WorkflowState
  ): Promise<ExecutionPlan> {
    // Default implementation: retry with adjusted parameters
    const newSteps = await this.generatePlanSteps(
      `Recover from failed step: ${failedStep.description}. Error: ${result.error}`,
      workflow.context
    );

    return {
      id: uuidv4(),
      goal: `Recovery plan for ${failedStep.id}`,
      steps: newSteps,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Main entry point: Plan, execute, and reflect
   */
  async run(goal: string, workflow: WorkflowState): Promise<any> {
    const totalStartTime = Date.now();

    try {
      // Plan phase
      const plan = await this.plan(goal, workflow.context);

      // Execute phase with reflection loop
      const results = await this.execute(plan, workflow);

      // Calculate final metrics
      this.metrics.latency!.totalDurationMs = Date.now() - totalStartTime;
      this.metrics.efficacy!.successRate =
        this.metrics.efficacy!.tasksCompleted /
        (this.metrics.efficacy!.tasksCompleted + this.metrics.efficacy!.tasksFailed);

      return {
        success: true,
        results,
        metrics: this.metrics,
      };
    } catch (error) {
      this.metrics.reliability!.errorCount++;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metrics: this.metrics,
      };
    }
  }

  /**
   * Register a tool for this agent
   */
  registerTool(tool: Tool): void {
    if (!this.permissions.allowedTools.includes(tool.name)) {
      throw new Error(`Tool ${tool.name} not allowed for agent ${this.role}`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Execute a tool
   */
  protected async executeTool(toolName: string, params: any): Promise<any> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }

    this.metrics.assurance!.securityChecks++;

    try {
      const result = await tool.execute(params);
      return result;
    } catch (error) {
      this.metrics.reliability!.errorCount++;
      throw error;
    }
  }

  /**
   * Check if an action requires approval
   */
  protected requiresApproval(action: string, params: any): boolean {
    // High-value transactions need approval
    if (params.amount && params.amount > (this.permissions.maxBudget || 0)) {
      return true;
    }

    // Sensitive operations need approval
    const sensitiveActions = ['delete', 'terminate', 'transfer_funds'];
    return sensitiveActions.some((sensitive) => action.includes(sensitive));
  }

  /**
   * Get current metrics
   */
  getMetrics(): Partial<AgentMetrics> {
    return { ...this.metrics, timestamp: new Date() };
  }

  /**
   * Get agent role
   */
  getRole(): AgentRole {
    return this.role;
  }
}
