# Architecture Overview

## System Architecture

IntentOS is built with a modular, layered architecture designed for enterprise-grade reliability and scalability.

```
┌───────────────────────────────────────────────────────────────────┐
│                     User Interface Layer                          │
│                  (Natural Language Interface)                     │
└───────────────────────────────────────────────────────────────────┘
                              ↓
┌───────────────────────────────────────────────────────────────────┐
│                    Orchestration Layer                            │
│                      (IntentOS Core)                              │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐    │
│  │   Intent    │  │   Workflow   │  │   Agent Manager     │    │
│  │  Extractor  │→│State Machine │→│  (Plan-Solve Loop)  │    │
│  └─────────────┘  └──────────────┘  └─────────────────────┘    │
└───────────────────────────────────────────────────────────────────┘
                              ↓
┌───────────────────────────────────────────────────────────────────┐
│                      Agent Layer                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │HR Agent  │  │Finance   │  │Legal     │  │Operations│  ...   │
│  │          │  │Agent     │  │Agent     │  │Agent     │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└───────────────────────────────────────────────────────────────────┘
                              ↓
┌───────────────────────────────────────────────────────────────────┐
│                    Infrastructure Layer                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │Memory    │  │Security  │  │Approval  │  │Tool      │        │
│  │System    │  │Manager   │  │System    │  │Registry  │        │
│  │(RAG+Graph)│  │(RBAC)   │  │(HITL)    │  │          │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└───────────────────────────────────────────────────────────────────┘
                              ↓
┌───────────────────────────────────────────────────────────────────┐
│                    External Systems                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │Database  │  │Vector DB │  │Graph DB  │  │External  │        │
│  │(PostgreSQL)  │(Pinecone)│  │(Neo4j)   │  │APIs      │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└───────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Intent Extractor

**Purpose**: Convert natural language to structured data

**Key Features**:
- Structured output using LLM JSON mode
- Multi-turn conversation for missing information
- Context-aware extraction using user history
- Confidence scoring

**Flow**:
```
User Input → LLM (Structured Output) → Intent Object
              ↓                            ↓
        Context Enrichment          Validation
              ↓                            ↓
        Follow-up Questions?          Complete?
```

### 2. Workflow State Machine

**Purpose**: Manage workflow execution and persistence

**Key Features**:
- Task dependency management
- Automatic checkpointing
- State recovery
- Status tracking

**States**:
- PENDING: Task waiting to start
- IN_PROGRESS: Currently executing
- WAITING_APPROVAL: Paused for human review
- APPROVED: Approved, ready to continue
- COMPLETED: Successfully finished
- FAILED: Error occurred
- CANCELLED: User cancelled

### 3. Agent Architecture (Plan-and-Solve)

**Purpose**: Autonomous task execution with adaptive planning

**Phases**:

1. **Plan Phase**:
   ```typescript
   Goal → Analyze Context → Generate Plan Steps
                               ↓
                     [Step 1, Step 2, Step 3, ...]
   ```

2. **Execute Phase**:
   ```typescript
   For each step:
     Check Dependencies → Execute → Capture Results
                            ↓
                     Tool Execution
   ```

3. **Reflect Phase**:
   ```typescript
   Analyze Result → Identify Issues? → Replan if needed
                         ↓                    ↓
                    Continue            Generate New Plan
   ```

### 4. Memory System

**Purpose**: Maintain context and organizational knowledge

**Components**:

1. **Vector Store (RAG)**:
   - Semantic search for past interactions
   - Fast retrieval based on similarity
   - Stores conversation history, decisions, outcomes

2. **Knowledge Graph (GraphRAG)**:
   - Structured organizational data
   - Entity relationships (employees, departments, projects)
   - Graph traversal for context expansion

**Query Flow**:
```
User Query → Vector Search (Top K similar)
               ↓
         Extract Entity IDs
               ↓
         Graph Expansion (Neighbors)
               ↓
    Combined Context → Agent
```

### 5. Approval System (Human-in-the-Loop)

**Purpose**: Human oversight for critical operations

**Triggers**:
- High-value transactions (> threshold)
- Sensitive operations (delete, terminate)
- High-risk decisions
- Policy-required approvals

**Flow**:
```
Agent Action → Risk Assessment → Requires Approval?
                                      ↓ Yes
                              Generate Confirmation Card
                                      ↓
                              Notify Approvers
                                      ↓
                              Await Decision
                              ↓             ↓
                        Approved        Rejected
                              ↓             ↓
                      Continue Workflow  End/Replan
