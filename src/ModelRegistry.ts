import type { ModelInfo, ProviderType } from './types/index.js';

/**
 * Model Registry
 * 
 * Central registry for AI model information including:
 * - Context window sizes
 * - Default parameters
 * - Capability flags
 */
export class ModelRegistry {
  private models: Map<string, ModelInfo> = new Map();
  private static instance: ModelRegistry | null = null;

  private constructor() {
    this.initializeDefaultModels();
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry();
    }
    return ModelRegistry.instance;
  }

  /**
   * Initialize with default model information
   */
  private initializeDefaultModels(): void {
    // OpenAI Models
    this.register({
      id: 'gpt-4-turbo-preview',
      provider: 'openai',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsTools: true,
      supportsVision: true,
      defaultTemperature: 0.7,
      costPer1kInput: 0.01,
      costPer1kOutput: 0.03,
    });

    this.register({
      id: 'gpt-4o',
      provider: 'openai',
      contextWindow: 128000,
      maxOutputTokens: 16384,
      supportsTools: true,
      supportsVision: true,
      defaultTemperature: 0.7,
      costPer1kInput: 0.005,
      costPer1kOutput: 0.015,
    });

    this.register({
      id: 'gpt-4o-mini',
      provider: 'openai',
      contextWindow: 128000,
      maxOutputTokens: 16384,
      supportsTools: true,
      supportsVision: true,
      defaultTemperature: 0.7,
      costPer1kInput: 0.00015,
      costPer1kOutput: 0.0006,
    });

    this.register({
      id: 'gpt-3.5-turbo',
      provider: 'openai',
      contextWindow: 16385,
      maxOutputTokens: 4096,
      supportsTools: true,
      supportsVision: false,
      defaultTemperature: 0.7,
      costPer1kInput: 0.0005,
      costPer1kOutput: 0.0015,
    });

    // Anthropic Models
    this.register({
      id: 'claude-3-5-sonnet-20241022',
      provider: 'anthropic',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsVision: true,
      defaultTemperature: 0.7,
      costPer1kInput: 0.003,
      costPer1kOutput: 0.015,
    });

    this.register({
      id: 'claude-3-opus-20240229',
      provider: 'anthropic',
      contextWindow: 200000,
      maxOutputTokens: 4096,
      supportsTools: true,
      supportsVision: true,
      defaultTemperature: 0.7,
      costPer1kInput: 0.015,
      costPer1kOutput: 0.075,
    });

    this.register({
      id: 'claude-3-sonnet-20240229',
      provider: 'anthropic',
      contextWindow: 200000,
      maxOutputTokens: 4096,
      supportsTools: true,
      supportsVision: true,
      defaultTemperature: 0.7,
      costPer1kInput: 0.003,
      costPer1kOutput: 0.015,
    });

    this.register({
      id: 'claude-3-haiku-20240307',
      provider: 'anthropic',
      contextWindow: 200000,
      maxOutputTokens: 4096,
      supportsTools: true,
      supportsVision: true,
      defaultTemperature: 0.7,
      costPer1kInput: 0.00025,
      costPer1kOutput: 0.00125,
    });

    // Local Models (approximate values)
    this.register({
      id: 'llama3.2',
      provider: 'local',
      contextWindow: 8192,
      maxOutputTokens: 2048,
      supportsTools: false,
      supportsVision: false,
      defaultTemperature: 0.8,
    });

    this.register({
      id: 'llama3.1:70b',
      provider: 'local',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsTools: true,
      supportsVision: false,
      defaultTemperature: 0.8,
    });

    this.register({
      id: 'codellama:34b',
      provider: 'local',
      contextWindow: 16384,
      maxOutputTokens: 2048,
      supportsTools: false,
      supportsVision: false,
      defaultTemperature: 0.2,
    });

    this.register({
      id: 'mistral:7b',
      provider: 'local',
      contextWindow: 8192,
      maxOutputTokens: 2048,
      supportsTools: false,
      supportsVision: false,
      defaultTemperature: 0.7,
    });
  }

  /**
   * Register a model
   */
  register(model: ModelInfo): void {
    this.models.set(model.id, model);
  }

  /**
   * Get model info by ID
   */
  get(modelId: string): ModelInfo | undefined {
    return this.models.get(modelId);
  }

  /**
   * Check if a model is registered
   */
  has(modelId: string): boolean {
    return this.models.has(modelId);
  }

  /**
   * Get all models for a provider
   */
  getByProvider(provider: ProviderType): ModelInfo[] {
    return Array.from(this.models.values())
      .filter(model => model.provider === provider);
  }

  /**
   * Get all registered models
   */
  getAll(): ModelInfo[] {
    return Array.from(this.models.values());
  }

  /**
   * Get models that support a specific capability
   */
  getWithCapability(capability: 'tools' | 'vision'): ModelInfo[] {
    const key = capability === 'tools' ? 'supportsTools' : 'supportsVision';
    return Array.from(this.models.values())
      .filter(model => model[key]);
  }

  /**
   * Calculate estimated cost for a request
   */
  estimateCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number
  ): number | undefined {
    const model = this.get(modelId);
    if (!model || model.costPer1kInput === undefined || model.costPer1kOutput === undefined) {
      return undefined;
    }

    return (
      (inputTokens / 1000) * model.costPer1kInput +
      (outputTokens / 1000) * model.costPer1kOutput
    );
  }

  /**
   * Check if input fits within context window
   */
  fitsInContext(modelId: string, tokenCount: number): boolean {
    const model = this.get(modelId);
    return model ? tokenCount < model.contextWindow : false;
  }
}
