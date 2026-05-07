# @mast-ai/openai

OpenAI `LlmAdapter`s for [MAST](https://github.com/andreban/mast-ai). Calls OpenAI directly from the browser, bypassing the URP backend entirely.

Two adapters ship side by side:

- **`OpenAIChatCompletionsAdapter`** wraps the [Chat Completions API](https://platform.openai.com/docs/api-reference/chat). Broad model coverage, works against OpenAI-compatible providers (OpenRouter, DeepSeek). Reasoning content from compatible providers is forwarded as `thinking` events; OpenAI itself does not expose reasoning content via this endpoint.
- **`OpenAIResponsesAdapter`** wraps the [Responses API](https://platform.openai.com/docs/api-reference/responses). Required to surface reasoning summaries from `gpt-5` and `o-series` models as `thinking` events.

Both support tool calling, streaming, and structured output.

## Install

```bash
npm install @mast-ai/core @mast-ai/openai
```

## Chat Completions usage

```typescript
import { AgentRunner, ToolRegistry, createAgent } from '@mast-ai/core';
import { OpenAIChatCompletionsAdapter } from '@mast-ai/openai';

const adapter = new OpenAIChatCompletionsAdapter(
  import.meta.env.VITE_OPENAI_API_KEY,
  'gpt-4o-mini',
);

const registry = new ToolRegistry();
// ...register tools...

const agent = createAgent({ name: 'Assistant', instructions: '...', tools: [] });
const runner = new AgentRunner(adapter, registry);

const result = await runner.run(agent, 'Hello!');
```

## Responses API usage (with reasoning)

```typescript
import { OpenAIResponsesAdapter } from '@mast-ai/openai';

const adapter = new OpenAIResponsesAdapter(apiKey, 'gpt-5', undefined, {
  reasoningEffort: 'medium',
  // reasoningSummary defaults to "auto"; set to false to disable thinking events.
});
```

`OpenAIResponsesAdapter` runs statelessly (`store: false`) — the runner's `Conversation` history is replayed on every request. With `reasoningSummary` set, every reasoning model call emits `thinking` events alongside the final text.

> **Note:** Calling OpenAI directly from the browser exposes your API key. Use this in trusted contexts (extensions, internal tools, demos) or front it with a proxy that injects the key server-side. Both adapters set `dangerouslyAllowBrowser: true` to permit browser usage of the official OpenAI SDK.

## License

Apache-2.0. Copyright 2026 Andre Cipriani Bandarra.
