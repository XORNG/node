import type {
  ProviderType,
  ProviderConfig,
  Message,
  CompletionOptions,
  CompletionResponse,
  StreamChunk,
} from './types/index.js';
import {
  BaseProvider,
  OpenAIProvider,
  AnthropicProvider,
  LocalProvider,
} from './providers/index.js';
import { ModelRegistry } from './ModelRegistry.js';
import { createLogger, type Logger } from './utils/logger.js';

/**
 * Node Manager
 * 
 * Central manager for AI providers.
 * Handles provider initialization, selection, and load balancing.
 */
export class NodeManager {
  private providers: Map<ProviderType, BaseProvider> = new Map();
  private logger: Logger;
  private modelRegistry: ModelRegistry;
  private defaultProvider: ProviderType = 'anthropic';

  constructor(logLevel: string = 'info') {
    this.logger = createLogger(logLevel, 'node-manager');
    this.modelRegistry = ModelRegistry.getInstance();
  }

  /**
   * Initialize a provider
   */
  initializeProvider(
    type: ProviderType,
    config?: ProviderConfig,
    logLevel?: string
  ): BaseProvider {
    let provider: BaseProvider;

    switch (type) {
      case 'openai':
        provider = new OpenAIProvider(config, logLevel);
        break;
      case 'anthropic':
        provider = new AnthropicProvider(config, logLevel);
        break;
      case 'local':
        provider = new LocalProvider(config, logLevel);
        break;
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }

    this.providers.set(type, provider);
    this.logger.info({ type }, 'Provider initialized');

    return provider;
  }

  /**
   * Get a provider by type
   */
  getProvider(type: ProviderType): BaseProvider | undefined {
    return this.providers.get(type);
  }

  /**
   * Get provider for a specific model
   */
  getProviderForModel(modelId: string): BaseProvider | undefined {
    const modelInfo = this.modelRegistry.get(modelId);
    if (!modelInfo) {
      // Try to infer provider from model ID
      if (modelId.startsWith('gpt-')) {
        return this.providers.get('openai');
      }
      if (modelId.startsWith('claude-')) {
        return this.providers.get('anthropic');
      }
      return this.providers.get('local');
    }

    return this.providers.get(modelInfo.provider);
  }

  /**
   * Set the default provider
   */
  setDefaultProvider(type: ProviderType): void {
    if (!this.providers.has(type)) {
      throw new Error(`Provider ${type} not initialized`);
    }
    this.defaultProvider = type;
    this.logger.info({ type }, 'Default provider set');
  }

  /**
   * Get the default provider
   */
  getDefaultProvider(): BaseProvider | undefined {
    return this.providers.get(this.defaultProvider);
  }

  /**
   * Get all initialized providers
   */
  getAllProviders(): Map<ProviderType, BaseProvider> {
    return this.providers;
  }

  /**
   * Check which providers are ready
   */
  getReadyProviders(): ProviderType[] {
    const ready: ProviderType[] = [];
    for (const [type, provider] of this.providers) {
      if (provider.isReady()) {
        ready.push(type);
      }
    }
    return ready;
  }

  /**
   * Create a completion using the appropriate provider
   */
  async complete(
    messages: Message[],
    options?: CompletionOptions & { provider?: ProviderType }
  ): Promise<CompletionResponse> {
    const provider = this.resolveProvider(options?.model, options?.provider);
    
    if (!provider) {
      throw new Error('No provider available for completion');
    }

    return provider.complete(messages, options);
  }

  /**
   * Create a streaming completion
   */
  async *stream(
    messages: Message[],
    options?: CompletionOptions & { provider?: ProviderType }
  ): AsyncGenerator<StreamChunk> {
    const provider = this.resolveProvider(options?.model, options?.provider);
    
    if (!provider) {
      throw new Error('No provider available for streaming');
    }

    yield* provider.stream(messages, options);
  }

  /**
   * Resolve which provider to use
   */
  private resolveProvider(
    modelId?: string,
    preferredProvider?: ProviderType
  ): BaseProvider | undefined {
    // If specific provider requested, use it
    if (preferredProvider) {
      return this.providers.get(preferredProvider);
    }

    // If model specified, find appropriate provider
    if (modelId) {
      return this.getProviderForModel(modelId);
    }

    // Use default provider
    return this.getDefaultProvider();
  }

  /**
   * List all available models across providers
   */
  async listAllModels(): Promise<Map<ProviderType, string[]>> {
    const result = new Map<ProviderType, string[]>();

    for (const [type, provider] of this.providers) {
      try {
        const models = await provider.listModels();
        result.set(type, models);
      } catch (error) {
        this.logger.warn({ type, error }, 'Failed to list models');
        result.set(type, []);
      }
    }

    return result;
  }

  /**
   * Validate all provider credentials
   */
  async validateAllCredentials(): Promise<Map<ProviderType, boolean>> {
    const result = new Map<ProviderType, boolean>();

    for (const [type, provider] of this.providers) {
      try {
        const valid = await provider.validateCredentials();
        result.set(type, valid);
      } catch {
        result.set(type, false);
      }
    }

    return result;
  }

  /**
   * Get the model registry
   */
  getModelRegistry(): ModelRegistry {
    return this.modelRegistry;
  }

  /**
   * Initialize all providers from environment
   */
  initializeFromEnvironment(logLevel: string = 'info'): void {
    // OpenAI
    if (process.env['OPENAI_API_KEY']) {
      this.initializeProvider('openai', {}, logLevel);
    }

    // Anthropic
    if (process.env['ANTHROPIC_API_KEY']) {
      this.initializeProvider('anthropic', {}, logLevel);
    }

    // Local (always try to initialize)
    const localUrl = process.env['LOCAL_LLM_URL'] || 'http://localhost:11434/v1';
    this.initializeProvider('local', { baseUrl: localUrl }, logLevel);

    // Set default based on what's available
    const ready = this.getReadyProviders();
    if (ready.includes('anthropic')) {
      this.setDefaultProvider('anthropic');
    } else if (ready.includes('openai')) {
      this.setDefaultProvider('openai');
    } else if (ready.includes('local')) {
      this.setDefaultProvider('local');
    }

    this.logger.info({
      providers: Array.from(this.providers.keys()),
      ready,
      default: this.defaultProvider,
    }, 'Providers initialized from environment');
  }
}
