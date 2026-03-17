/**
 * Finance Agent Implementation
 * Handles financial tasks like expense processing, budget management, invoicing
 */

import { BaseAgent, AgentConfig } from './base-agent';
import { AgentRole, PlanStep, WorkflowState } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class FinanceAgent extends BaseAgent {
  constructor(config: Omit<AgentConfig, 'role'>) {
    super({
      ...config,
      role: AgentRole.FINANCE,
    });
  }

  protected async generatePlanSteps(
    goal: string,
    context: Record<string, any>
  ): Promise<PlanStep[]> {
    const lowerGoal = goal.toLowerCase();
    const steps: PlanStep[] = [];

    if (lowerGoal.includes('expense') || lowerGoal.includes('reimburse')) {
      steps.push(
        {
          id: uuidv4(),
          description: 'Validate expense claim and receipts',
          reasoning: 'Ensure claim has proper documentation',
          expectedOutcome: 'Expense validated or flagged for review',
          dependencies: [],
          riskLevel: 'medium',
        },
        {
          id: uuidv4(),
          description: 'Check expense against policy and budget',
          reasoning: 'Verify compliance with expense policy',
          expectedOutcome: 'Policy compliance confirmed',
          dependencies: [steps[0].id],
          riskLevel: 'medium',
        },
        {
          id: uuidv4(),
          description: 'Process payment',
          reasoning: 'Transfer approved amount to employee',
          expectedOutcome: 'Payment processed successfully',
          dependencies: [steps[1].id],
          estimatedCost: context.amount || 0,
          riskLevel: 'high',
        },
        {
          id: uuidv4(),
          description: 'Update accounting records',
          reasoning: 'Maintain accurate financial records',
          expectedOutcome: 'Transaction recorded in accounting system',
          dependencies: [steps[2].id],
          riskLevel: 'low',
        }
      );
    } else if (lowerGoal.includes('budget')) {
      steps.push(
        {
          id: uuidv4(),
          description: 'Analyze budget request and historical data',
          reasoning: 'Evaluate budget justification',
          expectedOutcome: 'Budget analysis report',
          dependencies: [],
          riskLevel: 'low',
        },
        {
          id: uuidv4(),
          description: 'Compare with available funds and forecast',
          reasoning: 'Ensure budget availability',
          expectedOutcome: 'Funding availability confirmed',
          dependencies: [steps[0].id],
          riskLevel: 'medium',
        },
        {
          id: uuidv4(),
          description: 'Get CFO approval if needed',
          reasoning: 'Large budget allocations need executive approval',
          expectedOutcome: 'Approval status',
          dependencies: [steps[1].id],
          riskLevel: 'high',
        },
        {
          id: uuidv4(),
          description: 'Allocate budget and update financial system',
          reasoning: 'Record budget allocation',
          expectedOutcome: 'Budget allocated and recorded',
          dependencies: [steps[2].id],
          riskLevel: 'medium',
        }
      );
    } else if (lowerGoal.includes('invoice')) {
      steps.push(
        {
          id: uuidv4(),
          description: 'Generate invoice from order/contract data',
          reasoning: 'Create invoice document',
          expectedOutcome: 'Invoice generated',
          dependencies: [],
          riskLevel: 'low',
        },
        {
          id: uuidv4(),
          description: 'Send invoice to customer',
          reasoning: 'Deliver invoice for payment',
          expectedOutcome: 'Invoice sent',
          dependencies: [steps[0].id],
          riskLevel: 'low',
        },
        {
          id: uuidv4(),
          description: 'Track payment and send reminders',
          reasoning: 'Ensure timely payment',
          expectedOutcome: 'Payment tracked',
          dependencies: [steps[1].id],
          riskLevel: 'low',
        }
      );
    }

    return steps;
  }

  protected async executeStep(
    step: PlanStep,
    workflow: WorkflowState,
    previousResults: Map<string, any>
  ): Promise<any> {
    console.log(`Finance Agent executing: ${step.description}`);

    // Check if amount exceeds approval threshold
    const amount = workflow.context.amount || step.estimatedCost || 0;
    if (amount > 0 && this.requiresApproval(step.description, { amount })) {
      return {
        success: false,
        requiresApproval: true,
        error: `Payment amount ${amount} requires approval`,
        step: step.description,
        amount,
      };
    }

    try {
      const lowerStep = step.description.toLowerCase();

      if (lowerStep.includes('check expense against policy') || lowerStep.includes('available funds')) {
        const budgetCheck = await this.executeTool('sap_operation', {
          operation: 'read',
          servicePath: '/api/budget/check',
          query: {
            department: String(workflow.context.department || 'general'),
            amount: String(amount),
          },
        });

        return {
          success: true,
          stepId: step.id,
          output: budgetCheck,
          timestamp: new Date(),
        };
      }

      if (lowerStep.includes('process payment')) {
        const paymentResult = await this.executeTool('payment_processing', {
          operation: 'transfer',
          amount,
          currency: workflow.context.currency || 'USD',
          recipient: workflow.context.userId || 'employee',
          description: workflow.context.intent || step.description,
        });

        return {
          success: true,
          stepId: step.id,
          output: paymentResult,
          amount,
          timestamp: new Date(),
        };
      }

      if (lowerStep.includes('update accounting records') || lowerStep.includes('allocate budget')) {
        const accountingResult = await this.executeTool('sap_operation', {
          operation: 'create',
          servicePath: '/api/accounting/entries',
          body: {
            workflowId: workflow.id,
            stepId: step.id,
            amount,
            category: workflow.context.category || 'general',
            description: step.description,
          },
        });

        return {
          success: true,
          stepId: step.id,
          output: accountingResult,
          timestamp: new Date(),
        };
      }

      if (lowerStep.includes('generate invoice')) {
        const invoice = await this.executeTool('sap_operation', {
          operation: 'create',
          servicePath: '/api/invoices',
          body: {
            workflowId: workflow.id,
            customerId: workflow.context.customerId,
            amount,
            currency: workflow.context.currency || 'USD',
          },
        });

        return {
          success: true,
          stepId: step.id,
          output: invoice,
          timestamp: new Date(),
        };
      }

      if (lowerStep.includes('send invoice')) {
        const emailResult = await this.executeTool('send_email', {
          to: [workflow.context.customerEmail || 'billing@example.com'],
          subject: `Invoice for workflow ${workflow.id}`,
          body: `Please review and process invoice generated in workflow ${workflow.id}.`,
        });

        return {
          success: true,
          stepId: step.id,
          output: emailResult,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        stepId: step.id,
        output: `Completed: ${step.description}`,
        amount,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown finance execution error',
        step: step.description,
      };
    }
  }
}
