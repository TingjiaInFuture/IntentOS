/**
 * AI-Native Tool Registry
 * Core principle: tools are either core infrastructure or LLM-driven logic.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import OpenAI from 'openai';
import { z } from 'zod';
import { Tool, ToolResult, SystemConfig } from '../types';
import { EmailWorker } from '../workers/email-worker';

// ============================================================================
// Tool Registry
// ============================================================================

export class ToolRegistry {
  private tools: Map<string, Tool>;

  constructor() {
    this.tools = new Map();
  }

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} already registered`);
    }

    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, params: any): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool ${name} not found`,
      };
    }

    try {
      const validatedParams = tool.parameters.parse(params);
      const data = await tool.execute(validatedParams);

      return {
        success: true,
        data,
        metadata: {
          toolName: name,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          toolName: name,
          timestamp: new Date().toISOString(),
        },
      };
    }
  }
}

// ============================================================================
// Database Pool (system-owned persistence)
// ============================================================================

const poolCache = new Map<string, Pool>();

function getPool(connectionString: string): Pool {
  const existing = poolCache.get(connectionString);
  if (existing) {
    return existing;
  }

  const pool = new Pool({ connectionString });
  poolCache.set(connectionString, pool);
  return pool;
}

// ============================================================================
// AI-Native Tools
// ============================================================================

function createDatabaseQueryTool(connectionString?: string): Tool {
  return {
    name: 'database_query',
    description:
      'Query the system PostgreSQL database for business data such as employees, budgets, transactions, contracts, and policies',
    parameters: z.object({
      query: z.string().describe('SQL query to execute'),
      params: z.array(z.any()).optional().describe('Query parameters'),
    }),
    execute: async (params) => {
      const cs = connectionString || process.env.DATABASE_URL;
      if (!cs) {
        throw new Error('DATABASE_URL not configured');
      }

      const pool = getPool(cs);
      const result = await pool.query(params.query, params.params || []);
      return {
        rows: result.rows,
        rowCount: result.rowCount,
      };
    },
  };
}

function createDatabaseWriteTool(connectionString?: string): Tool {
  return {
    name: 'database_write',
    description:
      'Write to the system database with INSERT, UPDATE, and DELETE operations for stateful business actions',
    parameters: z.object({
      query: z.string().describe('SQL INSERT/UPDATE/DELETE statement'),
      params: z.array(z.any()).optional().describe('Query parameters'),
    }),
    execute: async (params) => {
      const cs = connectionString || process.env.DATABASE_URL;
      if (!cs) {
        throw new Error('DATABASE_URL not configured');
      }

      const pool = getPool(cs);
      const result = await pool.query(params.query, params.params || []);
      return {
        rowCount: result.rowCount,
        command: result.command,
      };
    },
  };
}

function createLLMReasonTool(config?: { apiKey?: string; model?: string }): Tool {
  return {
    name: 'llm_reason',
    description:
      'Use LLM for enterprise reasoning tasks such as analysis, summarization, drafting, risk evaluation, and compliance interpretation',
    parameters: z.object({
      task: z.string().describe('The cognitive task to perform'),
      input: z.string().describe('Input text/data for reasoning'),
      outputFormat: z
        .string()
        .optional()
        .describe('Desired output format, for example json, markdown, or bullet_points'),
      context: z.string().optional().describe('Additional context for reasoning'),
    }),
    execute: async (params) => {
      const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY not configured');
      }

      const client = new OpenAI({ apiKey });
      const systemPrompt = `You are an enterprise AI assistant performing the following task: ${params.task}
${params.outputFormat ? `Respond in ${params.outputFormat} format.` : ''}
${params.context ? `Additional context: ${params.context}` : ''}
Be precise, professional, and actionable.`;

      const completion = await client.chat.completions.create({
        model: config?.model || process.env.LLM_MODEL || 'gpt-4',
        temperature: 0.4,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: params.input },
        ],
      });

      return {
        result: completion.choices[0]?.message?.content || '',
        usage: completion.usage,
      };
    },
  };
}

function createDocumentAnalysisTool(config?: { apiKey?: string; model?: string }): Tool {
  return {
    name: 'ai_document_analyze',
    description:
      'AI-native document analysis for extraction, summarization, risk checks, compliance checks, and classification',
    parameters: z.object({
      content: z.string().describe('Document text content'),
      operation: z
        .enum([
          'extract_entities',
          'summarize',
          'risk_analysis',
          'compliance_check',
          'classify',
          'compare',
        ])
        .describe('Analysis operation to perform'),
      referenceContext: z
        .string()
        .optional()
        .describe('Optional reference material for comparison/compliance checks'),
    }),
    execute: async (params) => {
      const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY not configured');
      }

      const client = new OpenAI({ apiKey });
      const taskPrompts: Record<string, string> = {
        extract_entities:
          'Extract all named entities including people, organizations, dates, amounts, and obligations. Return structured JSON.',
        summarize:
          'Provide an executive summary with key points, obligations, and action items.',
        risk_analysis:
          'Analyze legal, financial, and operational risks. Rate each risk low/medium/high and provide mitigations.',
        compliance_check:
          'Evaluate compliance issues and list violations or gaps clearly.',
        classify:
          'Classify document type and extract relevant metadata.',
        compare:
          'Compare this document with the provided reference context and explain material differences.',
      };

      const completion = await client.chat.completions.create({
        model: config?.model || process.env.LLM_MODEL || 'gpt-4',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: `You are an expert document analyst. ${taskPrompts[params.operation]}
${params.referenceContext ? `Reference context:\n${params.referenceContext}` : ''}
Respond in structured JSON.`,
          },
          { role: 'user', content: params.content },
        ],
        response_format: { type: 'json_object' },
      });

      return JSON.parse(completion.choices[0]?.message?.content || '{}');
    },
  };
}

function createNotificationTool(connectionString?: string, emailWorker?: EmailWorker): Tool {
  return {
    name: 'ai_notify',
    description:
      'Send notifications through the system-native notification layer with optional email outbox queuing',
    parameters: z.object({
      recipientId: z.string().describe('Recipient user ID'),
      channel: z.enum(['in_app', 'email', 'both']).describe('Delivery channel'),
      subject: z.string().describe('Notification subject'),
      body: z.string().describe('Notification body'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      relatedWorkflowId: z.string().optional(),
    }),
    execute: async (params) => {
      const cs = connectionString || process.env.DATABASE_URL;
      if (!cs) {
        throw new Error('DATABASE_URL not configured');
      }

      const pool = getPool(cs);
      const initialStatus = params.channel === 'in_app' ? 'sent' : 'queued';
      const result = await pool.query(
        `INSERT INTO notifications (recipient_id, channel, subject, body, priority, related_workflow_id, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING id`,
        [
          params.recipientId,
          params.channel,
          params.subject,
          params.body,
          params.priority || 'normal',
          params.relatedWorkflowId || null,
          initialStatus,
        ]
      );

      const notificationId = result.rows[0]?.id;
      let emailDeliveryStatus: 'sent' | 'queued' = initialStatus === 'sent' ? 'sent' : 'queued';

      if (params.channel === 'email' || params.channel === 'both') {
        await pool.query(
          `INSERT INTO email_outbox (notification_id, recipient_id, subject, body, status, created_at)
           VALUES ($1, $2, $3, $4, 'queued', NOW())`,
          [notificationId, params.recipientId, params.subject, params.body]
        );

        emailDeliveryStatus = 'queued';

        if (emailWorker) {
          try {
            await emailWorker.runOnce();
          } catch (error) {
            console.error('Email worker dispatch failed:', error);
          }
        }

        const notificationStatus = await pool.query(
          `SELECT status FROM notifications WHERE id = $1`,
          [notificationId]
        );
        emailDeliveryStatus = notificationStatus.rows[0]?.status || emailDeliveryStatus;
      }

      return {
        notificationId,
        status: emailDeliveryStatus,
      };
    },
  };
}

function createSchedulingTool(
  connectionString?: string,
  llmConfig?: { apiKey?: string; model?: string }
): Tool {
  return {
    name: 'ai_schedule',
    description:
      'AI-native scheduling with conflict checks, listing, cancellation, and optimal time suggestions',
    parameters: z.object({
      action: z.enum(['create', 'find_optimal_time', 'check_conflicts', 'list', 'cancel']),
      title: z.string().optional(),
      startTime: z.string().optional().describe('ISO datetime'),
      endTime: z.string().optional().describe('ISO datetime'),
      participantIds: z.array(z.string()).optional(),
      eventId: z.string().optional(),
      durationMinutes: z.number().optional(),
    }),
    execute: async (params) => {
      const cs = connectionString || process.env.DATABASE_URL;
      if (!cs) {
        throw new Error('DATABASE_URL not configured');
      }

      const pool = getPool(cs);

      switch (params.action) {
        case 'create': {
          const created = await pool.query(
            `INSERT INTO calendar_events (title, start_time, end_time, participant_ids, status, created_at)
             VALUES ($1, $2, $3, $4, 'confirmed', NOW())
             RETURNING id`,
            [
              params.title || 'Untitled event',
              params.startTime,
              params.endTime,
              JSON.stringify(params.participantIds || []),
            ]
          );

          return {
            eventId: created.rows[0]?.id,
            status: 'created',
          };
        }

        case 'check_conflicts': {
          const conflicts = await pool.query(
            `SELECT * FROM calendar_events
             WHERE status = 'confirmed'
             AND start_time < $2
             AND end_time > $1
             AND participant_ids ?| $3::text[]`,
            [params.startTime, params.endTime, params.participantIds || []]
          );

          return {
            hasConflicts: (conflicts.rowCount || 0) > 0,
            conflicts: conflicts.rows,
          };
        }

        case 'find_optimal_time': {
          const existingEvents = await pool.query(
            `SELECT * FROM calendar_events
             WHERE status = 'confirmed'
             AND start_time > NOW()
             AND participant_ids ?| $1::text[]
             ORDER BY start_time ASC
             LIMIT 20`,
            [params.participantIds || []]
          );

          const apiKey = llmConfig?.apiKey || process.env.OPENAI_API_KEY;
          if (!apiKey) {
            throw new Error('OPENAI_API_KEY not configured');
          }

          const client = new OpenAI({ apiKey });
          const completion = await client.chat.completions.create({
            model: llmConfig?.model || process.env.LLM_MODEL || 'gpt-4',
            temperature: 0.3,
            messages: [
              {
                role: 'system',
                content:
                  'You are a scheduling assistant. Suggest 3 optimal meeting slots based on existing events. Respond in JSON: { "suggestions": [{ "start": "ISO", "end": "ISO", "reason": "..." }] }',
              },
              {
                role: 'user',
                content: JSON.stringify({
                  existingEvents: existingEvents.rows,
                  desiredDuration: params.durationMinutes || 60,
                  participants: params.participantIds || [],
                }),
              },
            ],
            response_format: { type: 'json_object' },
          });

          return JSON.parse(completion.choices[0]?.message?.content || '{"suggestions": []}');
        }

        case 'list': {
          const events = await pool.query(
            `SELECT * FROM calendar_events
             WHERE status = 'confirmed'
             AND start_time > NOW()
             ORDER BY start_time ASC
             LIMIT 50`
          );

          return {
            events: events.rows,
          };
        }

        case 'cancel': {
          await pool.query(`UPDATE calendar_events SET status = 'cancelled' WHERE id = $1`, [
            params.eventId,
          ]);

          return {
            status: 'cancelled',
            eventId: params.eventId,
          };
        }

        default:
          throw new Error(`Unsupported schedule action: ${params.action}`);
      }
    },
  };
}

function createKnowledgeSearchTool(connectionString?: string): Tool {
  return {
    name: 'knowledge_search',
    description:
      'Search internal knowledge base with text relevance and optional category scope filtering',
    parameters: z.object({
      query: z.string().describe('Natural language query'),
      scope: z
        .enum(['all', 'policies', 'employees', 'departments', 'transactions', 'contracts'])
        .optional(),
      limit: z.number().optional(),
    }),
    execute: async (params) => {
      const cs = connectionString || process.env.DATABASE_URL;
      if (!cs) {
        throw new Error('DATABASE_URL not configured');
      }

      const pool = getPool(cs);
      const values: any[] = [params.query];
      const where: string[] = [`search_vector @@ plainto_tsquery('english', $1)`];

      if (params.scope && params.scope !== 'all') {
        values.push(params.scope);
        where.push(`category = $${values.length}`);
      }

      values.push(params.limit || 10);

      const sql = `SELECT id, content, category, metadata,
                          ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
                   FROM knowledge_base
                   WHERE ${where.join(' AND ')}
                   ORDER BY rank DESC
                   LIMIT $${values.length}`;

      const result = await pool.query(sql, values);
      return {
        results: result.rows,
      };
    },
  };
}

function createReportTool(
  connectionString?: string,
  llmConfig?: { apiKey?: string; model?: string }
): Tool {
  return {
    name: 'ai_report',
    description:
      'Generate AI-powered business reports from system data with analytical summaries and recommendations',
    parameters: z.object({
      reportType: z.string().describe('Report type identifier'),
      parameters: z.record(z.any()).optional().describe('Report parameters'),
      format: z.enum(['markdown', 'json', 'executive_summary']).optional(),
    }),
    execute: async (params) => {
      const cs = connectionString || process.env.DATABASE_URL;
      if (!cs) {
        throw new Error('DATABASE_URL not configured');
      }

      const pool = getPool(cs);
      let rawData: any;

      switch (params.reportType) {
        case 'monthly_expense_summary': {
          const startDate =
            params.parameters?.startDate ||
            new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
          const endDate = params.parameters?.endDate || new Date().toISOString();

          rawData = await pool.query(
            `SELECT category, SUM(amount) AS total, COUNT(*) AS count
             FROM transactions
             WHERE type = 'expense' AND created_at >= $1 AND created_at < $2
             GROUP BY category
             ORDER BY total DESC`,
            [startDate, endDate]
          );
          break;
        }

        default:
          rawData = await pool.query(
            `SELECT * FROM audit_log
             WHERE action LIKE $1
             ORDER BY timestamp DESC
             LIMIT 100`,
            [`%${params.reportType}%`]
          );
      }

      const apiKey = llmConfig?.apiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY not configured');
      }

      const client = new OpenAI({ apiKey });
      const completion = await client.chat.completions.create({
        model: llmConfig?.model || process.env.LLM_MODEL || 'gpt-4',
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: `Generate a professional ${params.format || 'markdown'} report for: ${params.reportType}. Include key insights, trends, and recommendations.`,
          },
          {
            role: 'user',
            content: `Raw data:\n${JSON.stringify(rawData.rows, null, 2)}`,
          },
        ],
      });

      return {
        report: completion.choices[0]?.message?.content || '',
        rawData: rawData.rows,
      };
    },
  };
}

function createFileSystemTool(): Tool {
  return {
    name: 'file_system',
    description: 'Read and write files on local file system',
    parameters: z.object({
      operation: z.enum(['read', 'write', 'delete', 'list', 'mkdir']),
      path: z.string(),
      content: z.string().optional(),
    }),
    execute: async (params) => {
      switch (params.operation) {
        case 'read':
          return {
            content: await fs.readFile(params.path, 'utf8'),
          };

        case 'write':
          await fs.mkdir(path.dirname(params.path), { recursive: true });
          await fs.writeFile(params.path, params.content || '', 'utf8');
          return {
            success: true,
            path: params.path,
          };

        case 'delete':
          await fs.rm(params.path, { recursive: true, force: true });
          return {
            success: true,
          };

        case 'list': {
          const entries = await fs.readdir(params.path, { withFileTypes: true });
          return {
            entries: entries.map((entry) => ({
              name: entry.name,
              isDirectory: entry.isDirectory(),
            })),
          };
        }

        case 'mkdir':
          await fs.mkdir(params.path, { recursive: true });
          return {
            success: true,
            path: params.path,
          };

        default:
          throw new Error(`Unsupported operation: ${params.operation}`);
      }
    },
  };
}

function createHttpRequestTool(): Tool {
  return {
    name: 'http_request',
    description:
      'Make generic HTTP requests for webhooks or custom APIs without binding to legacy SaaS systems',
    parameters: z.object({
      url: z.string().url(),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
      headers: z.record(z.string()).optional(),
      body: z.any().optional(),
    }),
    execute: async (params) => {
      const response = await fetch(params.url, {
        method: params.method,
        headers: {
          'Content-Type': 'application/json',
          ...(params.headers || {}),
        },
        body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
      });

      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`
        );
      }

      return {
        status: response.status,
        data,
      };
    },
  };
}

// ============================================================================
// Factory
// ============================================================================

export function createDefaultToolRegistry(config: SystemConfig, emailWorker?: EmailWorker): ToolRegistry {
  const registry = new ToolRegistry();
  const dbUrl = config.database.url;
  const llmConfig = {
    apiKey: config.llm.apiKey,
    model: config.llm.model,
  };

  // Infrastructure tools
  registry.register(createDatabaseQueryTool(dbUrl));
  registry.register(createDatabaseWriteTool(dbUrl));
  registry.register(createFileSystemTool());
  registry.register(createHttpRequestTool());

  // AI-native core tools
  registry.register(createLLMReasonTool(llmConfig));
  registry.register(createDocumentAnalysisTool(llmConfig));

  // AI-native business tools
  registry.register(createNotificationTool(dbUrl, emailWorker));
  registry.register(createSchedulingTool(dbUrl, llmConfig));
  registry.register(createKnowledgeSearchTool(dbUrl));
  registry.register(createReportTool(dbUrl, llmConfig));

  return registry;
}
