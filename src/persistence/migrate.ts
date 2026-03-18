/**
 * Database migration - creates AI-native schema
 * Run with: npx ts-node src/persistence/migrate.ts
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Core business data
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'employee',
  department VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) UNIQUE NOT NULL,
  budget DECIMAL(15,2) DEFAULT 0,
  head_count INT DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Financial ledger
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,
  category VARCHAR(255),
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'USD',
  debit_account VARCHAR(255),
  credit_account VARCHAR(255),
  description TEXT,
  workflow_id VARCHAR(255),
  approved_by VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Leave management
CREATE TABLE IF NOT EXISTS leave_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id),
  leave_type VARCHAR(50) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days INT NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  approved_by VARCHAR(255),
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Contract management
CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  party VARCHAR(500),
  contract_type VARCHAR(100),
  value DECIMAL(15,2),
  start_date DATE,
  end_date DATE,
  status VARCHAR(50) DEFAULT 'draft',
  content TEXT,
  risk_assessment JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Notification system
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id VARCHAR(255) NOT NULL,
  channel VARCHAR(20) DEFAULT 'in_app',
  subject VARCHAR(500),
  body TEXT,
  priority VARCHAR(20) DEFAULT 'normal',
  related_workflow_id VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID REFERENCES notifications(id),
  recipient_id VARCHAR(255),
  subject VARCHAR(500),
  body TEXT,
  status VARCHAR(20) DEFAULT 'queued',
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Calendar
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500),
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  participant_ids JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'confirmed',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Knowledge base
CREATE TABLE IF NOT EXISTS knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  category VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  search_vector TSVECTOR,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_search ON knowledge_base USING GIN(search_vector);

-- Audit
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor VARCHAR(255) NOT NULL,
  action VARCHAR(255) NOT NULL,
  resource VARCHAR(255),
  details JSONB DEFAULT '{}',
  outcome VARCHAR(20) DEFAULT 'success',
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor);

-- Workflow persistence
CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY,
  intent_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending',
  context JSONB DEFAULT '{}',
  tasks JSONB DEFAULT '[]',
  checkpoints JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id VARCHAR(255) NOT NULL,
  task_id VARCHAR(255) NOT NULL,
  requested_by VARCHAR(50) NOT NULL,
  description TEXT,
  data JSONB DEFAULT '{}',
  risk_level VARCHAR(20) DEFAULT 'medium',
  deadline TIMESTAMP,
  status VARCHAR(20) DEFAULT 'pending',
  reviewed_by VARCHAR(255),
  reviewed_at TIMESTAMP,
  comments TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approvals_workflow ON approvals(workflow_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);

CREATE TABLE IF NOT EXISTS conversation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255),
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_history_conversation ON conversation_history(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_history_user ON conversation_history(user_id, created_at DESC);

-- Auto-update search vector
CREATE OR REPLACE FUNCTION update_search_vector() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.content, '') || ' ' || COALESCE(NEW.category, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kb_search_update ON knowledge_base;
CREATE TRIGGER kb_search_update BEFORE INSERT OR UPDATE ON knowledge_base
  FOR EACH ROW EXECUTE FUNCTION update_search_vector();
`;

async function migrate(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for migration');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log('Running IntentOS database migration...');
    await pool.query(SCHEMA);
    console.log('Migration complete.');
  } finally {
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});
