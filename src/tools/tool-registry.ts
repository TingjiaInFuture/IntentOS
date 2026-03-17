/**
 * Tool Integration Framework
 * Provides a flexible system for agents to interact with external systems and APIs
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { z } from 'zod';
import { Tool, ToolResult } from '../types';

export interface ToolIntegrationConfig {
  database?: {
    connectionString?: string;
  };
  email?: {
    endpoint?: string;
    apiKey?: string;
    from?: string;
  };
  document?: {
    endpoint?: string;
    apiKey?: string;
  };
  calendar?: {
    endpoint?: string;
    apiKey?: string;
  };
  slack?: {
    botToken?: string;
  };
  salesforce?: {
    instanceUrl?: string;
    accessToken?: string;
    apiVersion?: string;
  };
  sap?: {
    baseUrl?: string;
    username?: string;
    password?: string;
    client?: string;
    apiKey?: string;
  };
  rpa?: {
    endpoint?: string;
    apiKey?: string;
  };
}

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

async function parseResponse(response: Response): Promise<any> {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (!text) {
    return null;
  }

  if (contentType.includes('application/json')) {
    return JSON.parse(text);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestJson(url: string, init: RequestInit): Promise<{ status: number; data: any }> {
  const response = await fetch(url, init);
  const data = await parseResponse(response);

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}: ${typeof data === 'string' ? data : JSON.stringify(data)}`
    );
  }

  return {
    status: response.status,
    data,
  };
}

/**
 * Tool registry for managing available tools
 */
export class ToolRegistry {
  private tools: Map<string, Tool>;

  constructor() {
    this.tools = new Map();
  }

  /**
   * Register a new tool
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools by category
   */
  getByCategory(category: string): Tool[] {
    return Array.from(this.tools.values()).filter((tool) =>
      tool.description.toLowerCase().includes(category.toLowerCase())
    );
  }

