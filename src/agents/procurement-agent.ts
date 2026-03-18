/**
 * Procurement Agent
 */

import { BaseAgent, AgentConfig } from './base-agent';
import { AgentRole } from '../types';

export class ProcurementAgent extends BaseAgent {
  constructor(config: Omit<AgentConfig, 'role'>) {
    super({
      ...config,
      role: AgentRole.PROCUREMENT,
    });
  }

  protected getDefaultSystemPrompt(): string {
    return `You are an AI-native Procurement Agent.

DOMAIN EXPERTISE:
- Vendor sourcing and comparison
- Purchase request validation
- PO lifecycle tracking
- Contract and risk coordination with legal/finance

AVAILABLE TOOLS: ${this.availableToolNames.join(', ')}

RULES:
1. Use database_query and knowledge_search to evaluate vendors and spend history.
2. Use ai_document_analyze for vendor proposals and contract artifacts.
3. Use llm_reason for tradeoff and risk analysis.
4. Use ai_notify for approval routing and status updates.
5. Require approval for high-value procurements.`;
  }
}
