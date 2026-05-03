# @mast-ai/built-in-ai

On-device inference for [MAST](https://github.com/andreban/mast-ai) via Chrome's [built-in AI](https://developer.chrome.com/docs/ai/built-in) (Prompt API / Gemini Nano). No server, no API key, no network round trip.

Also exposes browser AI capabilities as ready-to-register MAST tools: summarization, translation, language detection, and proofreading.

## Install

```bash
npm install @mast-ai/core @mast-ai/built-in-ai
```

Requires Chrome with the Prompt API and related built-in AI APIs enabled.

## Adapter

```typescript
import { AgentRunner, ToolRegistry, createAgent } from '@mast-ai/core';
import { BuiltInAIAdapter, checkAvailability } from '@mast-ai/built-in-ai';

const availability = await checkAvailability();
if (availability !== 'available') {
  throw new Error(`Prompt API not ready: ${availability}`);
}

const adapter = new BuiltInAIAdapter();
const runner = new AgentRunner(adapter, new ToolRegistry());

const agent = createAgent({ name: 'LocalAssistant', instructions: '...', tools: [] });
const result = await runner.run(agent, 'Hello!');
```

## Built-in tools

```typescript
import { ToolRegistry } from '@mast-ai/core';
import { addAllBuiltInAITools } from '@mast-ai/built-in-ai';

const registry = new ToolRegistry();
addAllBuiltInAITools(registry);
// Registers: summarize, translate, detectLanguage, proofread
```

Or register them individually: `SummarizeTool`, `TranslateTool`, `DetectLanguageTool`, `ProofreadTool`.

## License

Apache-2.0. Copyright 2026 Andre Cipriani Bandarra.