  /**
   * Execute a tool
   */
  async execute(name: string, params: any): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool ${name} not found`,
      };
    }

    try {
      // Validate parameters
      const validatedParams = tool.parameters.parse(params);

      // Execute the tool
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

function createDatabaseQueryTool(connectionString?: string): Tool {
  return {
    name: 'database_query',
    description: 'Execute a SQL query on PostgreSQL',
    parameters: z.object({
      query: z.string().describe('SQL query to execute'),
      params: z.array(z.any()).optional().describe('Query parameters'),
    }),
    execute: async (params) => {
      const finalConnectionString = connectionString || process.env.DATABASE_URL;
      if (!finalConnectionString) {
        throw new Error('DATABASE_URL is not configured for database_query tool');
      }

      const pool = getPool(finalConnectionString);
      const result = await pool.query(params.query, params.params || []);

      return {
        rows: result.rows,
        rowCount: result.rowCount,
      };
    },
  };
}

function createHttpRequestTool(): Tool {
  return {
    name: 'http_request',
    description: 'Make an HTTP request to an external API',
    parameters: z.object({
      url: z.string().url().describe('URL to request'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('HTTP method'),
      headers: z.record(z.string()).optional().describe('Request headers'),
      body: z.any().optional().describe('Request body'),
    }),
    execute: async (params) => {
      const response = await requestJson(params.url, {
        method: params.method,
        headers: {
          'Content-Type': 'application/json',
          ...(params.headers || {}),
        },
        body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
      });

      return {
        status: response.status,
        data: response.data,
      };
    },
  };
}

function createEmailTool(config?: ToolIntegrationConfig['email']): Tool {
  return {
    name: 'send_email',
    description: 'Send an email through enterprise mail gateway API',
    parameters: z.object({
      to: z.array(z.string().email()).describe('Recipient email addresses'),
      subject: z.string().describe('Email subject'),
      body: z.string().describe('Email body'),
      cc: z.array(z.string().email()).optional().describe('CC recipients'),
      attachments: z.array(z.string()).optional().describe('Attachment file paths or URLs'),
    }),
    execute: async (params) => {
      const endpoint = config?.endpoint || process.env.EMAIL_API_ENDPOINT;
      if (!endpoint) {
        throw new Error('EMAIL_API_ENDPOINT is not configured for send_email tool');
      }

      const response = await requestJson(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config?.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          ...params,
          from: config?.from,
        }),
      });

      return {
        sent: true,
        providerResponse: response.data,
      };
    },
  };
}

function createCalendarTool(config?: ToolIntegrationConfig['calendar']): Tool {
  return {
    name: 'calendar_event',
    description: 'Create or manage calendar events via enterprise calendar API',
    parameters: z.object({
      action: z.enum(['create', 'update', 'delete', 'list']).describe('Calendar action'),
      title: z.string().optional().describe('Event title'),
      startTime: z.string().optional().describe('Event start time (ISO format)'),
      endTime: z.string().optional().describe('Event end time (ISO format)'),
      attendees: z.array(z.string().email()).optional().describe('Event attendees'),
      eventId: z.string().optional().describe('Event ID (for update/delete)'),
    }),
    execute: async (params) => {
      const endpoint = config?.endpoint || process.env.CALENDAR_API_ENDPOINT;
      if (!endpoint) {
        throw new Error('CALENDAR_API_ENDPOINT is not configured for calendar_event tool');
      }

      const response = await requestJson(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config?.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(params),
      });

      return {
        success: true,
        data: response.data,
      };
    },
  };
}

function createDocumentProcessingTool(config?: ToolIntegrationConfig['document']): Tool {
  return {
    name: 'process_document',
    description: 'Process and extract information from documents through a document AI API',
    parameters: z.object({
      documentPath: z.string().describe('Path to document or document URL'),
      operation: z
        .enum(['extract_text', 'extract_tables', 'summarize', 'classify'])
        .describe('Processing operation'),
    }),
    execute: async (params) => {
      const endpoint = config?.endpoint || process.env.DOC_API_ENDPOINT;
      if (!endpoint) {
        throw new Error('DOC_API_ENDPOINT is not configured for process_document tool');
      }

      const response = await requestJson(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config?.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(params),
      });

      return {
        content: response.data,
      };
    },
  };
}

function createFileSystemTool(): Tool {
  return {
    name: 'file_system',
    description: 'Interact with the file system',
    parameters: z.object({
      operation: z.enum(['read', 'write', 'delete', 'list', 'mkdir']).describe('File operation'),
      path: z.string().describe('File or directory path'),
      content: z.string().optional().describe('Content to write (for write operation)'),
    }),
    execute: async (params) => {
      switch (params.operation) {
        case 'read': {
          const content = await fs.readFile(params.path, 'utf8');
          return { content };
        }
        case 'write': {
          const dirPath = path.dirname(params.path);
          await fs.mkdir(dirPath, { recursive: true });
          await fs.writeFile(params.path, params.content || '', 'utf8');
          return { success: true, path: params.path };
        }
        case 'delete': {
          await fs.rm(params.path, { recursive: true, force: true });
          return { success: true, path: params.path };
        }
        case 'list': {
          const entries = await fs.readdir(params.path, { withFileTypes: true });
          return {
            entries: entries.map((entry) => ({
              name: entry.name,
              isDirectory: entry.isDirectory(),
            })),
          };
        }
        case 'mkdir': {
          await fs.mkdir(params.path, { recursive: true });
          return { success: true, path: params.path };
        }
        default:
          throw new Error(`Unsupported operation: ${params.operation}`);
      }
    },
  };
}

function createSlackTool(config?: ToolIntegrationConfig['slack']): Tool {
  return {
    name: 'slack_message',
    description: 'Send messages to Slack channels or users',
    parameters: z.object({
      channel: z.string().describe('Channel or user ID'),
      message: z.string().describe('Message content'),
      threadId: z.string().optional().describe('Thread ID for replies'),
    }),
    execute: async (params) => {
      const token = config?.botToken || process.env.SLACK_BOT_TOKEN;
      if (!token) {
        throw new Error('SLACK_BOT_TOKEN is not configured for slack_message tool');
      }

      const response = await requestJson('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          channel: params.channel,
          text: params.message,
          thread_ts: params.threadId,
        }),
      });

      if (!response.data?.ok) {
        throw new Error(`Slack API error: ${JSON.stringify(response.data)}`);
      }

      return {
        messageId: response.data.ts,
        channel: response.data.channel,
      };
    },
  };
}

function createSalesforceTool(
  config?: ToolIntegrationConfig['salesforce'],
  name: 'crm_operation' | 'salesforce_operation' = 'crm_operation'
): Tool {
  return {
    name,
    description: 'Interact with Salesforce CRM',
    parameters: z.object({
      operation: z.enum(['query', 'create', 'update', 'upsert', 'delete']).describe('CRM operation'),
      object: z.string().optional().describe('Salesforce object API name (e.g. Account)'),
      data: z.record(z.any()).optional().describe('Payload for create/update/upsert'),
      recordId: z.string().optional().describe('Record ID for update/delete'),
      soql: z.string().optional().describe('SOQL query for query operation'),
      externalIdField: z.string().optional().describe('External ID field name for upsert'),
      externalIdValue: z.string().optional().describe('External ID value for upsert'),
    }),
    execute: async (params) => {
      const instanceUrl = config?.instanceUrl || process.env.SALESFORCE_INSTANCE_URL;
      const accessToken = config?.accessToken || process.env.SALESFORCE_ACCESS_TOKEN;
      const apiVersion = config?.apiVersion || process.env.SALESFORCE_API_VERSION || 'v61.0';

      if (!instanceUrl || !accessToken) {
        throw new Error('Salesforce is not configured: SALESFORCE_INSTANCE_URL and SALESFORCE_ACCESS_TOKEN are required');
      }

      const baseUrl = `${instanceUrl.replace(/\/$/, '')}/services/data/${apiVersion}`;
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      };

      switch (params.operation) {
        case 'query': {
          if (!params.soql) {
            throw new Error('soql is required for Salesforce query');
          }
          const response = await requestJson(
            `${baseUrl}/query?q=${encodeURIComponent(params.soql)}`,
            {
              method: 'GET',
              headers,
            }
          );
          return response.data;
        }
        case 'create': {
          if (!params.object || !params.data) {
            throw new Error('object and data are required for Salesforce create');
          }
          const response = await requestJson(`${baseUrl}/sobjects/${params.object}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(params.data),
          });
          return response.data;
        }
        case 'update': {
          if (!params.object || !params.recordId || !params.data) {
            throw new Error('object, recordId and data are required for Salesforce update');
          }
          const response = await requestJson(
            `${baseUrl}/sobjects/${params.object}/${params.recordId}`,
            {
              method: 'PATCH',
              headers,
              body: JSON.stringify(params.data),
            }
          );
          return {
            success: true,
            status: response.status,
          };
        }
        case 'upsert': {
          if (!params.object || !params.externalIdField || !params.externalIdValue || !params.data) {
            throw new Error(
              'object, externalIdField, externalIdValue and data are required for Salesforce upsert'
            );
          }
          const response = await requestJson(
            `${baseUrl}/sobjects/${params.object}/${params.externalIdField}/${encodeURIComponent(params.externalIdValue)}`,
            {
              method: 'PATCH',
              headers,
              body: JSON.stringify(params.data),
            }
          );
          return {
            success: true,
            status: response.status,
          };
        }
        case 'delete': {
          if (!params.object || !params.recordId) {
            throw new Error('object and recordId are required for Salesforce delete');
          }
          const response = await requestJson(
            `${baseUrl}/sobjects/${params.object}/${params.recordId}`,
            {
              method: 'DELETE',
              headers,
            }
          );
          return {
            success: true,
            status: response.status,
          };
        }
        default:
          throw new Error(`Unsupported Salesforce operation: ${params.operation}`);
      }
    },
  };
}

