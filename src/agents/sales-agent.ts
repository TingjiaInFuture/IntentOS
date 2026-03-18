/**
 * Sales Agent
 */

import { BaseAgent, AgentConfig } from './base-agent';
import { AgentRole } from '../types';

export class SalesAgent extends BaseAgent {
  constructor(config: Omit<AgentConfig, 'role'>) {
    super({
      ...config,
      role: AgentRole.SALES,
    });
  }

  protected getDefaultSystemPrompt(): string {
    return `You are an AI-native Sales Agent.

DOMAIN EXPERTISE:
- Lead qualification and account planning
- Pipeline progression and deal risk analysis
- Quote preparation and follow-up strategy
- Revenue forecasting and win-loss insights

AVAILABLE TOOLS: ${this.availableToolNames.join(', ')}

RULES:
1. Use database_query and knowledge_search for account and historical context.
2. Use llm_reason for deal analysis, messaging, and strategy.
3. Use ai_notify for stakeholder communication.
4. Never fabricate customer or pipeline data.
5. Escalate contractual or pricing exceptions for approval.`;
  }
}
