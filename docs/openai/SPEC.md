# Technical Specification: `@mast-ai/openai`

## Public API

```typescript
import type {
  LlmAdapter,
  AdapterRequest,
  AdapterResponse,
  AdapterStreamChunk,
} from '@mast-ai/core';

export interface UsageMetadata {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface OpenAIChatCompletionsAdapterDefaults {
  /** Forwarded as `reasoning_effort` on every request when set. */
  reasoningEffort?: ReasoningEffort;
}

export class OpenAIChatCompletionsAdapter implements LlmAdapter {
  constructor(
    apiKey: string,
    modelName?: string, // defaults to "gpt-4o-mini"
    onUsageUpdate?: (usage: UsageMetadata) => void,
    defaults?: OpenAIChatCompletionsAdapterDefaults,
  );

  generate(request: AdapterRequest): Promise<AdapterResponse>;
  generateStream(request: AdapterRequest): AsyncIterable<AdapterStreamChunk>;
}

export type ReasoningSummary = 'auto' | 'concise' | 'detailed';

export interface OpenAIResponsesAdapterDefaults {
  /** Forwarded as `reasoning.effort` on every request when set. */
  reasoningEffort?: ReasoningEffort;
  /**
   * Forwarded as `reasoning.summary`. Defaults to `"auto"` so reasoning
   * summary deltas surface as `thinking` events. Pass `false` to suppress.
   */
  reasoningSummary?: ReasoningSummary | false;
}

export class OpenAIResponsesAdapter implements LlmAdapter {
  constructor(
    apiKey: string,
    modelName?: string, // defaults to "gpt-4o-mini"
    onUsageUpdate?: (usage: UsageMetadata) => void,
    defaults?: OpenAIResponsesAdapterDefaults,
  );

  generate(request: AdapterRequest): Promise<AdapterResponse>;
  generateStream(request: AdapterRequest): AsyncIterable<AdapterStreamChunk>;
}
```

Both constructors pass `dangerouslyAllowBrowser: true` to the underlying `OpenAI` client so the adapters work in browsers.

## `OpenAIChatCompletionsAdapter` (Chat Completions)

### Request Translation: `AdapterRequest` → `ChatCompletionCreateParams`

| `AdapterRequest` field     | OpenAI field                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `system`                   | `messages: [{ role: 'system', content }, ...]`                                                    |
| `messages`                 | `messages: [...]` (translated, see below)                                                         |
| `tools`                    | `tools: [{ type: 'function', function: { name, description, parameters } }]` (omitted when empty) |
| `outputSchema`             | `response_format: { type: 'json_schema', json_schema: { name: 'output', schema, strict: true } }` |
| `signal`                   | passed via SDK `requestOptions.signal`                                                            |
| `config.temperature`       | `temperature`                                                                                     |
| `config.maxTokens`         | `max_completion_tokens` (works for both reasoning and non-reasoning models)                       |
| `config.topP`              | `top_p`                                                                                           |
| `config.stopSequences`     | `stop`                                                                                            |
| `config.reasoning_effort`  | `reasoning_effort` (overrides `defaults.reasoningEffort`)                                         |
| `defaults.reasoningEffort` | `reasoning_effort` (only when `config.reasoning_effort` is unset)                                 |

Streaming requests additionally set `stream: true` and `stream_options: { include_usage: true }` so the final usage chunk is returned.

### Message Translation: `Message` → Chat Completions message

| `MessageContent.type` | OpenAI message shape                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `'text'`              | `{ role: 'user' \| 'assistant', content: text }`                                                                                    |
| `'tool_calls'`        | `{ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }` |
| `'tool_result'`       | `{ role: 'tool', tool_call_id: id, content: typeof result === 'string' ? result : JSON.stringify(result) }`                         |

### Response Translation

#### Non-streaming (`generate`)

- The first `choices[0]` entry is required; if missing, the adapter throws `Error('No choice returned from OpenAI')`.
- `message.content` becomes `AdapterResponse.text`.
- `message.tool_calls` is mapped to `AdapterResponse.toolCalls`. Function call arguments are JSON-parsed; on parse failure the raw string is forwarded so the runner can surface it.
- `usage` is forwarded via `onUsageUpdate` when provided.

#### Streaming (`generateStream`)

For every chunk:

1. Forward `usage` via `onUsageUpdate` if present.
2. Skip the chunk if `choices` is empty.
3. If `delta.reasoning_content` or `delta.reasoning` is a non-empty string, yield `{ type: 'thinking', delta }`.
4. If `delta.content` is a non-empty string, yield `{ type: 'text_delta', delta }`.
5. Accumulate `delta.tool_calls` fragments into a per-`index` map; on `finish_reason === 'tool_calls'`, emit one `{ type: 'tool_call' }` per accumulated entry in `index` order.

### Reasoning-Model Support

