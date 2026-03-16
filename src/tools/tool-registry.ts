/**
 * Tool Integration Framework
 * Provides a flexible system for agents to interact with external systems and APIs
 */

import { z } from 'zod';
import { Tool, ToolResult } from '../types';

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

/**
 * Common tool implementations
 */

// Database Query Tool
export const DatabaseQueryTool: Tool = {
  name: 'database_query',
  description: 'Execute a SQL query on the database',
  parameters: z.object({
    query: z.string().describe('SQL query to execute'),
    params: z.array(z.any()).optional().describe('Query parameters'),
  }),
  execute: async (params) => {
    // Mock implementation - in production would use actual database connection
    console.log('Executing query:', params.query);
    return { rows: [], rowCount: 0 };
  },
};

// HTTP Request Tool
export const HttpRequestTool: Tool = {
  name: 'http_request',
  description: 'Make an HTTP request to an external API',
  parameters: z.object({
    url: z.string().url().describe('URL to request'),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('HTTP method'),
    headers: z.record(z.string()).optional().describe('Request headers'),
    body: z.any().optional().describe('Request body'),
  }),
  execute: async (params) => {
    // Mock implementation - in production would use fetch or axios
    console.log('Making HTTP request:', params.method, params.url);
    return { status: 200, data: {} };
  },
};

// Email Tool
export const SendEmailTool: Tool = {
  name: 'send_email',
  description: 'Send an email',
  parameters: z.object({
    to: z.array(z.string().email()).describe('Recipient email addresses'),
    subject: z.string().describe('Email subject'),
    body: z.string().describe('Email body'),
    cc: z.array(z.string().email()).optional().describe('CC recipients'),
    attachments: z.array(z.string()).optional().describe('Attachment file paths'),
  }),
  execute: async (params) => {
    // Mock implementation - in production would use email service
    console.log('Sending email to:', params.to);
    return { messageId: 'mock-message-id', sent: true };
  },
};

// Calendar Tool
export const CalendarTool: Tool = {
  name: 'calendar_event',
  description: 'Create or manage calendar events',
  parameters: z.object({
    action: z.enum(['create', 'update', 'delete', 'list']).describe('Calendar action'),
    title: z.string().optional().describe('Event title'),
    startTime: z.string().optional().describe('Event start time (ISO format)'),
    endTime: z.string().optional().describe('Event end time (ISO format)'),
    attendees: z.array(z.string().email()).optional().describe('Event attendees'),
    eventId: z.string().optional().describe('Event ID (for update/delete)'),
  }),
  execute: async (params) => {
    // Mock implementation - in production would use calendar API
    console.log('Calendar action:', params.action);
    return { eventId: 'mock-event-id', success: true };
  },
};

// Document Processing Tool
export const DocumentProcessingTool: Tool = {
  name: 'process_document',
  description: 'Process and extract information from documents',
  parameters: z.object({
    documentPath: z.string().describe('Path to document'),
    operation: z
      .enum(['extract_text', 'extract_tables', 'summarize', 'classify'])
      .describe('Processing operation'),
  }),
  execute: async (params) => {
    // Mock implementation - in production would use OCR/NLP services
    console.log('Processing document:', params.documentPath);
    return { content: 'Extracted content...', metadata: {} };
  },
};

// File System Tool
export const FileSystemTool: Tool = {
  name: 'file_system',
  description: 'Interact with the file system',
  parameters: z.object({
    operation: z.enum(['read', 'write', 'delete', 'list', 'mkdir']).describe('File operation'),
    path: z.string().describe('File or directory path'),
    content: z.string().optional().describe('Content to write (for write operation)'),
  }),
  execute: async (params) => {
    // Mock implementation - in production would use fs module
    console.log('File system operation:', params.operation, params.path);
    return { success: true };
  },
};

// Slack Integration Tool
export const SlackTool: Tool = {
  name: 'slack_message',
  description: 'Send messages to Slack channels or users',
  parameters: z.object({
    channel: z.string().describe('Channel or user ID'),
    message: z.string().describe('Message content'),
    threadId: z.string().optional().describe('Thread ID for replies'),
  }),
  execute: async (params) => {
    // Mock implementation - in production would use Slack API
    console.log('Sending Slack message to:', params.channel);
    return { messageId: 'mock-slack-message-id', sent: true };
  },
};

// CRM Tool (e.g., Salesforce)
export const CRMTool: Tool = {
  name: 'crm_operation',
  description: 'Interact with CRM system',
  parameters: z.object({
    operation: z
      .enum(['create_lead', 'update_contact', 'create_opportunity', 'query'])
      .describe('CRM operation'),
    data: z.record(z.any()).describe('Operation data'),
  }),
  execute: async (params) => {
    // Mock implementation - in production would use CRM API
    console.log('CRM operation:', params.operation);
    return { id: 'mock-crm-id', success: true };
  },
};

// Payment Processing Tool
export const PaymentTool: Tool = {
  name: 'payment_processing',
  description: 'Process payments and financial transactions',
  parameters: z.object({
    operation: z
      .enum(['charge', 'refund', 'transfer', 'get_balance'])
      .describe('Payment operation'),
    amount: z.number().positive().optional().describe('Amount in cents'),
    currency: z.string().optional().describe('Currency code (e.g., USD)'),
    recipient: z.string().optional().describe('Recipient identifier'),
    description: z.string().optional().describe('Payment description'),
  }),
  execute: async (params) => {
    // Mock implementation - in production would use Stripe/PayPal API
    console.log('Payment operation:', params.operation);
    return { transactionId: 'mock-transaction-id', success: true };
  },
};

/**
 * Initialize default tool registry
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Register common tools
  registry.register(DatabaseQueryTool);
  registry.register(HttpRequestTool);
  registry.register(SendEmailTool);
  registry.register(CalendarTool);
  registry.register(DocumentProcessingTool);
  registry.register(FileSystemTool);
  registry.register(SlackTool);
  registry.register(CRMTool);
  registry.register(PaymentTool);

  return registry;
}
