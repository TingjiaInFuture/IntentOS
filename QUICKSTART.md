# Quick Start Guide

Get up and running with IntentOS in 5 minutes!

## Prerequisites

- Node.js 18+ and npm
- (Optional) PostgreSQL, Neo4j, and Pinecone for production use

## Installation

```bash
# Clone the repository
git clone https://github.com/TingjiaInFuture/IntentOS.git
cd IntentOS

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
```

## Configuration

Edit `.env` with your settings:

```bash
# For development, you can use mock implementations
NODE_ENV=development

# For production, add your API keys
OPENAI_API_KEY=your_key_here
DATABASE_URL=postgresql://user:password@localhost:5432/intentos
NEO4J_URI=bolt://localhost:7687
JWT_SECRET=your_secure_secret
```

## Build

```bash
npm run build
```

## Run the Demo

```bash
npm run dev
```

This will run the comprehensive demo showing:
- User registration and authentication
- HR workflow (leave request)
- Finance workflow (expense submission with approval)
- Legal workflow (contract review)
- Memory system with knowledge graph
- System metrics and monitoring

## Basic Usage

### 1. Initialize IntentOS

```typescript
import { createIntentOS, UserRole } from 'intentos';

const intentOS = createIntentOS({
  llm: {
    provider: 'openai',
    model: 'gpt-4',
    temperature: 0.7,
  },
});
```

### 2. Register Users

```typescript
const securityManager = intentOS.getSecurityManager();

const employee = await securityManager.registerUser(
  'alice',
  'alice@company.com',
  'password123',
  UserRole.EMPLOYEE,
  'Engineering'
);

const manager = await securityManager.registerUser(
  'bob',
  'bob@company.com',
  'password123',
  UserRole.MANAGER,
  'Engineering'
);
```

### 3. Process Natural Language Intents

```typescript
// Employee submits expense
const result = await intentOS.processIntent(
  employee.id,
  'I need to submit an expense for $500 for a conference ticket'
);

console.log('Intent:', result.intent.extractedIntent);
console.log('Workflow ID:', result.workflow.id);
```

### 4. Execute Workflows

```typescript
// Execute the workflow
const execution = await intentOS.executeWorkflow(result.workflow.id);

if (execution.status === 'WAITING_APPROVAL') {
  // Get pending approvals
  const approvals = intentOS.getApprovalSystem()
    .getPendingApprovals(result.workflow.id);

  // Manager approves
  await intentOS.handleApproval(
    approvals[0].id,
    manager.id,
    'approve',
    'Approved - valid expense'
  );
}
```

### 5. Check Status

```typescript
const status = intentOS.getWorkflowStatus(result.workflow.id);
console.log('Tasks:', status.stats);
console.log('Status:', status.workflow?.status);
```

### 6. View Metrics

```typescript
const metrics = intentOS.getSystemMetrics();
console.log('Active workflows:', metrics.workflows.active);
console.log('Agent performance:', metrics.agents);
```

## Common Scenarios

### HR: Leave Request

```typescript
await intentOS.processIntent(
  userId,
  'I want to take 3 days off next week for vacation'
);
```

### Finance: Budget Allocation

```typescript
await intentOS.processIntent(
  userId,
  'Allocate $50,000 to the marketing department for Q2'
);
```

### Legal: Contract Review

```typescript
await intentOS.processIntent(
  userId,
  'Review the vendor contract with Acme Corp for legal risks'
);
```

## Advanced Features

### Custom Tools

```typescript
import { z } from 'zod';

const customTool = {
  name: 'send_sms',
  description: 'Send SMS notification',
  parameters: z.object({
    phone: z.string(),
    message: z.string(),
  }),
  execute: async (params) => {
    // Your implementation
    console.log(`Sending SMS to ${params.phone}: ${params.message}`);
    return { sent: true };
  },
};

intentOS.getToolRegistry().register(customTool);
```

### Memory System

```typescript
const memory = intentOS.getMemorySystem();

// Store organizational data
await memory.storeOrganizationalContext('employee', {
  name: 'John Doe',
  department: 'Engineering',
  skills: ['TypeScript', 'React'],
});

// Retrieve relevant context
const context = await memory.getRelevantContext(
  userId,
  'Who are the TypeScript developers?'
);
```

### Workflow Persistence

```typescript
const workflow = intentOS.getWorkflowStateMachine();

// Create checkpoint
const checkpoint = workflow.createCheckpoint(workflowId);

// Restore after crash
const restored = workflow.restoreFromCheckpoint(checkpoint.id);
```

## Testing

```bash
# Run tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test
npm test -- intent
```

## Linting and Formatting

```bash
# Lint code
npm run lint

# Format code
npm run format
```

## Troubleshooting

### Issue: "Module not found"
**Solution**: Run `npm install` to install dependencies.

### Issue: "JWT secret not configured"
**Solution**: Set `JWT_SECRET` in your `.env` file.

### Issue: "Cannot connect to database"
**Solution**: For development, IntentOS uses in-memory implementations. For production, ensure PostgreSQL/Neo4j are running.

### Issue: "LLM API key missing"
**Solution**: In development mode, mock extractors are used. For production, add your `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` to `.env`.

## Next Steps

1. Read the [Architecture Documentation](docs/ARCHITECTURE.md)
2. Explore the [Example Demo](examples/demo.ts)
3. Review the [Implementation Summary](IMPLEMENTATION.md)
4. Check [Contributing Guidelines](CONTRIBUTING.md)

## Getting Help

- Open an issue on GitHub
- Check the documentation in the `docs/` folder
- Review example code in `examples/`

## Production Deployment

For production deployment:

1. Set up PostgreSQL for workflow persistence
2. Configure Neo4j for knowledge graph
3. Add vector database (Pinecone/Milvus)
4. Configure real LLM provider (OpenAI/Anthropic)
5. Set up monitoring and logging
6. Use environment-specific configs
7. Enable HTTPS and secure secrets

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed deployment guidance.

---

**Ready to build the future of enterprise software!** 🚀
