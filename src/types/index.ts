import { z } from 'zod';

/**
 * Supported AI providers
 */
export type ProviderType = 'openai' | 'anthropic' | 'local' | 'custom';

/**
 * Message role in a conversation
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * A message in a conversation
 */
export interface Message {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

/**
 * Tool call request
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Tool definition for function calling
 */
export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Options for completion requests
 */
export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  tools?: Tool[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  responseFormat?: { type: 'text' | 'json_object' };
  stream?: boolean;
  timeout?: number;
}

/**
 * Response from a completion request
 */
export interface CompletionResponse {
  id: string;
  model: string;
  content: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  latencyMs: number;
}

/**
 * Token usage information
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Streaming chunk
 */
export interface StreamChunk {
  id: string;
  content: string;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  toolCalls?: Partial<ToolCall>[];
}

/**
 * Model information
 */
export interface ModelInfo {
  id: string;
  provider: ProviderType;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  costPer1kPromptTokens: number;
  costPer1kCompletionTokens: number;
  recommended: boolean;
  deprecated: boolean;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
  defaultModel?: string;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Validation schemas
 */
export const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
});

export const CompletionOptionsSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  stop: z.array(z.string()).optional(),
  stream: z.boolean().optional(),
  timeout: z.number().positive().optional(),
});

export type ValidatedMessage = z.infer<typeof MessageSchema>;
export type ValidatedOptions = z.infer<typeof CompletionOptionsSchema>;
