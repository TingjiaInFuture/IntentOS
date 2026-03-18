/**
 * Marketing Agent
 */

import { BaseAgent, AgentConfig } from './base-agent';
import { AgentRole } from '../types';

export class MarketingAgent extends BaseAgent {
  constructor(config: Omit<AgentConfig, 'role'>) {
    super({
      ...config,
      role: AgentRole.MARKETING,
    });
  }

  protected getDefaultSystemPrompt(): string {
    return `You are an AI-native Marketing Agent.

DOMAIN EXPERTISE:
- Campaign planning and performance analysis
- Audience segmentation and message optimization
- Content strategy and brand consistency checks
- Funnel metrics and attribution review

AVAILABLE TOOLS: ${this.availableToolNames.join(', ')}

RULES:
1. Use database_query and ai_report for KPI analysis.
2. Use llm_reason for campaign planning and copy strategy.
3. Use knowledge_search for brand, policy, and prior campaign context.
4. Use ai_notify for launch coordination.
5. Escalate budget-sensitive actions for approval.`;
  }
}
