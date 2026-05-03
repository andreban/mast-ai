# @mast-ai/core

Core runtime for [MAST](https://github.com/andreban/mast-ai), a TypeScript library that runs AI agent loops in the browser. The "think-act" loop, tool registry, and conversation state all live client-side; remote backends serve only as stateless reasoning engines.

## Install

```bash
npm install @mast-ai/core
```

## What's in the box

- **`AgentRunner`** — drives the think-act loop and emits an `AgentEvent` stream (text deltas, thinking, tool calls, tool results, done, error).
- **`ToolRegistry`** — browser-side tool store. Tools are plain TypeScript functions with direct access to the DOM, `localStorage`, and any client state.
- **`createAgent`** — config helper for agents (name, instructions, tool list).
- **`UrpAdapter`** + **`HttpTransport`** — connect to a Universal Reasoning Protocol (URP) backend over HTTP (JSON or SSE).
- **`LlmAdapter`** interface — swap in any inference source. See the sister packages `@mast-ai/google-genai` (direct browser-to-Gemini) and `@mast-ai/built-in-ai` (on-device via Chrome Prompt API).

## Quick start (Hybrid Mode)

```typescript
import { ToolRegistry, HttpTransport, UrpAdapter, AgentRunner, createAgent } from '@mast-ai/core';

const registry = new ToolRegistry().register({
  definition: () => ({
    name: 'getScreenResolution',
    description: "Returns the user's current screen width and height.",
    parameters: { type: 'object', properties: {}, required: [] },
  }),
  call: async () => ({ width: window.innerWidth, height: window.innerHeight }),
});

const agent = createAgent({
  name: 'BrowserAssistant',
  instructions: 'You are a helpful UI assistant. Use tools to answer questions about the screen.',
  tools: ['getScreenResolution'],
});

const transport = new HttpTransport({ url: 'http://localhost:3000/api/chat' });
const adapter = new UrpAdapter(transport);
const runner = new AgentRunner(adapter, registry);

const result = await runner.run(agent, 'How big is my screen?');
console.log(result.output);
```

## Documentation

- [Repository README](https://github.com/andreban/mast-ai/blob/main/README.md)
- [Product Requirements](https://github.com/andreban/mast-ai/blob/main/docs/PRD.md)
- [URP Protocol Spec](https://github.com/andreban/mast-ai/blob/main/docs/SPEC.md)

## License

Apache-2.0. Copyright 2026 Andre Cipriani Bandarra.
