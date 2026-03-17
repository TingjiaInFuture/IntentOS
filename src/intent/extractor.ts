/**
 * Intent Extraction System
 * Extracts structured data from natural language using LLM function calling
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import { Intent, IntentSchema } from '../types';

export interface ExtractionConfig {
  provider?: 'openai' | 'anthropic';
  model: string;
  temperature?: number;
  maxRetries?: number;
  apiKey?: string;
}

/**
 * Intent extractor that converts natural language to structured data
 */
export class IntentExtractor {
  private provider: 'openai' | 'anthropic';
  private model: string;
  private temperature: number;
  private maxRetries: number;
  private openAIClient?: OpenAI;

  constructor(config: ExtractionConfig) {
    this.provider = config.provider || 'openai';
    this.model = config.model;
    this.temperature = config.temperature || 0.3; // Lower temperature for stable extraction
    this.maxRetries = config.maxRetries || 3;

    if (this.provider === 'openai') {
      const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
      if (apiKey) {
        this.openAIClient = new OpenAI({ apiKey });
      }
    }
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
   * Extract structured data using LLM with function calling and structured outputs fallback.
   */
  private async extractWithLLM(
    input: string,
    schema?: z.ZodSchema,
    context?: Record<string, any>
  ): Promise<z.infer<typeof IntentSchema>> {
    if (this.provider !== 'openai') {
      throw new Error(
        `Provider ${this.provider} is not implemented in this build. Use provider=openai for production extraction.`
      );
    }

    const client = this.getOpenAIClient();
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const extraction = await this.extractWithFunctionCalling(client, input, context);

        // Optional domain schema validation (HR/Finance/Legal). IntentSchema remains the output contract.
        if (schema) {
          schema.parse(extraction);
        }

        return IntentSchema.parse(extraction);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown extraction error');

        // Fallback to JSON schema structured output if tool call parsing fails.
        try {
          const extraction = await this.extractWithStructuredOutput(client, input, context);
          if (schema) {
            schema.parse(extraction);
          }
          return IntentSchema.parse(extraction);
        } catch {
          // Continue retry loop.
        }

        if (attempt < this.maxRetries) {
          await this.sleep(200 * attempt);
        }
      }
    }

    throw new Error(
      `Intent extraction failed after ${this.maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
    );
  }

  private getOpenAIClient(): OpenAI {
    if (!this.openAIClient) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          'OPENAI_API_KEY is required for intent extraction. Configure llm.apiKey or set OPENAI_API_KEY.'
        );
      }
      this.openAIClient = new OpenAI({ apiKey });
    }

    return this.openAIClient;
  }

  private async extractWithFunctionCalling(
    client: OpenAI,
    input: string,
    context?: Record<string, any>
  ): Promise<z.infer<typeof IntentSchema>> {
    const completion = await client.chat.completions.create({
      model: this.model,
      temperature: this.temperature,
      messages: [
        {
          role: 'system',
          content:
            'You are an enterprise intent extraction engine. Return only structured business intent with required fields and confidence.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            input,
            context: context || {},
            instruction:
              'Infer intent, extract entities, and list only truly missing required fields for execution.',
          }),
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'extract_intent',
            description: 'Extract normalized intent and structured entities from enterprise user input.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                intent: {
                  type: 'string',
                  description: 'The normalized intent name (e.g., submit_expense, hire_employee).',
                },
                entities: {
                  type: 'object',
                  description: 'Structured entities extracted from input.',
                  additionalProperties: true,
                },
                requiredFields: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Fields that are mandatory but still missing.',
                },
                confidence: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1,
                  description: 'Confidence of extraction.',
                },
              },
              required: ['intent', 'entities', 'requiredFields', 'confidence'],
            },
          },
        },
      ],
      tool_choice: {
        type: 'function',
        function: { name: 'extract_intent' },
      },
    });

    const toolCall = completion.choices[0]?.message?.tool_calls?.find(
      (call) => call.type === 'function' && call.function?.name === 'extract_intent'
    );

    if (!toolCall?.function?.arguments) {
      throw new Error('Model did not return extract_intent function arguments');
    }

    return JSON.parse(toolCall.function.arguments);
  }

  private async extractWithStructuredOutput(
    client: OpenAI,
    input: string,
    context?: Record<string, any>
  ): Promise<z.infer<typeof IntentSchema>> {
    const completion = await client.chat.completions.create({
      model: this.model,
      temperature: this.temperature,
      messages: [
        {
          role: 'system',
          content:
            'You are an enterprise intent extraction engine. Respond in strict JSON only based on the provided schema.',
        },
        {
          role: 'user',
          content: JSON.stringify({ input, context: context || {} }),
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'intent_extraction',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              intent: { type: 'string' },
              entities: { type: 'object', additionalProperties: true },
              requiredFields: {
                type: 'array',
                items: { type: 'string' },
              },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['intent', 'entities', 'requiredFields', 'confidence'],
          },
          strict: true,
        },
      },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Model returned empty structured content');
    }

    return JSON.parse(content);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
          (field: string) => !newExtraction.entities[field]
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
