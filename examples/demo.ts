/**
 * Example Application: IntentOS Demo
 * Demonstrates key features and usage patterns
 */

import { createIntentOS, UserRole, TaskStatus } from './index';

async function demo() {
  console.log('🚀 IntentOS - AI-Native Enterprise Workflow Engine Demo\n');

  // ============================================================================
  // 1. Initialize System
  // ============================================================================
  console.log('📦 Initializing IntentOS...');
  const intentOS = createIntentOS({
    llm: {
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 4000,
    },
  });
  console.log('✅ System initialized\n');

  // ============================================================================
  // 2. User Management & Security
  // ============================================================================
  console.log('👥 Setting up users...');
  const securityManager = intentOS.getSecurityManager();

  // Register employees
  const employee = await securityManager.registerUser(
    'alice_engineer',
    'alice@company.com',
    'secure_password',
    UserRole.EMPLOYEE,
    'Engineering'
  );

  const manager = await securityManager.registerUser(
    'bob_manager',
    'bob@company.com',
    'secure_password',
    UserRole.MANAGER,
    'Engineering'
  );

  console.log(`✅ Registered employee: ${employee.username}`);
  console.log(`✅ Registered manager: ${manager.username}\n`);

  // ============================================================================
  // 3. Scenario 1: HR - Leave Request
  // ============================================================================
  console.log('📝 Scenario 1: Employee Leave Request');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const leaveRequest = await intentOS.processIntent(
    employee.id,
    'I need to take 5 days off starting next Monday for a family trip'
  );

  console.log(`Intent: ${leaveRequest.intent.extractedIntent}`);
  console.log(`Confidence: ${leaveRequest.intent.confidence}`);
  console.log(`Entities:`, leaveRequest.intent.entities);

  if (leaveRequest.followUpQuestions && leaveRequest.followUpQuestions.length > 0) {
    console.log('❓ Follow-up questions:', leaveRequest.followUpQuestions);
  } else {
    console.log(`Workflow ID: ${leaveRequest.workflow.id}`);
    const execution1 = await intentOS.executeWorkflow(leaveRequest.workflow.id);
    console.log(`Execution status: ${execution1.status}\n`);
  }

  // ============================================================================
  // 4. Scenario 2: Finance - Expense Submission
  // ============================================================================
  console.log('💰 Scenario 2: Expense Submission');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const expenseRequest = await intentOS.processIntent(
    employee.id,
    'I need to submit an expense for $850 for conference tickets and travel'
  );

  console.log(`Intent: ${expenseRequest.intent.extractedIntent}`);
  console.log(`Entities:`, expenseRequest.intent.entities);
  console.log(`Workflow ID: ${expenseRequest.workflow.id}`);

  const execution2 = await intentOS.executeWorkflow(expenseRequest.workflow.id);
  console.log(`Execution status: ${execution2.status}`);

  // Check if approval is needed
  const approvals = intentOS.getApprovalSystem().getPendingApprovals(expenseRequest.workflow.id);
  if (approvals.length > 0) {
    console.log(`⏳ Waiting for approval: ${approvals[0].description}`);
    console.log(`   Risk level: ${approvals[0].riskLevel}`);

    // Generate confirmation card
    const card = intentOS.getApprovalSystem().generateConfirmationCard(approvals[0]);
    console.log(`   Confirmation card:`, JSON.stringify(card, null, 2));

    // Manager approves
    await intentOS.handleApproval(approvals[0].id, manager.id, 'approve', 'Approved - valid expense');
    console.log(`✅ Expense approved by ${manager.username}\n`);
  }

  // ============================================================================
  // 5. Scenario 3: Legal - Contract Review
  // ============================================================================
  console.log('⚖️  Scenario 3: Contract Review');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const contractReview = await intentOS.processIntent(
    manager.id,
    'Review the vendor contract with Acme Corp for potential risks'
  );

  console.log(`Intent: ${contractReview.intent.extractedIntent}`);
  console.log(`Workflow ID: ${contractReview.workflow.id}`);

  const execution3 = await intentOS.executeWorkflow(contractReview.workflow.id);
  console.log(`Execution status: ${execution3.status}\n`);

  // ============================================================================
  // 6. Memory System - Knowledge Graph
  // ============================================================================
  console.log('🧠 Memory System Demo');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const memorySystem = intentOS.getMemorySystem();

  // Store organizational context
  const empId = await memorySystem.storeOrganizationalContext('employee', {
    name: employee.username,
    email: employee.email,
    department: employee.department,
    role: 'Software Engineer',
  });

  const deptId = await memorySystem.storeOrganizationalContext('department', {
    name: 'Engineering',
    budget: 500000,
    headCount: 25,
  });

  // Create relationship
  await memorySystem.createRelationship(empId, deptId, 'WORKS_IN');
  console.log('✅ Stored employee and department in knowledge graph');

  // Store interaction memory
  await memorySystem.store('Employee submitted expense claim for conference', {
    userId: employee.id,
    type: 'expense',
    amount: 850,
    timestamp: new Date().toISOString(),
  });

  // Retrieve relevant context
  const context = await memorySystem.getRelevantContext(
    employee.id,
    'What are my recent expenses?'
  );
  console.log(`Retrieved ${context.relevantMemories.length} relevant memories\n`);

  // ============================================================================
  // 7. System Metrics (CLEAR Framework)
  // ============================================================================
  console.log('📊 System Metrics (CLEAR Framework)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const metrics = intentOS.getSystemMetrics();
  console.log('Workflows:');
  console.log(`  Total: ${metrics.workflows.total}`);
  console.log(`  Active: ${metrics.workflows.active}`);
  console.log(`  Completed: ${metrics.workflows.completed}`);
  console.log(`  Failed: ${metrics.workflows.failed}`);

  console.log('\nAgent Metrics:');
  metrics.agents.forEach((agent) => {
    console.log(`  ${agent.role}:`);
    console.log(`    Tasks Completed: ${agent.metrics.efficacy?.tasksCompleted || 0}`);
    console.log(`    Success Rate: ${((agent.metrics.efficacy?.successRate || 0) * 100).toFixed(1)}%`);
    console.log(`    Total Duration: ${agent.metrics.latency?.totalDurationMs || 0}ms`);
  });

  console.log(`\nPending Approvals: ${metrics.pendingApprovals}\n`);

  // ============================================================================
  // 8. Workflow Status & Checkpointing
  // ============================================================================
  console.log('💾 Workflow Persistence Demo');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const workflowMachine = intentOS.getWorkflowStateMachine();
  const workflowStatus = intentOS.getWorkflowStatus(expenseRequest.workflow.id);

  console.log('Workflow Statistics:');
  console.log(`  Total tasks: ${workflowStatus.stats?.total || 0}`);
  console.log(`  Completed: ${workflowStatus.stats?.completed || 0}`);
  console.log(`  In Progress: ${workflowStatus.stats?.inProgress || 0}`);
  console.log(`  Pending: ${workflowStatus.stats?.pending || 0}`);

  const workflow = workflowMachine.getWorkflow(expenseRequest.workflow.id);
  if (workflow) {
    console.log(`\nCheckpoints: ${workflow.checkpoints.length}`);
    console.log('✅ Workflow state persisted for disaster recovery\n');
  }

  // ============================================================================
  // 9. Security & Permissions
  // ============================================================================
  console.log('🔐 Security & Permissions Demo');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const hasPermission = securityManager.hasPermission(employee.id, 'workflows', 'create');
  console.log(`Employee can create workflows: ${hasPermission}`);

  const hrPermissions = securityManager.getAgentPermissions('hr' as any);
  console.log(`\nHR Agent permissions:`);
  console.log(`  Allowed tools: ${hrPermissions.allowedTools.join(', ')}`);
  console.log(`  Max budget: $${hrPermissions.maxBudget}`);
  console.log(`  Can approve up to: $${hrPermissions.canApproveUp}`);

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n🎉 Demo Complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('IntentOS demonstrated:');
  console.log('✓ Natural language intent processing');
  console.log('✓ Multi-agent workflow execution (HR, Finance, Legal)');
  console.log('✓ Human-in-the-loop approvals');
  console.log('✓ Knowledge graph memory system');
  console.log('✓ CLEAR framework metrics');
  console.log('✓ Workflow persistence & checkpointing');
  console.log('✓ Enterprise-grade security & RBAC');
  console.log('\nThe future of enterprise software is conversational! 🚀\n');
}

// Run demo
if (require.main === module) {
  demo().catch((error) => {
    console.error('Error running demo:', error);
    process.exit(1);
  });
}

export { demo };
