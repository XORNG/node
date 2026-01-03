import type {
  Message,
  CompletionOptions,
  CompletionResponse,
  StreamChunk,
  ProviderConfig,
  ProviderType,
} from '../types/index.js';
import { createLogger, type Logger } from '../utils/logger.js';

/**
 * Base class for AI providers
 * 
 * All provider implementations should extend this class.
 */
export abstract class BaseProvider {
  protected logger: Logger;
  protected config: ProviderConfig;
  protected providerType: ProviderType;

  constructor(
    providerType: ProviderType,
    config: ProviderConfig = {},
    logLevel: string = 'info'
  ) {
    this.providerType = providerType;
    this.config = config;
    this.logger = createLogger(logLevel, `provider-${providerType}`);
  }

  /**
   * Get the provider type
   */
  getType(): ProviderType {
    return this.providerType;
  }

  /**
   * Check if the provider is configured and ready
   */
  abstract isReady(): boolean;

  /**
   * List available models for this provider
   */
  abstract listModels(): Promise<string[]>;

  /**
   * Create a completion (non-streaming)
   */
  abstract complete(
    messages: Message[],
    options?: CompletionOptions
  ): Promise<CompletionResponse>;

  /**
   * Create a streaming completion
   */
  abstract stream(
    messages: Message[],
    options?: CompletionOptions
  ): AsyncGenerator<StreamChunk>;

  /**
   * Validate the API key/credentials
   */
  abstract validateCredentials(): Promise<boolean>;

  /**
   * Get the default model for this provider
   */
  getDefaultModel(): string {
    return this.config.defaultModel || this.getProviderDefaultModel();
  }

  /**
   * Get the provider-specific default model
   */
  protected abstract getProviderDefaultModel(): string;

  /**
   * Format messages for the provider's API
   */
  protected abstract formatMessages(messages: Message[]): unknown;

  /**
   * Parse the provider's response into our common format
   */
  protected abstract parseResponse(response: unknown, latencyMs: number): CompletionResponse;

  /**
   * Handle API errors
   */
  protected handleError(error: unknown): never {
    this.logger.error({ error }, 'Provider error');
    
    if (error instanceof Error) {
      throw error;
    }
    
    throw new Error(`Provider error: ${String(error)}`);
  }

  /**
   * Sleep for retries
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute with retry logic
   */
  protected async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Don't retry on certain errors
        if (this.isNonRetryableError(lastError)) {
          throw lastError;
        }

        this.logger.warn({
          attempt: attempt + 1,
          maxRetries,
          error: lastError.message,
        }, 'Retrying operation');

        // Exponential backoff
        await this.sleep(Math.pow(2, attempt) * 1000);
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Check if an error should not be retried
   */
  protected isNonRetryableError(error: Error): boolean {
    const nonRetryablePatterns = [
      'invalid_api_key',
      'authentication',
      'unauthorized',
      'forbidden',
      'not_found',
      'invalid_request',
    ];

    const message = error.message.toLowerCase();
    return nonRetryablePatterns.some(pattern => message.includes(pattern));
  }
}
