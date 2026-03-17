# IntentOS - AI-Native Enterprise Workflow Engine

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)

**IntentOS** is a revolutionary AI-native enterprise workflow engine that completely abandons traditional form-based systems. It's an intent-driven, "Agentic Enterprise OS" that enables natural language interaction for business operations.

## 🎯 Vision

Completely move away from the rigid "people adapt to systems, revolving around forms" mode of traditional ERP/CRM era, and create a "form-less, de-fixed-process", intent-driven intelligent agent native enterprise general management system.

## ✨ Core Features

### 1. 🤖 Multi-Agent Business Matrix (Breaking Down System Silos)

Completely abandons the traditional software's segregated "finance module" and "HR module" model. The system consists of a cross-departmental Agent matrix (HR Agent, Legal Agent, Finance Agent, etc.). Employees only need to express business goals in natural language, without jumping across multiple software applications to fill forms.

**Available Agents:**
- **HR Agent**: Handles hiring, leave requests, performance reviews
- **Finance Agent**: Manages expenses, budgets, invoicing, payments
- **Legal Agent**: Reviews contracts, compliance checks, risk assessments

### 2. 🔄 Adaptive Task Nodes (Dynamic Workflows)

Each Agent's task nodes can dynamically adjust based on actual task and environment conditions. Uses the **"Plan-and-Solve"** architecture pattern:

- **Plan Phase**: Generate execution plan based on goals and context
- **Execute Phase**: Execute plan step by step with continuous monitoring
- **Reflect Phase**: Analyze results and decide if replanning is needed

When encountering obstacles (budget overruns, process bottlenecks), Agents autonomously reflect and dynamically rewrite subsequent action trees and task nodes to find optimal paths.

### 3. 💬 Invisible Structuring & Dynamic Knowledge Graph (Form-less UI)

Abandons the outdated model where "employees manually fill forms to collect structured data":

- **Invisible Forms & Intent Extraction**: Information comes directly from natural language (voice, text, files). LLM structured outputs automatically extract and map to database fields.
- **Conversational Completion**: When missing necessary information, Agents naturally guide users through multi-turn conversations.
- **Dynamic Business Knowledge Graph**: Extracted structured data is stored in both traditional databases and real-time GraphRAG (knowledge graph), ensuring every planning decision is based on 100% accurate enterprise state.

### 4. 🔒 Enterprise-Grade Security & Reliability

Not a black-box chatbot, but a highly deterministic workflow engine:

- **Security**: Human-in-the-Loop (HITL) for sensitive operations, strict RBAC for agent permissions
- **Reliability**: State Machine with real-time checkpointing for persistence. Workflow states never lost due to server crashes or LLM hallucinations, supporting checkpoint resumption.
- **Assurance**: Policy compliance checks, security validation at every critical step

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        IntentOS Orchestrator                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  HR Agent    │  │Finance Agent │  │ Legal Agent  │         │
│  │              │  │              │  │              │         │
│  │ Plan-Solve   │  │ Plan-Solve   │  │ Plan-Solve   │  ...   │
│  │ Architecture │  │ Architecture │  │ Architecture │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Intent Extraction  │  Workflow State  │  Memory System         │
│  (Structured Output)│  Machine         │  (RAG + GraphRAG)      │
│                     │  (Checkpointing) │                        │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Tool Registry      │  Approval System │  Security Manager      │
│  (External APIs)    │  (Human-in-Loop) │  (RBAC)                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Installation

```bash
npm install intentos
```

### Basic Usage

```typescript
import { createIntentOS, UserRole } from 'intentos';

// Create IntentOS instance
const intentOS = createIntentOS({
  llm: {
    provider: 'openai',
    model: 'gpt-4',
    temperature: 0.7,
  },
});

// Register a user
const securityManager = intentOS.getSecurityManager();
const user = await securityManager.registerUser(
  'john_doe',
  'john@example.com',
  'password',
  UserRole.EMPLOYEE
);

// Process natural language intent
const result = await intentOS.processIntent(
  user.id,
  'I need to submit an expense for $250 for a client dinner'
);

// Execute workflow
const execution = await intentOS.executeWorkflow(result.workflow.id);

// Check status
const status = intentOS.getWorkflowStatus(result.workflow.id);
console.log('Workflow status:', status);
```

## 📋 Use Cases

### HR: Employee Leave Request

```typescript
const result = await intentOS.processIntent(
  userId,
  'I need to take 3 days off next week for a family vacation'
);

// Agent automatically:
// 1. Validates leave balance
// 2. Checks team coverage
// 3. Gets manager approval
// 4. Updates leave management system
// 5. Syncs calendar
```

### Finance: Expense Submission

```typescript
const result = await intentOS.processIntent(
  userId,
  'I spent $350 on office supplies, here is the receipt'
);

// Agent automatically:
// 1. Validates receipt
// 2. Checks policy compliance
// 3. Verifies budget availability
// 4. Routes for approval if needed
// 5. Processes payment
// 6. Updates accounting records
```

### Legal: Contract Review

```typescript
const result = await intentOS.processIntent(
  userId,
  'Review this vendor contract for potential risks'
);

// Agent automatically:
// 1. Extracts contract terms
// 2. Identifies legal risks
// 3. Checks regulatory compliance
// 4. Generates risk assessment
// 5. Recommends modifications
```

## 🔧 Configuration

Create a `.env` file:

