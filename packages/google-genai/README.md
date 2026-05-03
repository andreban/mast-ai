# @mast-ai/google-genai

`LlmAdapter` for [MAST](https://github.com/andreban/mast-ai) backed by the [Google GenAI SDK](https://www.npmjs.com/package/@google/genai). Calls Gemini directly from the browser, bypassing the URP backend entirely.

Supports tool calling, streaming, and Gemini's thinking mode.

## Install

```bash
npm install @mast-ai/core @mast-ai/google-genai @google/genai
```

## Usage

```typescript
import { GoogleGenAI } from '@google/genai';
import { AgentRunner, ToolRegistry, createAgent } from '@mast-ai/core';
import { GoogleGenAIAdapter } from '@mast-ai/google-genai';

const client = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
const adapter = new GoogleGenAIAdapter(client, { model: 'gemini-2.5-flash' });

const registry = new ToolRegistry();
// ...register tools...

const agent = createAgent({ name: 'Assistant', instructions: '...', tools: [] });
const runner = new AgentRunner(adapter, registry);

const result = await runner.run(agent, 'Hello!');
```

> **Note:** Calling Gemini directly from the browser exposes your API key. Use this in trusted contexts (extensions, internal tools, demos) or front it with a proxy that injects the key server-side.

## License

Apache-2.0. Copyright 2026 Andre Cipriani Bandarra.
