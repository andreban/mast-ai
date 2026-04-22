# MAST (Modular Agent State Toolkit)

MAST is a TypeScript library that shifts the execution of AI agent loops from the server directly into the web browser. 

Traditional agent frameworks are server-centric, making it difficult for agents to securely access client-side DOM, browser APIs, or local user state without complex and high-latency callback plumbing. MAST solves this by treating the **browser as the primary orchestrator**.

## Key Features

* **Client-Led Orchestration:** The "think-act" loop (`thought -> tool_call -> execution -> result`) runs entirely in the browser using the `AgentRunner`.
* **Native Tool Integration:** Write tools as standard TypeScript functions that have direct, synchronous access to the browser's DOM, `localStorage`, and client state.
* **Environment Agnostic Inference:** Keep your agent logic in TypeScript, but use high-performance reasoning engines written in Go, Rust, or Python via the **Universal Remote Protocol (URP)**.
* **Hybrid & Client-Side Modes:** Run inference remotely via a URP server, or fully locally on-device using the Chrome Prompt API (Gemini Nano).

## Monorepo Structure

This project is an npm workspace containing the core library and several demo applications:

* `packages/core/` — The main MAST TypeScript library (`AgentRunner`, `RunBuilder`, Adapters, Types).
* `packages/google-genai/` — `LlmAdapter` backed by the Google Generative AI SDK (Gemini models).
* `packages/built-in-ai/` — `LlmAdapter` backed by the browser's Prompt API for fully on-device inference (no network requests).
* `apps/demo-basic-chat/` — A Vite-powered frontend demonstrating a Hybrid Mode chat agent with local tools.
* `apps/demo-prompt-api/` — A Vite-powered frontend demonstrating on-device inference via the browser Prompt API.
* `apps/demo-rust-server/` — A sample URP reasoning engine backend written in Rust (Axum + async channels).

## Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) (v18+) installed.

### Installation
Clone the repository and install dependencies from the root:
```bash
npm install
```

### Running the Demos

**Hybrid Mode** (remote reasoning backend + browser tools):

1. **Start the reasoning backend (Rust):**
   ```bash
   cd apps/demo-rust-server
   cargo run
   ```
2. **Start the frontend (in a new terminal):**
   ```bash
   cd apps/demo-basic-chat
   npm run dev
   ```

**On-device Mode** (Prompt API — no server required):

Requires Chrome with the built-in AI / Prompt API enabled.

```bash
cd apps/demo-prompt-api
npm run dev
```

Open the provided `localhost` URL in your browser to interact with the agent.

## Basic Usage

Here's a quick example of how to configure an agent, provide a local tool, and run a conversational turn:

```typescript
import { 
  ToolRegistry, 
  HttpTransport, 
  UrpAdapter, 
  AgentRunner, 
  createAgent 
} from '@mast-ai/core';

// 1. Define a tool that runs in the browser
const registry = new ToolRegistry().register({
  definition: () => ({
    name: 'getScreenResolution',
    description: 'Returns the user\'s current screen width and height.',
    parameters: { type: 'object', properties: {}, required: [] }
  }),
  call: async () => ({ width: window.innerWidth, height: window.innerHeight })
});

// 2. Define the Agent
const agent = createAgent({
  name: 'BrowserAssistant',
  instructions: 'You are a helpful UI assistant. Use tools to answer questions about the screen.',
  tools: ['getScreenResolution']
});

// 3. Connect to a reasoning backend (Hybrid Mode)
const transport = new HttpTransport({ url: 'http://localhost:3000/api/chat' });
const adapter = new UrpAdapter(transport);
const runner = new AgentRunner(adapter, registry);

// 4. Run the loop
const result = await runner.run(agent, 'How big is my screen?');
console.log(result.output);
```

## Documentation

For deep dives into the architecture and protocol definitions, please see our technical documentation:
* [Product Requirements (PRD)](./docs/PRD.md)
* [Technical Specification](./docs/SPEC.md)
* [Implementation Plan](./docs/PLAN.md)
* [URP Server Implementation Guide](./docs/URP_SERVER_IMPLEMENTATION.md)

## License

Copyright 2026 Andre Cipriani Bandarra

Licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE) for details.
