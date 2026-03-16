/**
 * Human-in-the-Loop Approval System
 * Manages approval workflows for high-risk or sensitive operations
 */

import { v4 as uuidv4 } from 'uuid';
import { ApprovalRequest, ConfirmationCard, AgentRole } from '../types';

export class ApprovalSystem {
  private pendingApprovals: Map<string, ApprovalRequest>;
  private approvalHandlers: Map<string, (request: ApprovalRequest) => Promise<void>>;

  constructor() {
    this.pendingApprovals = new Map();
    this.approvalHandlers = new Map();
  }

  /**
   * Create an approval request
   */
  async createApprovalRequest(
    workflowId: string,
    taskId: string,
    requestedBy: AgentRole,
    description: string,
    data: Record<string, any>,
    riskLevel: 'low' | 'medium' | 'high' | 'critical',
    deadline?: Date
  ): Promise<ApprovalRequest> {
    const request: ApprovalRequest = {
      id: uuidv4(),
      workflowId,
      taskId,
      requestedBy,
      description,
      data,
      riskLevel,
      deadline,
      status: 'pending',
    };

    this.pendingApprovals.set(request.id, request);

    // Trigger notification handlers
    await this.notifyApprovers(request);

    return request;
  }

  /**
   * Generate a confirmation card for UI display
   */
  generateConfirmationCard(request: ApprovalRequest): ConfirmationCard {
    const card: ConfirmationCard = {
      title: request.description,
      description: `Approval requested by ${request.requestedBy} agent`,
      fields: Object.entries(request.data).map(([key, value]) => ({
        label: this.formatFieldLabel(key),
        value,
        type: this.inferFieldType(value),
      })),
      actions: [
        {
          label: 'Approve',
          action: 'approve',
          variant: 'primary',
        },
        {
          label: 'Reject',
          action: 'reject',
          variant: 'danger',
        },
        {
          label: 'Modify',
          action: 'modify',
          variant: 'secondary',
        },
      ],
      riskLevel: request.riskLevel,
    };

    return card;
  }

  /**
   * Approve a request
   */
  async approve(
    requestId: string,
    reviewerId: string,
    comments?: string
  ): Promise<ApprovalRequest> {
    const request = this.pendingApprovals.get(requestId);
    if (!request) {
      throw new Error(`Approval request ${requestId} not found`);
    }

    if (request.status !== 'pending') {
      throw new Error(`Approval request ${requestId} has already been ${request.status}`);
    }

    request.status = 'approved';
    request.reviewedBy = reviewerId;
    request.reviewedAt = new Date();
    request.comments = comments;

    this.pendingApprovals.set(requestId, request);

    // Notify workflow to continue
    await this.notifyWorkflowContinue(request);

    return request;
  }

  /**
   * Reject a request
   */
  async reject(
    requestId: string,
    reviewerId: string,
    reason: string
  ): Promise<ApprovalRequest> {
    const request = this.pendingApprovals.get(requestId);
    if (!request) {
      throw new Error(`Approval request ${requestId} not found`);
    }

    if (request.status !== 'pending') {
      throw new Error(`Approval request ${requestId} has already been ${request.status}`);
    }

    request.status = 'rejected';
    request.reviewedBy = reviewerId;
    request.reviewedAt = new Date();
    request.comments = reason;

    this.pendingApprovals.set(requestId, request);

    // Notify workflow to handle rejection
    await this.notifyWorkflowRejection(request);

    return request;
  }

  /**
   * Modify and approve a request
   */
  async modifyAndApprove(
    requestId: string,
    reviewerId: string,
    modifiedData: Record<string, any>,
    comments?: string
  ): Promise<ApprovalRequest> {
    const request = this.pendingApprovals.get(requestId);
    if (!request) {
      throw new Error(`Approval request ${requestId} not found`);
    }

    request.data = { ...request.data, ...modifiedData };
    return this.approve(requestId, reviewerId, comments);
  }

  /**
   * Get pending approvals for a specific workflow
   */
  getPendingApprovals(workflowId?: string): ApprovalRequest[] {
    const approvals = Array.from(this.pendingApprovals.values()).filter(
      (a) => a.status === 'pending'
    );

    if (workflowId) {
      return approvals.filter((a) => a.workflowId === workflowId);
    }

    return approvals;
  }

  /**
   * Get approval by ID
   */
  getApproval(requestId: string): ApprovalRequest | undefined {
    return this.pendingApprovals.get(requestId);
  }

  /**
   * Register a handler for approval notifications
   */
  registerApprovalHandler(
    handlerId: string,
    handler: (request: ApprovalRequest) => Promise<void>
  ): void {
    this.approvalHandlers.set(handlerId, handler);
  }

  /**
   * Notify approvers about new request
   */
  private async notifyApprovers(request: ApprovalRequest): Promise<void> {
    for (const handler of this.approvalHandlers.values()) {
      try {
        await handler(request);
      } catch (error) {
        console.error('Error in approval handler:', error);
      }
    }
  }

  /**
   * Notify workflow to continue after approval
   */
  private async notifyWorkflowContinue(request: ApprovalRequest): Promise<void> {
    // In production, this would emit events or use message queue
    console.log(`Workflow ${request.workflowId} approved, continuing...`);
  }

  /**
   * Notify workflow about rejection
   */
  private async notifyWorkflowRejection(request: ApprovalRequest): Promise<void> {
    // In production, this would emit events or use message queue
    console.log(`Workflow ${request.workflowId} rejected: ${request.comments}`);
  }

  /**
   * Format field label for display
   */
  private formatFieldLabel(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  }

  /**
   * Infer field type from value
   */
  private inferFieldType(value: any): 'text' | 'number' | 'currency' | 'date' | 'boolean' {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (value instanceof Date) return 'date';
    if (typeof value === 'string') {
      // Check if it's a currency
      if (/^\$?\d+(\.\d{2})?$/.test(value)) return 'currency';
      // Check if it's a date
      if (!isNaN(Date.parse(value))) return 'date';
    }
    return 'text';
  }

  /**
   * Check if approval is overdue
   */
  isOverdue(requestId: string): boolean {
    const request = this.pendingApprovals.get(requestId);
    if (!request || !request.deadline || request.status !== 'pending') {
      return false;
    }

    return new Date() > request.deadline;
  }

  /**
   * Get overdue approvals
   */
  getOverdueApprovals(): ApprovalRequest[] {
    return Array.from(this.pendingApprovals.values()).filter(
      (request) => this.isOverdue(request.id)
    );
  }
}
