import type {
  Message,
  CompletionOptions,
  CompletionResponse,
  StreamChunk,
  ProviderConfig,
  Tool,
  ToolCall,
} from '../types/index.js';
import { BaseProvider } from './BaseProvider.js';

/**
 * Anthropic Provider
 * 
 * Supports Claude models (Claude 3, Claude 2, etc.)
 */
export class AnthropicProvider extends BaseProvider {
  private client: unknown = null;

  constructor(config: ProviderConfig = {}, logLevel: string = 'info') {
    super('anthropic', config, logLevel);
  }

  /**
   * Initialize the Anthropic client
   */
  private async getClient(): Promise<unknown> {
    if (this.client) {
      return this.client;
    }

    try {
      // Dynamic import to handle optional dependency
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      
      this.client = new Anthropic({
        apiKey: this.config.apiKey || process.env['ANTHROPIC_API_KEY'],
        baseURL: this.config.baseUrl,
        timeout: this.config.timeout || 60000,
        maxRetries: 0, // We handle retries ourselves
      });

      return this.client;
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize Anthropic client');
      throw new Error('Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk');
    }
  }

  isReady(): boolean {
    const apiKey = this.config.apiKey || process.env['ANTHROPIC_API_KEY'];
    return !!apiKey;
  }

  async listModels(): Promise<string[]> {
    // Anthropic doesn't have a models endpoint, return known models
    return [
      'claude-3-5-sonnet-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
      'claude-2.1',
      'claude-2.0',
    ];
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.getClient();
      // Try a minimal request to validate
      const messages: Message[] = [{ role: 'user', content: 'Hi' }];
      await this.complete(messages, { maxTokens: 1 });
      return true;
    } catch {
      return false;
    }
  }

  protected getProviderDefaultModel(): string {
    return 'claude-3-5-sonnet-20241022';
  }

  protected formatMessages(messages: Message[]): {
    system?: string;
    messages: Array<{
      role: 'user' | 'assistant';
      content: string | Array<{ type: string; tool_use_id?: string; content?: string }>;
    }>;
  } {
    // Extract system message if present
    let system: string | undefined;
    const nonSystemMessages: Message[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system = msg.content;
      } else {
        nonSystemMessages.push(msg);
      }
    }

    // Convert messages to Anthropic format
    const formatted = nonSystemMessages.map(msg => {
      if (msg.role === 'tool') {
        return {
          role: 'user' as const,
          content: [{
            type: 'tool_result',
            tool_use_id: msg.toolCallId,
            content: msg.content,
          }],
        };
      }

      return {
        role: msg.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: msg.content,
      };
    });

    return { system, messages: formatted };
  }

  protected parseResponse(response: unknown, latencyMs: number): CompletionResponse {
    const r = response as {
      id: string;
      model: string;
      content: Array<{
        type: 'text' | 'tool_use';
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      stop_reason: string;
      usage: {
        input_tokens: number;
        output_tokens: number;
      };
    };

    // Extract text content
    const textContent = r.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');

    // Extract tool calls
    const toolCalls: ToolCall[] = r.content
      .filter(c => c.type === 'tool_use')
      .map(c => ({
        id: c.id || '',
        type: 'function' as const,
        function: {
          name: c.name || '',
          arguments: JSON.stringify(c.input),
        },
      }));

    return {
      id: r.id,
      model: r.model,
      content: textContent,
      finishReason: this.mapFinishReason(r.stop_reason),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: r.usage.input_tokens,
        completionTokens: r.usage.output_tokens,
        totalTokens: r.usage.input_tokens + r.usage.output_tokens,
      },
      latencyMs,
    };
  }

  private mapFinishReason(
    reason: string
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }

  async complete(
    messages: Message[],
    options?: CompletionOptions
  ): Promise<CompletionResponse> {
    const client = await this.getClient() as {
      messages: {
        create: (params: unknown) => Promise<unknown>;
      };
    };

    const startTime = Date.now();
    const { system, messages: formattedMessages } = this.formatMessages(messages);

    const params = {
      model: options?.model || this.getDefaultModel(),
      max_tokens: options?.maxTokens || 4096,
      messages: formattedMessages,
      ...(system && { system }),
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(options?.topP !== undefined && { top_p: options.topP }),
      ...(options?.stop && { stop_sequences: options.stop }),
      ...(options?.tools && { tools: this.formatTools(options.tools) }),
    };

    this.logger.debug({ params }, 'Sending completion request');

    const response = await this.withRetry(
      () => client.messages.create(params),
      this.config.maxRetries || 3
    );

    const latencyMs = Date.now() - startTime;
    return this.parseResponse(response, latencyMs);
  }

  async *stream(
    messages: Message[],
    options?: CompletionOptions
  ): AsyncGenerator<StreamChunk> {
    const client = await this.getClient() as {
      messages: {
        stream: (params: unknown) => {
          on: (event: string, handler: (data: unknown) => void) => void;
          finalMessage: () => Promise<unknown>;
        };
      };
    };

    const { system, messages: formattedMessages } = this.formatMessages(messages);

    const params = {
      model: options?.model || this.getDefaultModel(),
      max_tokens: options?.maxTokens || 4096,
      messages: formattedMessages,
      ...(system && { system }),
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(options?.topP !== undefined && { top_p: options.topP }),
      ...(options?.tools && { tools: this.formatTools(options.tools) }),
    };

    // Create a wrapper for async iteration
    const stream = client.messages.stream(params);
    
    // Collect events as they come
    const chunks: StreamChunk[] = [];
    let resolveNext: ((value: IteratorResult<StreamChunk>) => void) | null = null;
    let done = false;

    stream.on('text', (text: string) => {
      const chunk: StreamChunk = {
        id: crypto.randomUUID(),
        content: text,
      };
      
      if (resolveNext) {
        resolveNext({ value: chunk, done: false });
        resolveNext = null;
      } else {
        chunks.push(chunk);
      }
    });

    stream.on('message', () => {
      done = true;
      if (resolveNext) {
        resolveNext({ value: undefined as unknown as StreamChunk, done: true });
      }
    });

    // Yield chunks
    while (!done || chunks.length > 0) {
      const chunk = chunks.shift();
      if (chunk) {
        yield chunk;
      } else if (!done) {
        await new Promise<IteratorResult<StreamChunk>>(resolve => {
          resolveNext = resolve;
        });
      }
    }
  }

  private formatTools(tools: Tool[]): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> {
    return tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }));
  }
}
