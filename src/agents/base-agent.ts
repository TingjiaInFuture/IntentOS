/**
 * Base Agent - Plan-and-Solve with LLM-driven planning
 */

import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import {
  AgentRole,
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
  apiKey?: string;
  systemPrompt?: string;
  availableToolNames?: string[];
}

export class BaseAgent {
  protected role: AgentRole;
  protected model: string;
  protected temperature: number;
  protected maxIterations: number;
  protected permissions: AgentPermissions;
  protected tools: Map<string, Tool>;
  protected metrics: Partial<AgentMetrics>;
  protected apiKey?: string;
  protected systemPrompt: string;
  protected availableToolNames: string[];
  private _openAIClient?: OpenAI;

  constructor(config: AgentConfig) {
    this.role = config.role;
    this.model = config.model;
    this.temperature = config.temperature || 0.7;
    this.maxIterations = config.maxIterations || 10;
    this.permissions = config.permissions;
    this.apiKey = config.apiKey;
    this.availableToolNames = config.availableToolNames || config.permissions.allowedTools;
    this.tools = new Map();

    this.metrics = {
      agentRole: this.role,
      cost: {
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        estimatedCostUSD: 0,
      },
      latency: {
        totalDurationMs: 0,
        planningDurationMs: 0,
        executionDurationMs: 0,
        avgStepDurationMs: 0,
      },
      efficacy: {
        tasksCompleted: 0,
        tasksFailed: 0,
        successRate: 0,
        goalAchieved: false,
      },
      assurance: {
        policyViolations: 0,
        securityChecks: 0,
        complianceScore: 1.0,
      },
      reliability: {
        runId: uuidv4(),
        consistencyScore: 1.0,
        errorCount: 0,
      },
    };

    this.systemPrompt = config.systemPrompt || this.getDefaultSystemPrompt();
  }

  protected getDefaultSystemPrompt(): string {
    return `You are an AI agent specialized in ${this.role} operations for an enterprise.
You have access to the following tools: ${this.availableToolNames.join(', ')}.
You must plan and execute tasks step by step.
Always explain your reasoning.
Never fabricate data - use tools to query real information.
For high-risk actions, recommend human approval.`;
  }

