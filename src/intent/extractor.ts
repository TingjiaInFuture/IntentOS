/**
 * Intent Extraction System
 * Extracts structured data from natural language using LLM with structured outputs
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Intent, IntentSchema } from '../types';

export interface ExtractionConfig {
  model: string;
  temperature?: number;
  maxRetries?: number;
}

/**
 * Intent extractor that converts natural language to structured data
 */
export class IntentExtractor {
  private model: string;
  private temperature: number;
  private maxRetries: number;

  constructor(config: ExtractionConfig) {
    this.model = config.model;
    this.temperature = config.temperature || 0.3; // Lower temperature for more consistent extraction
    this.maxRetries = config.maxRetries || 3;
  }

  /**
   * Extract intent and entities from user input
   */
  async extract(
    userId: string,
    rawInput: string,
    schema?: z.ZodSchema,
    context?: Record<string, any>
  ): Promise<Intent> {
    const extractedData = await this.extractWithLLM(rawInput, schema, context);

    const intent: Intent = {
      id: uuidv4(),
      userId,
      rawInput,
      extractedIntent: extractedData.intent,
      confidence: extractedData.confidence,
      entities: extractedData.entities,
      timestamp: new Date(),
      metadata: {
        requiredFields: extractedData.requiredFields,
        context,
      },
    };

    return intent;
  }

  /**
   * Extract structured data using LLM
   * In production, this would call OpenAI/Anthropic API with structured outputs
   */
  private async extractWithLLM(
    input: string,
    schema?: z.ZodSchema,
    context?: Record<string, any>
  ): Promise<z.infer<typeof IntentSchema>> {
    // Mock implementation - in production would use actual LLM API
    // Example with OpenAI:
    // const response = await openai.chat.completions.create({
    //   model: this.model,
    //   messages: [{ role: 'user', content: input }],
    //   response_format: { type: 'json_schema', json_schema: schema },
    // });

    // For now, return a mock structured response
    return this.mockExtraction(input, schema, context);
  }

  /**
   * Mock extraction for demonstration
   * In production, this would be replaced with actual LLM API calls
   */
  private mockExtraction(
    input: string,
    schema?: z.ZodSchema,
    context?: Record<string, any>
  ): z.infer<typeof IntentSchema> {
    // Simple keyword-based extraction for demonstration
    const lowerInput = input.toLowerCase();

    let intent = '';
    const entities: Record<string, any> = {};
    const requiredFields: string[] = [];

    // Detect intent type
    if (lowerInput.includes('hire') || lowerInput.includes('recruit')) {
      intent = 'hire_employee';
      entities.position = this.extractEntity(input, 'position');
      entities.department = this.extractEntity(input, 'department');
      if (!entities.position) requiredFields.push('position');
      if (!entities.department) requiredFields.push('department');
    } else if (lowerInput.includes('leave') || lowerInput.includes('vacation')) {
      intent = 'request_leave';
      entities.startDate = this.extractEntity(input, 'date');
      entities.duration = this.extractEntity(input, 'duration');
      if (!entities.startDate) requiredFields.push('startDate');
      if (!entities.duration) requiredFields.push('duration');
    } else if (lowerInput.includes('expense') || lowerInput.includes('reimburse')) {
      intent = 'submit_expense';
      entities.amount = this.extractAmount(input);
      entities.category = this.extractEntity(input, 'category');
      entities.description = this.extractEntity(input, 'description');
      if (!entities.amount) requiredFields.push('amount');
      if (!entities.category) requiredFields.push('category');
    } else if (lowerInput.includes('contract') || lowerInput.includes('agreement')) {
      intent = 'review_contract';
      entities.contractType = this.extractEntity(input, 'type');
      entities.party = this.extractEntity(input, 'party');
      if (!entities.contractType) requiredFields.push('contractType');
      if (!entities.party) requiredFields.push('party');
    } else if (lowerInput.includes('budget') || lowerInput.includes('allocate')) {
      intent = 'budget_allocation';
      entities.department = this.extractEntity(input, 'department');
      entities.amount = this.extractAmount(input);
      entities.period = this.extractEntity(input, 'period');
      if (!entities.department) requiredFields.push('department');
      if (!entities.amount) requiredFields.push('amount');
    } else {
      intent = 'general_inquiry';
      entities.query = input;
    }

    return {
      intent,
      entities,
      requiredFields,
      confidence: requiredFields.length === 0 ? 0.9 : 0.6,
    };
  }

