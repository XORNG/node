# XORNG Node

AI Provider Abstraction Layer for the XORNG Agentic Coding Framework.

## Overview

`@xorng/node` provides a unified interface for interacting with multiple AI providers:

- **OpenAI** - GPT-4, GPT-4o, GPT-3.5 Turbo
- **Anthropic** - Claude 3.5, Claude 3 Opus/Sonnet/Haiku
- **Local** - Ollama, LM Studio, LocalAI, vLLM (OpenAI-compatible)

## Installation

```bash
npm install @xorng/node

# Install provider SDKs (optional - only needed for providers you use)
npm install openai                  # For OpenAI
npm install @anthropic-ai/sdk       # For Anthropic
```

## Quick Start

```typescript
import { NodeManager } from '@xorng/node';

// Initialize from environment variables
const manager = new NodeManager();
manager.initializeFromEnvironment();

// Simple completion
const response = await manager.complete([
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello!' },
]);

console.log(response.content);
```

## Configuration

### Environment Variables

```bash
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_ORGANIZATION=org-...  # Optional

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Local LLM
LOCAL_LLM_URL=http://localhost:11434/v1  # Default
```

### Manual Provider Setup

```typescript
import { NodeManager } from '@xorng/node';

const manager = new NodeManager('info'); // log level

// Initialize specific providers
manager.initializeProvider('openai', {
  apiKey: 'sk-...',
  organization: 'org-...',
  timeout: 30000,
});

manager.initializeProvider('anthropic', {
  apiKey: 'sk-ant-...',
});

manager.initializeProvider('local', {
  baseUrl: 'http://localhost:11434/v1',
});

// Set default provider
manager.setDefaultProvider('anthropic');
```

## Usage

### Basic Completion

```typescript
const response = await manager.complete(
  [{ role: 'user', content: 'Write a haiku about coding' }],
  {
    model: 'claude-3-5-sonnet-20241022',
    temperature: 0.7,
    maxTokens: 1000,
  }
);

console.log(response.content);
console.log(`Tokens used: ${response.usage.totalTokens}`);
console.log(`Latency: ${response.latencyMs}ms`);
```

### Streaming

```typescript
for await (const chunk of manager.stream(
  [{ role: 'user', content: 'Tell me a story' }],
  { model: 'gpt-4o' }
)) {
  process.stdout.write(chunk.content);
}
```

### Tool Calling

```typescript
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name' },
        },
        required: ['location'],
      },
    },
  },
];

const response = await manager.complete(
  [{ role: 'user', content: 'What\'s the weather in Paris?' }],
  { tools }
);

if (response.toolCalls) {
  for (const call of response.toolCalls) {
    console.log(`Tool: ${call.function.name}`);
    console.log(`Args: ${call.function.arguments}`);
  }
}
```

### Model Registry

```typescript
import { ModelRegistry } from '@xorng/node';

const registry = ModelRegistry.getInstance();

// Get model info
const model = registry.get('claude-3-5-sonnet-20241022');
console.log(`Context window: ${model.contextWindow}`);
console.log(`Supports tools: ${model.supportsTools}`);

// Estimate cost
const cost = registry.estimateCost('gpt-4o', 1000, 500);
console.log(`Estimated cost: $${cost.toFixed(4)}`);

// Get models by capability
const toolModels = registry.getWithCapability('tools');
```

### Direct Provider Access

```typescript
// Get specific provider
const anthropic = manager.getProvider('anthropic');

// Use provider directly
const response = await anthropic.complete(messages, options);

// List available models
const models = await anthropic.listModels();
```

## API Reference

### NodeManager

| Method | Description |
|--------|-------------|
| `initializeProvider(type, config?, logLevel?)` | Initialize a specific provider |
| `initializeFromEnvironment(logLevel?)` | Auto-initialize from env vars |
| `getProvider(type)` | Get a provider instance |
| `setDefaultProvider(type)` | Set the default provider |
| `complete(messages, options?)` | Create a completion |
| `stream(messages, options?)` | Create a streaming completion |
| `listAllModels()` | List models from all providers |
| `validateAllCredentials()` | Validate all provider credentials |

### CompletionOptions

```typescript
interface CompletionOptions {
  model?: string;
  temperature?: number;  // 0-2
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  tools?: Tool[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  responseFormat?: { type: 'text' | 'json_object' };
  timeout?: number;
}
```

### CompletionResponse

```typescript
interface CompletionResponse {
  id: string;
  model: string;
  content: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  toolCalls?: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}
```

## Provider Comparison

| Feature | OpenAI | Anthropic | Local |
|---------|--------|-----------|-------|
| Streaming | ✅ | ✅ | ✅ |
| Tool Calling | ✅ | ✅ | Model-dependent |
| Vision | ✅ | ✅ | Model-dependent |
| JSON Mode | ✅ | ❌ | Model-dependent |
| Cost Tracking | ✅ | ✅ | ❌ |

## Architecture

```
NodeManager
├── Providers
│   ├── OpenAIProvider
│   ├── AnthropicProvider
│   └── LocalProvider
├── ModelRegistry
│   ├── Model Info
│   ├── Context Windows
│   └── Cost Estimates
└── Utilities
    └── Logger
```

## License

MIT
