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
 * OpenAI Provider
 * 
 * Supports GPT-4, GPT-3.5-Turbo, and other OpenAI models.
 */
export class OpenAIProvider extends BaseProvider {
  private client: unknown = null;

  constructor(config: ProviderConfig = {}, logLevel: string = 'info') {
    super('openai', config, logLevel);
  }

  /**
   * Initialize the OpenAI client
   */
  private async getClient(): Promise<unknown> {
    if (this.client) {
      return this.client;
    }

    try {
      // Dynamic import to handle optional dependency
      const { default: OpenAI } = await import('openai');
      
      this.client = new OpenAI({
        apiKey: this.config.apiKey || process.env['OPENAI_API_KEY'],
        organization: this.config.organization || process.env['OPENAI_ORGANIZATION'],
        baseURL: this.config.baseUrl,
        timeout: this.config.timeout || 60000,
        maxRetries: 0, // We handle retries ourselves
      });

      return this.client;
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize OpenAI client');
      throw new Error('OpenAI SDK not installed. Run: npm install openai');
    }
  }

  isReady(): boolean {
    const apiKey = this.config.apiKey || process.env['OPENAI_API_KEY'];
    return !!apiKey;
  }

  async listModels(): Promise<string[]> {
    const client = await this.getClient() as { models: { list: () => Promise<{ data: Array<{ id: string }> }> } };
    const response = await client.models.list();
    return response.data
      .filter(m => m.id.startsWith('gpt-'))
      .map(m => m.id);
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }

  protected getProviderDefaultModel(): string {
    return 'gpt-4-turbo-preview';
  }

  protected formatMessages(messages: Message[]): Array<{
    role: string;
    content: string;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
  }> {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      ...(msg.name && { name: msg.name }),
      ...(msg.toolCallId && { tool_call_id: msg.toolCallId }),
      ...(msg.toolCalls && {
        tool_calls: msg.toolCalls.map(tc => ({
          id: tc.id,
          type: tc.type,
          function: tc.function,
        })),
      }),
    }));
  }

  protected parseResponse(response: unknown, latencyMs: number): CompletionResponse {
    const r = response as {
      id: string;
      model: string;
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            type: 'function';
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    const choice = r.choices[0];
    const toolCalls: ToolCall[] | undefined = choice?.message.tool_calls?.map(tc => ({
      id: tc.id,
      type: tc.type as 'function',
      function: tc.function,
    }));

    return {
      id: r.id,
      model: r.model,
      content: choice?.message.content || '',
      finishReason: this.mapFinishReason(choice?.finish_reason || 'stop'),
      toolCalls,
      usage: {
        promptTokens: r.usage.prompt_tokens,
        completionTokens: r.usage.completion_tokens,
        totalTokens: r.usage.total_tokens,
      },
      latencyMs,
    };
  }

  private mapFinishReason(
    reason: string
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }

  async complete(
    messages: Message[],
    options?: CompletionOptions
  ): Promise<CompletionResponse> {
    const client = await this.getClient() as {
      chat: {
        completions: {
          create: (params: unknown) => Promise<unknown>;
        };
      };
    };

    const startTime = Date.now();

    const params = {
      model: options?.model || this.getDefaultModel(),
      messages: this.formatMessages(messages),
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(options?.maxTokens && { max_tokens: options.maxTokens }),
      ...(options?.topP !== undefined && { top_p: options.topP }),
      ...(options?.frequencyPenalty !== undefined && { frequency_penalty: options.frequencyPenalty }),
      ...(options?.presencePenalty !== undefined && { presence_penalty: options.presencePenalty }),
      ...(options?.stop && { stop: options.stop }),
      ...(options?.tools && { tools: this.formatTools(options.tools) }),
      ...(options?.toolChoice && { tool_choice: options.toolChoice }),
      ...(options?.responseFormat && { response_format: options.responseFormat }),
    };

    this.logger.debug({ params }, 'Sending completion request');

    const response = await this.withRetry(
      () => client.chat.completions.create(params),
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
      chat: {
        completions: {
          create: (params: unknown) => Promise<AsyncIterable<unknown>>;
        };
      };
    };

    const params = {
      model: options?.model || this.getDefaultModel(),
      messages: this.formatMessages(messages),
      stream: true,
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(options?.maxTokens && { max_tokens: options.maxTokens }),
      ...(options?.topP !== undefined && { top_p: options.topP }),
      ...(options?.tools && { tools: this.formatTools(options.tools) }),
      ...(options?.toolChoice && { tool_choice: options.toolChoice }),
    };

    const stream = await client.chat.completions.create(params);

    for await (const chunk of stream as AsyncIterable<{
      id: string;
      choices: Array<{
        delta: {
          content?: string;
          tool_calls?: Array<{
            index: number;
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string;
      }>;
    }>) {
      const choice = chunk.choices[0];
      
      yield {
        id: chunk.id,
        content: choice?.delta.content || '',
        finishReason: choice?.finish_reason ? this.mapFinishReason(choice.finish_reason) : undefined,
        toolCalls: choice?.delta.tool_calls?.map(tc => ({
          id: tc.id || '',
          type: 'function' as const,
          function: {
            name: tc.function?.name || '',
            arguments: tc.function?.arguments || '',
          },
        })),
      };
    }
  }

  private formatTools(tools: Tool[]): Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    return tools.map(tool => ({
      type: tool.type,
      function: tool.function,
    }));
  }
}