  /**
   * Extract named entity from text
   */
  private extractEntity(text: string, entityType: string): string | undefined {
    // Simple pattern matching - in production would use NER models
    const patterns: Record<string, RegExp> = {
      position: /(?:for|as|position:?)\s+(?:a\s+)?([a-zA-Z\s]+?)(?:\s+in|\s+at|$)/i,
      department: /(?:in|for|department:?)\s+(?:the\s+)?([a-zA-Z\s]+?)(?:\s+department)?/i,
      date: /(?:on|from|starting)\s+(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|[a-zA-Z]+\s+\d{1,2})/i,
      duration: /(?:for)\s+(\d+\s+(?:days?|weeks?|months?))/i,
      category: /(?:category|for|as)\s+([a-zA-Z\s]+)/i,
      type: /(?:type|kind)\s+([a-zA-Z\s]+)/i,
      party: /(?:with|party:?)\s+([a-zA-Z\s]+)/i,
      period: /(?:for|period:?)\s+(Q\d|[a-zA-Z]+\s+\d{4})/i,
    };

    const pattern = patterns[entityType];
    if (!pattern) return undefined;

    const match = text.match(pattern);
    return match ? match[1].trim() : undefined;
  }

  /**
   * Extract monetary amount from text
   */
  private extractAmount(text: string): number | undefined {
    const amountPattern = /\$?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/;
    const match = text.match(amountPattern);
    return match ? parseFloat(match[1].replace(/,/g, '')) : undefined;
  }

  /**
   * Generate follow-up questions for missing fields
   */
  generateFollowUpQuestions(intent: Intent): string[] {
    const questions: string[] = [];
    const requiredFields = intent.metadata?.requiredFields || [];

    const fieldQuestions: Record<string, string> = {
      position: 'What position are you looking to fill?',
      department: 'Which department is this for?',
      startDate: 'When would you like to start?',
      duration: 'How long will this be for?',
      amount: 'What is the amount?',
      category: 'What category does this fall under?',
      description: 'Can you provide more details?',
      contractType: 'What type of contract is this?',
      party: 'Who is the other party involved?',
      period: 'What time period are we considering?',
    };

    for (const field of requiredFields) {
      const question = fieldQuestions[field];
      if (question) {
        questions.push(question);
      }
    }

    return questions;
  }

  /**
   * Merge additional information into existing intent
   */
  async refineIntent(
    intent: Intent,
    additionalInput: string,
    context?: Record<string, any>
  ): Promise<Intent> {
    const newExtraction = await this.extractWithLLM(additionalInput, undefined, context);

    return {
      ...intent,
      entities: {
        ...intent.entities,
        ...newExtraction.entities,
      },
      confidence: Math.max(intent.confidence, newExtraction.confidence),
      metadata: {
        ...intent.metadata,
        requiredFields: (intent.metadata?.requiredFields || []).filter(
          (field) => !newExtraction.entities[field]
        ),
      },
    };
  }

  /**
   * Validate that all required fields are present
   */
  isComplete(intent: Intent): boolean {
    return (intent.metadata?.requiredFields || []).length === 0;
  }
}

/**
 * Domain-specific schema definitions
 */
export const HRIntentSchema = z.object({
  intent: z.enum(['hire_employee', 'request_leave', 'performance_review', 'terminate_employee']),
  entities: z.object({
    employeeId: z.string().optional(),
    position: z.string().optional(),
    department: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    duration: z.string().optional(),
    reason: z.string().optional(),
  }),
  requiredFields: z.array(z.string()),
  confidence: z.number(),
});

export const FinanceIntentSchema = z.object({
  intent: z.enum([
    'submit_expense',
    'approve_budget',
    'generate_report',
    'process_payment',
    'create_invoice',
  ]),
  entities: z.object({
    amount: z.number().optional(),
    currency: z.string().optional(),
    category: z.string().optional(),
    description: z.string().optional(),
    vendorId: z.string().optional(),
    invoiceId: z.string().optional(),
    period: z.string().optional(),
  }),
  requiredFields: z.array(z.string()),
  confidence: z.number(),
});

export const LegalIntentSchema = z.object({
  intent: z.enum([
    'review_contract',
    'draft_agreement',
    'compliance_check',
    'risk_assessment',
  ]),
  entities: z.object({
    contractType: z.string().optional(),
    party: z.string().optional(),
    value: z.number().optional(),
    jurisdiction: z.string().optional(),
    deadline: z.string().optional(),
  }),
  requiredFields: z.array(z.string()),
  confidence: z.number(),
});