```bash
# LLM Configuration
OPENAI_API_KEY=your_key_here
LLM_MODEL=gpt-4
EMBEDDING_MODEL=text-embedding-3-small

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/intentos

# Vector Store
VECTOR_STORE_PROVIDER=pinecone # or milvus
PINECONE_API_KEY=your_key_here
PINECONE_INDEX=intentos-memory
PINECONE_NAMESPACE=intentos
MILVUS_ADDRESS=localhost:19530
MILVUS_COLLECTION=intentos_memory

# Graph Database (Neo4j)
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password

# Enterprise Tool Integrations
SALESFORCE_INSTANCE_URL=https://your-instance.my.salesforce.com
SALESFORCE_ACCESS_TOKEN=your_salesforce_token
SAP_BASE_URL=https://your-sap-endpoint
SAP_USERNAME=your_sap_user
SAP_PASSWORD=your_sap_password
RPA_API_ENDPOINT=https://your-rpa-endpoint
RPA_API_KEY=your_rpa_key
SLACK_BOT_TOKEN=xoxb-...

# Security
JWT_SECRET=your_secret_key
JWT_EXPIRY=24h

# Application
NODE_ENV=production
PORT=3000
```

## 📊 CLEAR Framework Metrics

IntentOS implements the CLEAR framework for evaluating agent performance:

- **Cost**: Token usage and compute resource tracking
- **Latency**: Response time monitoring (planning, execution, total)
- **Efficacy**: Success rate and goal achievement tracking
- **Assurance**: Policy compliance and security checks
- **Reliability**: Consistency scoring and error tracking

```typescript
const metrics = intentOS.getSystemMetrics();
console.log(metrics.agents); // Per-agent metrics
```

## 🔐 Security & Permissions

### User Roles

- **ADMIN**: Full system access
- **MANAGER**: Workflow management, approvals, reporting
- **EMPLOYEE**: Create and interact with workflows
- **GUEST**: Read-only access

### Agent Permissions

Each agent has specific tool permissions and budget limits:

```typescript
// HR Agent can approve up to $10k
// Finance Agent can process up to $100k
// Legal Agent cannot execute payments
```

### Human-in-the-Loop

High-risk operations automatically require human approval:

```typescript
const approvals = intentOS.getApprovalSystem().getPendingApprovals();

// Approve or reject
await intentOS.handleApproval(approvalId, reviewerId, 'approve', 'Looks good');
```

## 🧠 Memory System

IntentOS combines two memory approaches:

### 1. Vector Store (RAG)
- Semantic search for relevant past interactions
- Fast retrieval of similar cases

### 2. Knowledge Graph (GraphRAG)
- Structured organizational context
- Entity relationships (employees, departments, projects)
- Graph-based reasoning

```typescript
const memorySystem = intentOS.getMemorySystem();

// Store organizational context
await memorySystem.storeOrganizationalContext('employee', {
  name: 'John Doe',
  department: 'Engineering',
  role: 'Senior Engineer',
});

// Query context
const context = await memorySystem.getRelevantContext(userId, taskDescription);
```

## 🛠️ Tool Integration

IntentOS includes built-in tools for common operations:

- **Database Operations**: SQL queries
- **HTTP Requests**: External API integration
- **Email**: Send notifications
- **Calendar**: Schedule events
- **Document Processing**: Extract and analyze documents
- **File System**: Read/write files
- **Slack**: Team notifications
- **CRM**: Customer data management
- **Payment Processing**: Financial transactions

Add custom tools:

```typescript
import { z } from 'zod';

const customTool = {
  name: 'custom_api',
  description: 'Call custom API',
  parameters: z.object({
    endpoint: z.string(),
    data: z.record(z.any()),
  }),
  execute: async (params) => {
    // Your implementation
    return { success: true };
  },
};

intentOS.getToolRegistry().register(customTool);
```

## 📈 Workflow State Machine

Persistent workflow execution with checkpointing:

```typescript
const workflow = intentOS.getWorkflowStateMachine();

// Create workflow
const wf = workflow.createWorkflow(intentId, context);

// Add tasks
workflow.addTask(wf.id, 'Validate expense', 'validation', {
  priority: TaskPriority.HIGH,
  assignedAgent: AgentRole.FINANCE,
});

// Update status
workflow.updateTaskStatus(wf.id, taskId, TaskStatus.COMPLETED, { result: 'valid' });

// Create checkpoint
const checkpoint = workflow.createCheckpoint(wf.id);

// Restore from checkpoint (disaster recovery)
const restored = workflow.restoreFromCheckpoint(checkpoint.id);
```

## 🧪 Testing

```bash
npm test
```

## 📦 Building

```bash
npm run build
```

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests.

## 📄 License

Apache License 2.0 - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Built on cutting-edge AI agent research:
- Plan-and-Solve prompting strategies
- ReAct (Reasoning + Acting) pattern
- Structured outputs for reliable extraction
- GraphRAG for knowledge management
- CLEAR framework for agent evaluation

## 📚 References

- **AI Agent Architecture**: Multi-agent systems with reasoning, memory, planning, and tool use
- **CLEAR Framework**: Comprehensive agent evaluation (Cost, Latency, Efficacy, Assurance, Reliability)
- **GraphRAG**: Knowledge graph-based retrieval augmented generation
- **Human-in-the-Loop**: Critical for enterprise-grade AI systems

## 🗺️ Roadmap

- [ ] Multi-modal input support (voice, images)
- [ ] Agent collaboration and negotiation
- [ ] Advanced workflow visualization
- [ ] Custom agent creation framework
- [ ] Integration marketplace
- [ ] Real-time monitoring dashboard
- [ ] Multi-tenant support
- [ ] Advanced analytics and insights

## 💬 Support

For questions and support, please open an issue on GitHub.

---

**IntentOS** - The future of enterprise software is conversational, adaptive, and intelligent.
