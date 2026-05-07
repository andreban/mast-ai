# Product Requirements Document: `@mast-ai/openai`

## 1. Summary

`@mast-ai/openai` is the OpenAI counterpart to `@mast-ai/google-genai`. It calls OpenAI directly from the browser, removing the URP backend from the request path for developers who already have an OpenAI key and want a no-server demo or a Chrome extension that talks straight to OpenAI.

The package ships two `LlmAdapter` implementations:

- **`OpenAIChatCompletionsAdapter`** — wraps the [Chat Completions API](https://platform.openai.com/docs/api-reference/chat). De-facto-standard endpoint with the broadest model coverage; also works against OpenAI-compatible providers (OpenRouter, DeepSeek).
- **`OpenAIResponsesAdapter`** — wraps the [Responses API](https://platform.openai.com/docs/api-reference/responses). Required to surface reasoning summaries from `gpt-5` and o-series models as `thinking` events. Chat Completions does not expose reasoning content from OpenAI itself.

## 2. Goals

- **Drop-in adapters for OpenAI.** Anyone using `AgentRunner` with `UrpAdapter` should be able to swap in either adapter and have everything else (tools, conversation history, streaming, structured output) keep working.
- **Reasoning models from day one.** Reasoning models (`gpt-5`, `o4-mini`, ...) must work out of the box on both adapters. `OpenAIResponsesAdapter` defaults `reasoning.summary` to `"auto"` so thinking events appear with no extra setup.
- **Mirror `GoogleGenAIAdapter` shape.** Same constructor cadence (`apiKey, modelName, onUsageUpdate, defaults`), same lockstep version, same SDK-mocking test pattern.

## 3. Non-Goals

- **Server-side helpers.** Like all `@mast-ai/*` adapters, this package is browser-native. The `dangerouslyAllowBrowser` flag on the OpenAI SDK is set so the package works in the browser; users are responsible for not exposing keys publicly in production.
- **Token counting / billing helpers.** Both adapters forward `usage` via `onUsageUpdate` exactly as `GoogleGenAIAdapter` forwards `usageMetadata`. No additional accounting is in scope.
- **Stateful Responses API conversations.** `OpenAIResponsesAdapter` runs statelessly (`store: false`); the runner's `Conversation` replays history on every request. `previous_response_id` chaining is out of scope for v1.
- **Encrypted reasoning echoing across turns.** When using `store: false` with reasoning models, OpenAI offers an `include: ['reasoning.encrypted_content']` flow to keep reasoning continuous across multi-turn calls. Not implemented in v1; reasoning starts fresh on each turn.

## 4. Functional Requirements

### `OpenAIChatCompletionsAdapter` (Chat Completions)

- **`generate`** — single round-trip. Translates `AdapterRequest` → `chat.completions.create({ stream: false })`. Maps tool calls back to `AdapterResponse.toolCalls`.
- **`generateStream`** — async generator. Yields:
  - `{ type: 'thinking' }` for `delta.reasoning_content` / `delta.reasoning` (OpenAI-compatible providers).
  - `{ type: 'text_delta' }` for `delta.content`.
  - `{ type: 'tool_call' }` for accumulated `delta.tool_calls` once `finish_reason === 'tool_calls'`.
- **Tool support** — function tools mapped 1:1 from `ToolDefinition` to OpenAI `{ type: 'function', function: { name, description, parameters } }`. `tool_calls` and `tool_result` content types are reverse-mapped into Chat Completions message shapes (`role: 'assistant', tool_calls: [...]` and `role: 'tool', tool_call_id, content`).
- **Structured output** — when `request.outputSchema` is set, `response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }` is sent.
- **Reasoning configuration** — `OpenAIChatCompletionsAdapterDefaults.reasoningEffort` is forwarded as `reasoning_effort` on every request. A per-request `request.config.reasoning_effort` overrides the default if the runner ever populates it.
- **Cancellation** — `request.signal` is forwarded to the OpenAI SDK call.

### `OpenAIResponsesAdapter` (Responses API)

- **`generate`** — `responses.create({ stream: false, store: false })`. Walks the `output[]` array, concatenating `output_text` parts from `message` items into `AdapterResponse.text` and mapping each `function_call` item to `AdapterResponse.toolCalls`.
- **`generateStream`** — `responses.create({ stream: true, store: false })`. Maps the SSE event stream:
  - `response.output_text.delta` → `text_delta`
  - `response.reasoning_summary_text.delta` and `response.reasoning_text.delta` → `thinking`
  - `response.output_item.done` with a `function_call` item → `tool_call`
  - `response.completed` → forwards `usage` via `onUsageUpdate`
- **Input mapping** — `AdapterRequest.messages` becomes a heterogeneous `input` array: text turns are `{ type: 'message', role, content }`, `tool_calls` history items become one `{ type: 'function_call', call_id, name, arguments }` per call, and `tool_result` items become `{ type: 'function_call_output', call_id, output }`.
- **System prompt** — forwarded as the top-level `instructions` field, not as a message.
- **Tool support** — `FunctionTool` shape is flat (`{ type: 'function', name, description, parameters, strict: false }`).
- **Structured output** — `text.format = { type: 'json_schema', name, schema, strict: true }`.
- **Reasoning configuration** — `OpenAIResponsesAdapterDefaults.reasoningEffort` and `OpenAIResponsesAdapterDefaults.reasoningSummary` are forwarded as `reasoning.effort` and `reasoning.summary`. `reasoningSummary` defaults to `"auto"`; pass `false` to suppress thinking events.

## 5. Test Coverage

Unit tests (mocking the `openai` SDK constructor) must verify:

### `OpenAIChatCompletionsAdapter`

- Plain text generation surfaces `text` and updates usage.
- Tool calls (single and multiple, in correct order) round-trip through both `generate` and streaming `generateStream`.
- System instruction is prepended as a `system` message and omitted when absent.
- `tool_calls` and `tool_result` history messages are translated into the correct OpenAI shapes.
- `outputSchema` becomes a `json_schema` `response_format`.
- `temperature`, `maxTokens`, `topP`, `stopSequences` map to OpenAI fields (`temperature`, `max_completion_tokens`, `top_p`, `stop`).
- `defaults.reasoningEffort` and `request.config.reasoning_effort` both end up as `reasoning_effort` on the request, with the per-request value winning.
- `delta.reasoning_content` and `delta.reasoning` are emitted as `thinking` chunks.
- Streaming requests include `stream_options: { include_usage: true }`.
- Empty `choices` arrays in non-streaming responses raise an error; empty `choices` chunks in streaming responses are skipped.

### `OpenAIResponsesAdapter`

- Plain text generation walks `output[].message.content[]` for `output_text` parts and updates usage from `response.usage` (`input_tokens` / `output_tokens` / `total_tokens`).
- `function_call` output items map to `AdapterResponse.toolCalls`.
- System prompt is forwarded as `instructions`, not a message.
- `store: false` is set on every request.
- `tool_calls` and `tool_result` history items are emitted as `function_call` and `function_call_output` items in the input array.
- `FunctionTool` entries are flat (no nested `function: {}`).
- `defaults.reasoningSummary` defaults to `"auto"` and can be disabled by passing `false`.
- `defaults.reasoningEffort` becomes `reasoning.effort`; `request.config.reasoning_effort` overrides it.
- `outputSchema` becomes `text.format = { type: 'json_schema', ... }`.
- Streaming events `response.output_text.delta`, `response.reasoning_summary_text.delta`, `response.reasoning_text.delta`, and `response.output_item.done` (function call) map to the expected `AdapterStreamChunk` types.

## 6. Demo

`demos/openai/basic-chat` mirrors `demos/core/basic-chat` (calculator + getCurrentTime tools) but talks to OpenAI directly. The sidebar lets the user supply an API key (cached in `localStorage`), choose between the Chat Completions and Responses adapters, pick a model, and optionally choose a reasoning effort level. Any change rebuilds the adapter — and therefore the `Conversation` — so subsequent turns use the new settings.

The reasoning-effort dropdown is honoured only when the model is reasoning-capable (`o*` or `gpt-5*`); for other models it is silently ignored to avoid the API rejecting the request. The Responses adapter is the only path that surfaces reasoning summaries from native OpenAI models.

## 7. Release

`@mast-ai/openai` joins the lockstep release. Its initial version is `0.3.0`; it is bumped alongside `core`, `google-genai`, `built-in-ai`, and `react-ui` from the next release onward. Per the bootstrap procedure in [CLAUDE.md](../../CLAUDE.md#bootstrapping-a-new-package), the very first npm publish must be performed manually before the workflow can take over.