function createSAPTool(config?: ToolIntegrationConfig['sap']): Tool {
  return {
    name: 'sap_operation',
    description: 'Interact with SAP OData/REST services',
    parameters: z.object({
      operation: z.enum(['read', 'create', 'update', 'action']).describe('SAP operation'),
      servicePath: z.string().describe('SAP service path, e.g. /sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder'),
      query: z.record(z.string()).optional().describe('Query parameters'),
      body: z.any().optional().describe('Request body for create/update/action'),
    }),
    execute: async (params) => {
      const baseUrl = config?.baseUrl || process.env.SAP_BASE_URL;
      if (!baseUrl) {
        throw new Error('SAP_BASE_URL is not configured for sap_operation tool');
      }

      const url = new URL(params.servicePath, baseUrl);
      if (params.query) {
        for (const [key, value] of Object.entries(params.query as Record<string, unknown>)) {
          url.searchParams.set(key, String(value));
        }
      }

      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };

      const apiKey = config?.apiKey || process.env.SAP_API_KEY;
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }

      const username = config?.username || process.env.SAP_USERNAME;
      const password = config?.password || process.env.SAP_PASSWORD;
      if (username && password) {
        headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      }

      const client = config?.client || process.env.SAP_CLIENT;
      if (client) {
        headers['x-sap-client'] = client;
      }

      const methodMap: Record<'read' | 'create' | 'update' | 'action', string> = {
        read: 'GET',
        create: 'POST',
        update: 'PATCH',
        action: 'POST',
      };

      const operation = params.operation as 'read' | 'create' | 'update' | 'action';

      const response = await requestJson(url.toString(), {
        method: methodMap[operation],
        headers,
        body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
      });

      return {
        status: response.status,
        data: response.data,
      };
    },
  };
}