  protected async generatePlanSteps(goal: string, context: Record<string, any>): Promise<PlanStep[]> {
    const client = this.getOpenAIClient();

    const completion = await client.chat.completions.create({
      model: this.model,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: `${this.systemPrompt}

You are generating an execution plan. Given a goal and context, produce a list of concrete steps.
Each step must specify:
- description: what to do
- reasoning: why this step is needed
- expectedOutcome: what success looks like
- dependencies: IDs of steps that must complete first (use step indices like "step_0", "step_1")
- toolsToUse: which tools from [${this.availableToolNames.join(', ')}] this step should use
- riskLevel: "low", "medium", or "high"
- estimatedCost: estimated monetary cost (0 if not applicable)

Respond ONLY in JSON: { "steps": [...] }`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            goal,
            context,
            availableTools: this.availableToolNames,
            agentRole: this.role,
            constraints: this.permissions.restrictions,
          }),
        },
      ],
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('LLM returned empty plan');
    }

    if (completion.usage) {
      this.metrics.cost!.promptTokens += completion.usage.prompt_tokens;
      this.metrics.cost!.completionTokens += completion.usage.completion_tokens;
      this.metrics.cost!.totalTokens += completion.usage.total_tokens;
    }

    const parsed = JSON.parse(content) as { steps?: Array<Record<string, any>> };
    const rawSteps = parsed.steps || [];

    const idMap = new Map<string, string>();
    const steps: PlanStep[] = rawSteps.map((raw, index) => {
      const id = uuidv4();
      idMap.set(`step_${index}`, id);

      const toolsToUse = Array.isArray(raw.toolsToUse)
        ? raw.toolsToUse.filter((t) => typeof t === 'string')
        : [];

      const riskLevel =
        raw.riskLevel === 'medium' || raw.riskLevel === 'high' ? raw.riskLevel : 'low';

      return {
        id,
        description: String(raw.description || `Step ${index + 1}`),
        reasoning: String(raw.reasoning || ''),
        expectedOutcome: String(raw.expectedOutcome || ''),
        dependencies: [],
        toolsToUse,
        estimatedCost: Number(raw.estimatedCost || 0),
        riskLevel,
      };
    });

    rawSteps.forEach((raw, index) => {
      const deps = Array.isArray(raw.dependencies)
        ? raw.dependencies.filter((d) => typeof d === 'string')
        : [];
      steps[index].dependencies = deps
        .map((dep) => idMap.get(dep))
        .filter((depId): depId is string => Boolean(depId));
    });

    return steps;
  }

  protected async execute(plan: ExecutionPlan, workflow: WorkflowState): Promise<Map<string, any>> {
    const startTime = Date.now();
    const results = new Map<string, any>();
    let iteration = 0;

    try {
      for (const step of plan.steps) {
        if (iteration >= this.maxIterations) {
          throw new Error('Max iterations reached');
        }

        const dependenciesMet = step.dependencies.every((depId) => results.has(depId));
        if (!dependenciesMet) {
          throw new Error(`Dependencies not met for step ${step.id}`);
        }

        const stepContext = this.buildStepContext(step, workflow, results);
        const result = await this.executeStep(step, workflow, results, stepContext);
        results.set(step.id, result);

        const reflection = await this.reflect(step, result, workflow);
        if (reflection.shouldReplan && reflection.newPlan) {
          plan.steps = reflection.newPlan.steps;
          plan.updatedAt = new Date();
        }

        iteration++;
      }

      this.metrics.efficacy!.tasksCompleted++;
      this.metrics.efficacy!.goalAchieved = true;
      this.metrics.latency!.executionDurationMs = Date.now() - startTime;
      this.metrics.latency!.avgStepDurationMs =
        this.metrics.latency!.executionDurationMs / Math.max(iteration, 1);

      return results;
    } catch (error) {
      this.metrics.efficacy!.tasksFailed++;
      this.metrics.reliability!.errorCount++;
      throw error;
    }
  }

  private buildStepContext(
    step: PlanStep,
    workflow: WorkflowState,
    previousResults: Map<string, any>
  ): string {
    const contextParts: string[] = [];

    contextParts.push(`## Current Step\n${step.description}\nReasoning: ${step.reasoning}`);
    contextParts.push(`## Workflow Context\n${JSON.stringify(workflow.context, null, 2)}`);

    if (step.dependencies.length > 0) {
      const dependencyResults: Record<string, any> = {};
      for (const depId of step.dependencies) {
        dependencyResults[depId] = previousResults.get(depId);
      }

      contextParts.push(`## Previous Step Results\n${JSON.stringify(dependencyResults, null, 2)}`);
    }

    return contextParts.join('\n\n');
  }

  protected async executeStep(
    step: PlanStep,
    workflow: WorkflowState,
    _previousResults: Map<string, any>,
    stepContext: string
  ): Promise<any> {
    console.log(`[${this.role}] Executing: ${step.description}`);

    const canApproveLimit = this.permissions.canApproveUp || 0;
    if (step.riskLevel === 'high' || (step.estimatedCost || 0) > canApproveLimit) {
      return {
        success: false,
        requiresApproval: true,
        error: `Step requires human approval: ${step.description}`,
        step: step.description,
        riskLevel: step.riskLevel,
      };
    }

    const toolsToUse = step.toolsToUse || [];
    if (toolsToUse.length > 0) {
      return this.executeStepWithTools(step, workflow, stepContext, toolsToUse);
    }

    return this.executeStepWithLLM(step, stepContext);
  }

  private async executeStepWithTools(
    step: PlanStep,
    _workflow: WorkflowState,
    stepContext: string,
    toolNames: string[]
  ): Promise<any> {
    const client = this.getOpenAIClient();

    const toolDefs = toolNames
      .map((name) => this.tools.get(name))
      .filter((tool): tool is Tool => Boolean(tool))
      .map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: this.zodToJsonSchema(tool.parameters),
        },
      }));

    if (toolDefs.length === 0) {
      return this.executeStepWithLLM(step, stepContext);
    }

    const completion = await client.chat.completions.create({
      model: this.model,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: `${this.systemPrompt}\n\nExecute this step by calling the appropriate tool(s).`,
        },
        {
          role: 'user',
          content: `Step: ${step.description}\n\nContext:\n${stepContext}`,
        },
      ],
      tools: toolDefs,
    });

    if (completion.usage) {
      this.metrics.cost!.totalTokens += completion.usage.total_tokens;
    }

    const message = completion.choices[0]?.message;
    const toolCalls = message?.tool_calls || [];

    if (toolCalls.length === 0) {
      return {
        success: true,
        stepId: step.id,
        output: message?.content || `Completed: ${step.description}`,
        timestamp: new Date(),
      };
    }

    const toolResults: any[] = [];

    for (const toolCall of toolCalls) {
      const tool = this.tools.get(toolCall.function.name);
      if (!tool) {
        toolResults.push({ error: `Tool ${toolCall.function.name} not found` });
        continue;
      }

      this.metrics.assurance!.securityChecks++;

      try {
        const parsedArgs = toolCall.function.arguments
          ? JSON.parse(toolCall.function.arguments)
          : {};
        const result = await tool.execute(parsedArgs);
        toolResults.push({
          toolName: toolCall.function.name,
          result,
        });
      } catch (error) {
        this.metrics.reliability!.errorCount++;
        toolResults.push({
          toolName: toolCall.function.name,
          error: error instanceof Error ? error.message : 'Tool execution failed',
        });
      }
    }

    return {
      success: toolResults.every((r) => !r.error),
      stepId: step.id,
      output: toolResults,
      timestamp: new Date(),
    };
  }

  private async executeStepWithLLM(step: PlanStep, stepContext: string): Promise<any> {
    const client = this.getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: this.model,
      temperature: this.temperature,
      messages: [
        { role: 'system', content: this.systemPrompt },
        {
          role: 'user',
          content: `Execute this step:\n${step.description}\n\nContext:\n${stepContext}`,
        },
      ],
    });

    if (completion.usage) {
      this.metrics.cost!.totalTokens += completion.usage.total_tokens;
    }

    return {
      success: true,
      stepId: step.id,
      output: completion.choices[0]?.message?.content || '',
      timestamp: new Date(),
    };
  }

  protected async reflect(step: PlanStep, result: any, workflow: WorkflowState): Promise<Reflection> {
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

    if (result.error && !result.requiresApproval) {
      reflection.issues.push(`Step failed: ${result.error}`);
      reflection.shouldReplan = true;
      reflection.newPlan = await this.replan(step, result, workflow);
    } else {
      reflection.observation = 'Step completed successfully';
    }

    return reflection;
  }

  protected async replan(
    failedStep: PlanStep,
    result: any,
    workflow: WorkflowState
  ): Promise<ExecutionPlan> {
    const newSteps = await this.generatePlanSteps(
      `Recover from failed step: ${failedStep.description}. Error: ${result.error}`,
      {
        ...workflow.context,
        previousError: result.error,
        failedStep: failedStep.description,
      }
    );

    return {
      id: uuidv4(),
      goal: `Recovery plan for ${failedStep.id}`,
      steps: newSteps,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async run(goal: string, workflow: WorkflowState): Promise<any> {
    const totalStartTime = Date.now();

    try {
      const planStart = Date.now();
      const plan = await this.plan(goal, workflow.context);
      this.metrics.latency!.planningDurationMs = Date.now() - planStart;

      const results = await this.execute(plan, workflow);

      this.metrics.latency!.totalDurationMs = Date.now() - totalStartTime;
      this.metrics.efficacy!.successRate =
        this.metrics.efficacy!.tasksCompleted /
        Math.max(this.metrics.efficacy!.tasksCompleted + this.metrics.efficacy!.tasksFailed, 1);

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

  protected async plan(goal: string, context: Record<string, any>): Promise<ExecutionPlan> {
    const steps = await this.generatePlanSteps(goal, context);

    return {
      id: uuidv4(),
      goal,
      steps,
      totalEstimatedCost: steps.reduce((sum, step) => sum + (step.estimatedCost || 0), 0),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  registerTool(tool: Tool): void {
    if (!this.permissions.allowedTools.includes(tool.name)) {
      throw new Error(`Tool ${tool.name} not allowed for agent ${this.role}`);
    }

    this.tools.set(tool.name, tool);
  }

  getMetrics(): Partial<AgentMetrics> {
    return {
      ...this.metrics,
      timestamp: new Date(),
    };
  }

  getRole(): AgentRole {
    return this.role;
  }

  protected getOpenAIClient(): OpenAI {
    if (this._openAIClient) {
      return this._openAIClient;
    }

    const apiKey = this.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY required');
    }

    this._openAIClient = new OpenAI({ apiKey });
    return this._openAIClient;
  }

  private zodToJsonSchema(schema: any): any {
    if (!schema || !schema._def) {
      return { type: 'object', additionalProperties: true };
    }

    const typeName = schema._def.typeName;

    if (typeName === 'ZodOptional' || typeName === 'ZodDefault' || typeName === 'ZodCatch') {
      return this.zodToJsonSchema(schema._def.innerType || schema._def.schema || schema._def.type);
    }

    if (typeName === 'ZodNullable') {
      return {
        anyOf: [this.zodToJsonSchema(schema._def.innerType || schema._def.type), { type: 'null' }],
        description: schema._def.description || '',
      };
    }

    if (typeName === 'ZodEffects') {
      return this.zodToJsonSchema(schema._def.schema);
    }

    if (typeName === 'ZodObject') {
      const shape = typeof schema._def.shape === 'function' ? schema._def.shape() : schema._def.shape;
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape) as Array<[string, any]>) {
        properties[key] = this.zodToJsonSchema(value);

        if (!this.isOptionalSchema(value)) {
          required.push(key);
        }
      }

      const jsonSchema: Record<string, any> = {
        type: 'object',
        properties,
      };

      if (required.length > 0) {
        jsonSchema.required = required;
      }

      return jsonSchema;
    }

    if (typeName === 'ZodString') {
      return { type: 'string', description: schema._def.description || '' };
    }

    if (typeName === 'ZodNumber') {
      const jsonSchema: Record<string, any> = {
        type: schema._def.checks?.some((check: any) => check.kind === 'int') ? 'integer' : 'number',
        description: schema._def.description || '',
      };

      for (const check of schema._def.checks || []) {
        if (check.kind === 'min') {
          jsonSchema.minimum = check.value;
        }

        if (check.kind === 'max') {
          jsonSchema.maximum = check.value;
        }
      }

      return jsonSchema;
    }

    if (typeName === 'ZodBoolean') {
      return { type: 'boolean', description: schema._def.description || '' };
    }

    if (typeName === 'ZodEnum') {
      return {
        type: 'string',
        enum: schema._def.values || [],
        description: schema._def.description || '',
      };
    }

    if (typeName === 'ZodNativeEnum') {
      return {
        type: 'string',
        enum: Object.values(schema._def.values).filter(
          (value: any) => typeof value === 'string' || typeof value === 'number'
        ),
        description: schema._def.description || '',
      };
    }

    if (typeName === 'ZodArray') {
      return {
        type: 'array',
        items: this.zodToJsonSchema(schema._def.type),
        description: schema._def.description || '',
      };
    }

    if (typeName === 'ZodRecord') {
      return {
        type: 'object',
        additionalProperties: schema._def.valueType ? this.zodToJsonSchema(schema._def.valueType) : true,
        description: schema._def.description || '',
      };
    }

    if (typeName === 'ZodUnion') {
      return {
        oneOf: schema._def.options.map((option: any) => this.zodToJsonSchema(option)),
        description: schema._def.description || '',
      };
    }

    if (typeName === 'ZodTuple') {
      return {
        type: 'array',
        items: schema._def.items.map((item: any) => this.zodToJsonSchema(item)),
        minItems: schema._def.items.length,
        maxItems: schema._def.items.length,
        description: schema._def.description || '',
      };
    }

    if (typeName === 'ZodLiteral') {
      return {
        enum: [schema._def.value],
        description: schema._def.description || '',
      };
    }

    if (typeName === 'ZodDate') {
      return {
        type: 'string',
        format: 'date-time',
        description: schema._def.description || '',
      };
    }

    if (typeName === 'ZodNull') {
      return { type: 'null', description: schema._def.description || '' };
    }

    if (typeName === 'ZodAny' || typeName === 'ZodUnknown' || typeName === 'ZodUndefined') {
      return { description: schema._def.description || '' };
    }

    return {
      type: 'string',
      description: schema._def?.description || '',
    };
  }

  private isOptionalSchema(schema: any): boolean {
    if (!schema || !schema._def) {
      return false;
    }

    const typeName = schema._def.typeName;
    if (typeName === 'ZodOptional' || typeName === 'ZodDefault' || typeName === 'ZodCatch') {
      return true;
    }

    if (typeName === 'ZodEffects') {
      return this.isOptionalSchema(schema._def.schema);
    }

    return false;
  }
}