- `OpenAIChatCompletionsAdapterDefaults.reasoningEffort` provides a constructor-time default.
- Per-request override via `AdapterRequest.config.reasoning_effort` (forward-compatible with future runner-level config plumbing).
- Reasoning tokens emitted by OpenAI-compatible providers (OpenRouter, DeepSeek, etc.) on `delta.reasoning_content` (or `delta.reasoning`) are forwarded as `thinking` events.

The official OpenAI Chat Completions API does not surface reasoning content; reasoning still happens server-side and is billed as completion tokens. To get `thinking` events from native OpenAI reasoning models, use `OpenAIResponsesAdapter` instead.

## `OpenAIResponsesAdapter` (Responses API)

### Request Translation: `AdapterRequest` → `ResponseCreateParams`

| `AdapterRequest` field      | Responses field                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `system`                    | `instructions: string`                                                                             |
| `messages`                  | `input: ResponseInputItem[]` (heterogeneous, see below)                                            |
| `tools`                     | `tools: [{ type: 'function', name, description, parameters, strict: false }]` (omitted when empty) |
| `outputSchema`              | `text: { format: { type: 'json_schema', name: 'output', schema, strict: true } }`                  |
| `signal`                    | passed via SDK `requestOptions.signal`                                                             |
| `config.temperature`        | `temperature`                                                                                      |
| `config.maxTokens`          | `max_output_tokens`                                                                                |
| `config.topP`               | `top_p`                                                                                            |
| `config.reasoning_effort`   | `reasoning.effort` (overrides `defaults.reasoningEffort`)                                          |
| `defaults.reasoningEffort`  | `reasoning.effort` (only when `config.reasoning_effort` is unset)                                  |
| `defaults.reasoningSummary` | `reasoning.summary` (defaults to `"auto"`; pass `false` to suppress)                               |
| _always_                    | `store: false` (caller's `Conversation` replays full history each turn)                            |

### Input Translation: `Message` → `ResponseInputItem`

| `MessageContent.type` | Responses input item                                               |
| --------------------- | ------------------------------------------------------------------ |
| `'text'`              | `{ type: 'message', role, content: text }`                         |
| `'tool_calls'`        | one `{ type: 'function_call', call_id, name, arguments }` per call |
| `'tool_result'`       | `{ type: 'function_call_output', call_id: id, output }`            |

### Response Translation

#### Non-streaming (`generate`)

Walk `response.output[]`:

- For each `message` item, concatenate `content[].output_text` parts into `AdapterResponse.text`.
- For each `function_call` item, emit `{ id: call_id, name, args: parseArguments(arguments) }` into `AdapterResponse.toolCalls`.
- Other item types (`reasoning`, web search, etc.) are ignored in v1.
- `response.usage` (`input_tokens`, `output_tokens`, `total_tokens`) is forwarded via `onUsageUpdate`.

#### Streaming (`generateStream`)

| Event type                                  | Yielded chunk                                                |
| ------------------------------------------- | ------------------------------------------------------------ |
| `response.output_text.delta`                | `{ type: 'text_delta', delta }`                              |
| `response.reasoning_summary_text.delta`     | `{ type: 'thinking', delta }`                                |
| `response.reasoning_text.delta`             | `{ type: 'thinking', delta }`                                |
| `response.output_item.done` (function_call) | `{ type: 'tool_call', toolCall: { id, name, args } }`        |
| `response.completed`                        | _(no yield)_ — forwards `response.usage` via `onUsageUpdate` |

All other event types (`response.created`, `response.in_progress`, content part lifecycle, audio, MCP/file-search/etc.) are ignored.

### Reasoning Continuity Limitation

`OpenAIResponsesAdapter` runs with `store: false` and does not echo prior `reasoning` items back in subsequent input. Reasoning continuity within a single agent run (across tool round-trips) is therefore not preserved — the model performs reasoning fresh on each call. For continuous reasoning, a follow-up could opt in to `include: ['reasoning.encrypted_content']` and replay reasoning items in the next request's input.

## Error Handling

- Network and HTTP errors raised by the `openai` SDK propagate unchanged to the caller. The adapters do not wrap them in `AdapterError`; they already carry status code and response body context that the runner surfaces verbatim.
- `Error('No choice returned from OpenAI')` is thrown by `OpenAIChatCompletionsAdapter` only on a malformed non-streaming response.

## File Layout

```
packages/openai/
├── src/
│   ├── OpenAIChatCompletionsAdapter.ts        # Chat Completions adapter
│   ├── OpenAIChatCompletionsAdapter.test.ts
│   ├── OpenAIResponsesAdapter.ts       # Responses API adapter
│   ├── OpenAIResponsesAdapter.test.ts
│   └── index.ts                        # public exports
├── package.json
├── tsconfig.json
├── LICENSE
└── README.md
```

The package depends on `openai@^6` and `@mast-ai/core` only.