function createRPATool(config?: ToolIntegrationConfig['rpa']): Tool {
  return {
    name: 'rpa_job',
    description: 'Trigger and monitor enterprise RPA jobs',
    parameters: z.object({
      operation: z.enum(['trigger', 'status', 'cancel']).describe('RPA operation'),
      processKey: z.string().optional().describe('RPA process key for trigger'),
      jobId: z.string().optional().describe('Job ID for status/cancel operations'),
      input: z.record(z.any()).optional().describe('Input payload for trigger'),
    }),
    execute: async (params) => {
      const endpoint = config?.endpoint || process.env.RPA_API_ENDPOINT;
      if (!endpoint) {
        throw new Error('RPA_API_ENDPOINT is not configured for rpa_job tool');
      }

      const normalizedEndpoint = endpoint.replace(/\/$/, '');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const apiKey = config?.apiKey || process.env.RPA_API_KEY;
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      switch (params.operation) {
        case 'trigger': {
          if (!params.processKey) {
            throw new Error('processKey is required to trigger an RPA job');
          }

          const response = await requestJson(`${normalizedEndpoint}/jobs/start`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              processKey: params.processKey,
              input: params.input || {},
            }),
          });

          return response.data;
        }
        case 'status': {
          if (!params.jobId) {
            throw new Error('jobId is required to check RPA job status');
          }

          const response = await requestJson(`${normalizedEndpoint}/jobs/${params.jobId}`, {
            method: 'GET',
            headers,
          });

          return response.data;
        }
        case 'cancel': {
          if (!params.jobId) {
            throw new Error('jobId is required to cancel an RPA job');
          }

          const response = await requestJson(`${normalizedEndpoint}/jobs/${params.jobId}/stop`, {
            method: 'POST',
            headers,
          });

          return response.data;
        }
        default:
          throw new Error(`Unsupported RPA operation: ${params.operation}`);
      }
    },
  };
}

function createPaymentTool(config?: ToolIntegrationConfig['sap']): Tool {
  return {
    name: 'payment_processing',
    description: 'Process payments via enterprise finance API (typically SAP)',
    parameters: z.object({
      operation: z
        .enum(['charge', 'refund', 'transfer', 'get_balance'])
        .describe('Payment operation'),
      amount: z.number().positive().optional().describe('Amount in major currency units'),
      currency: z.string().optional().describe('Currency code (e.g., USD)'),
      recipient: z.string().optional().describe('Recipient identifier'),
      description: z.string().optional().describe('Payment description'),
    }),
    execute: async (params) => {
      const baseUrl = config?.baseUrl || process.env.SAP_BASE_URL;
      if (!baseUrl) {
        throw new Error('SAP_BASE_URL is not configured for payment_processing tool');
      }

      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };

      const username = config?.username || process.env.SAP_USERNAME;
      const password = config?.password || process.env.SAP_PASSWORD;
      if (username && password) {
        headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      }

      const operation = params.operation;

      if (operation === 'get_balance') {
        const response = await requestJson(`${baseUrl.replace(/\/$/, '')}/payments/balance`, {
          method: 'GET',
          headers,
        });
        return response.data;
      }

      const response = await requestJson(`${baseUrl.replace(/\/$/, '')}/payments/transactions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      });

      return response.data;
    },
  };
}

/**
 * Initialize default tool registry
 */
export function createDefaultToolRegistry(
  integrations: ToolIntegrationConfig = {},
  databaseUrl?: string
): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(createDatabaseQueryTool(integrations.database?.connectionString || databaseUrl));
  registry.register(createHttpRequestTool());
  registry.register(createEmailTool(integrations.email));
  registry.register(createCalendarTool(integrations.calendar));
  registry.register(createDocumentProcessingTool(integrations.document));
  registry.register(createFileSystemTool());
  registry.register(createSlackTool(integrations.slack));
  registry.register(createSalesforceTool(integrations.salesforce, 'crm_operation'));
  registry.register(createSalesforceTool(integrations.salesforce, 'salesforce_operation'));
  registry.register(createSAPTool(integrations.sap));
  registry.register(createRPATool(integrations.rpa));
  registry.register(createPaymentTool(integrations.sap));

  return registry;
}