```

### 6. Security Manager (RBAC)

**Purpose**: Control access and permissions

**Layers**:

1. **User Authentication**:
   - JWT-based authentication
   - Password hashing (bcrypt)
   - Token expiration

2. **User Authorization**:
   - Role-based permissions (ADMIN, MANAGER, EMPLOYEE, GUEST)
   - Resource-action permissions
   - Dynamic permission management

3. **Agent Permissions**:
   - Tool access control
   - Budget limits
   - Action restrictions

### 7. Tool Registry

**Purpose**: Extensible tool integration

**Built-in Tools**:
- Database queries
- HTTP requests
- Email notifications
- Calendar management
- Document processing
- File operations
- Team chat (Slack)
- CRM operations
- Payment processing

**Custom Tools**:
```typescript
{
  name: string,
  description: string,
  parameters: ZodSchema,
  execute: (params) => Promise<result>
}
```

## Data Flow

### Example: Expense Submission

```
1. User Input
   "Submit expense for $500 conference ticket"

2. Intent Extraction
   Intent: "submit_expense"
   Entities: { amount: 500, category: "conference" }

3. Workflow Creation
   Create workflow with tasks:
   - Validate expense
   - Check policy compliance
   - Get approval
   - Process payment
   - Update records

4. Agent Execution (Finance Agent)
   Plan → [Validate, Check Policy, Request Approval]
   Execute → Run each step with tools
   Reflect → Check results, replan if needed

5. Approval (if needed)
   Amount > threshold → Create approval request
   Generate confirmation card
   Notify manager

6. Manager Approval
   Review confirmation card
   Approve/Reject/Modify

7. Continue Workflow
   Process payment using Payment Tool
   Update accounting system
   Notify employee

8. Complete
   Mark workflow as COMPLETED
   Store in memory for future reference
```

## Design Patterns

### 1. Plan-and-Solve Pattern
Enables adaptive execution where agents can replan when encountering obstacles.

### 2. State Machine Pattern
Ensures reliable workflow execution with clear state transitions and persistence.

### 3. Strategy Pattern
Different agents implement the same base interface with different strategies.

### 4. Observer Pattern
Approval system observes workflow events and triggers notifications.

### 5. Registry Pattern
Tools are registered centrally and retrieved by name.

### 6. Builder Pattern
Complex workflows are built incrementally through the state machine.

## Scalability Considerations

### Horizontal Scaling
- Stateless orchestrator (state in DB)
- Agent instances can be load balanced
- Tool execution can be distributed

### Vertical Scaling
- LLM caching to reduce latency
- Memory system indexing for fast retrieval
- Checkpoint compression for storage efficiency

### Database Strategy
- PostgreSQL for transactional data (workflows, tasks)
- Vector DB for semantic search (memories)
- Graph DB for relationships (org structure)

## Reliability Mechanisms

### 1. Checkpointing
- Automatic state persistence at intervals
- Manual checkpoints at critical points
- Recovery from last checkpoint on failure

### 2. Idempotency
- Tool executions designed to be retryable
- Workflow steps can be safely repeated
- Duplicate detection mechanisms

### 3. Error Handling
- Graceful degradation
- Automatic retries with backoff
- Human escalation for unrecoverable errors

### 4. Monitoring
- CLEAR metrics tracking
- Error rate monitoring
- Performance profiling

## Security Architecture

### Defense in Depth

1. **Authentication Layer**: JWT tokens, session management
2. **Authorization Layer**: RBAC, permission checks
3. **Agent Layer**: Tool restrictions, budget limits
4. **Approval Layer**: Human oversight for high-risk
5. **Audit Layer**: Complete activity logging

### Data Protection

- Sensitive data encryption at rest
- Secure communication (TLS)
- PII handling compliance
- Access logging and auditing

## Future Enhancements

1. **Multi-Modal Input**: Voice, image, video processing
2. **Agent Collaboration**: Inter-agent communication and negotiation
3. **Real-Time Dashboard**: Live workflow monitoring
4. **Custom Agent Builder**: No-code agent creation
5. **Advanced Analytics**: Predictive insights and recommendations
