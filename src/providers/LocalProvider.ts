import type {
  Message,
  CompletionOptions,
  CompletionResponse,
  StreamChunk,
  ProviderConfig,
} from '../types/index.js';
import { BaseProvider } from './BaseProvider.js';

/**
 * Local Provider
 * 
 * Supports local LLM servers that implement OpenAI-compatible APIs.
 * Examples: Ollama, LM Studio, LocalAI, vLLM
 */
export class LocalProvider extends BaseProvider {
  private baseUrl: string;

  constructor(config: ProviderConfig = {}, logLevel: string = 'info') {
    super('local', config, logLevel);
    this.baseUrl = config.baseUrl || 'http://localhost:11434/v1';
  }

  isReady(): boolean {
    return !!this.baseUrl;
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`);
      if (!response.ok) {
        return [];
      }
      
      const data = await response.json() as { data?: Array<{ id: string }> };
      return data.data?.map(m => m.id) || [];
    } catch (error) {
      this.logger.warn({ error }, 'Failed to list local models');
      return [];
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      const models = await this.listModels();
      return models.length > 0;
    } catch {
      return false;
    }
  }

  protected getProviderDefaultModel(): string {
    return 'llama3.2';
  }

  protected formatMessages(messages: Message[]): Array<{
    role: string;
    content: string;
  }> {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  protected parseResponse(response: unknown, latencyMs: number): CompletionResponse {
    const r = response as {
      id?: string;
      model: string;
      choices: Array<{
        message: { content: string };
        finish_reason: string;
      }>;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    const choice = r.choices[0];

    return {
      id: r.id || crypto.randomUUID(),
      model: r.model,
      content: choice?.message.content || '',
      finishReason: (choice?.finish_reason as 'stop' | 'length') || 'stop',
      usage: {
        promptTokens: r.usage?.prompt_tokens || 0,
        completionTokens: r.usage?.completion_tokens || 0,
        totalTokens: r.usage?.total_tokens || 0,
      },
      latencyMs,
    };
  }

  async complete(
    messages: Message[],
    options?: CompletionOptions
  ): Promise<CompletionResponse> {
    const startTime = Date.now();

    const body = {
      model: options?.model || this.getDefaultModel(),
      messages: this.formatMessages(messages),
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(options?.maxTokens && { max_tokens: options.maxTokens }),
      ...(options?.topP !== undefined && { top_p: options.topP }),
      ...(options?.stop && { stop: options.stop }),
    };

    this.logger.debug({ body }, 'Sending completion request to local server');

    const response = await this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
        },
        body: JSON.stringify(body),
        signal: options?.timeout
          ? AbortSignal.timeout(options.timeout)
          : undefined,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Local server error: ${res.status} ${errorText}`);
      }

      return res.json();
    }, this.config.maxRetries || 3);

    const latencyMs = Date.now() - startTime;
    return this.parseResponse(response, latencyMs);
  }

  async *stream(
    messages: Message[],
    options?: CompletionOptions
  ): AsyncGenerator<StreamChunk> {
    const body = {
      model: options?.model || this.getDefaultModel(),
      messages: this.formatMessages(messages),
      stream: true,
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(options?.maxTokens && { max_tokens: options.maxTokens }),
      ...(options?.topP !== undefined && { top_p: options.topP }),
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Local server error: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              return;
            }

            try {
              const chunk = JSON.parse(data) as {
                id: string;
                choices: Array<{
                  delta: { content?: string };
                  finish_reason?: string;
                }>;
              };

              const choice = chunk.choices[0];
              yield {
                id: chunk.id,
                content: choice?.delta.content || '',
                finishReason: choice?.finish_reason as 'stop' | 'length' | undefined,
              };
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
