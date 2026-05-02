# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MAST (Modular Agent State Toolkit)** is a TypeScript library that moves AI agent loop execution into the web browser. The browser owns the "think-act" orchestration loop while remote backends serve as stateless reasoning engines. Tools execute locally in the browser (DOM, localStorage, client state); the server never executes tools.

## Commands

### Monorepo (npm workspace)
```bash
npm install              # Install all workspace dependencies
npm run build            # Build all packages
```

### Core Library (`packages/core`)
```bash
npm run build            # Build with type declarations
npm run dev              # Watch mode
npm test                 # Run tests
```

### Frontend Demo (`apps/demo-basic-chat`)
```bash
npm run dev              # Start Vite dev server (http://localhost:5173)
npm run build            # Production build
npm run preview          # Preview production build
```

### Rust Backend (`apps/demo-rust-server`)
```bash
cargo run                # Start URP server (http://127.0.0.1:3000)
cargo build --release    # Release build
```

Requires a `.env` file in `apps/demo-rust-server/` with `GEMINI_API_KEY=...`.

### Running the Full Stack Demo
1. Start the Rust backend: `cd apps/demo-rust-server && cargo run`
2. Start the frontend: `cd apps/demo-basic-chat && npm run dev`

## Architecture

```
packages/core/src/
├── runner.ts        → AgentRunner: drives the think-act loop
├── agent.ts         → createAgent() config validation
├── tool.ts          → Tool interface & ToolRegistry
├── types.ts         → Message, ToolCall, AgentEvent, AgentConfig
├── error.ts         → AgentError, AdapterError
├── adapter/
│   ├── index.ts     → LlmAdapter interface
│   └── urp.ts       → UrpAdapter (hybrid mode via HTTP)
└── transport/
    └── http.ts      → HttpTransport (fetch-based SSE/JSON)

apps/demo-basic-chat/src/
└── main.ts          → Chat UI wiring ToolRegistry + AgentRunner

apps/demo-rust-server/src/
├── main.rs          → Axum server, CORS, routes
├── provider.rs      → URP request handler, streaming, agent-rig integration
└── types.rs         → URP request/response types
```

### Execution Flow (Hybrid Mode)

1. Browser builds an `AdapterRequest` (conversation history + tool definitions)
2. `UrpAdapter` POSTs to the backend via `HttpTransport` (JSON or SSE streaming)
3. Backend (Rust/Axum) calls the LLM (Gemini 2.5 Flash via agent-rig) — stateless
4. If LLM returns tool calls, `AgentRunner` executes them locally via `ToolRegistry`
5. Tool results are injected into history and the loop repeats until a final text response

### Key Abstractions

- **LlmAdapter** — swappable interface; `UrpAdapter` for remote backends, future `PromptApiAdapter` for local inference (Chrome Prompt API / Gemini Nano)
- **URP (Universal Reasoning Protocol)** — the HTTP JSON/SSE protocol between browser and backend; defined in `docs/SPEC.md`
- **ToolRegistry** — browser-side tool store; server only receives tool metadata, never executes tools
- **AgentRunner** — emits `AgentEvent` stream (text delta, thinking, tool call, tool result, done, error)

## Tech Stack

| Layer | Technology |
|---|---|
| Package manager / runtime | npm |
| Core library | TypeScript, browser-native (no Node globals) |
| Frontend demo | Vite, TypeScript |
| Backend demo | Rust, Axum 0.8, Tokio, agent-rig (GitHub) |
| LLM | Gemini 2.5 Flash via Google API |
| Serialization | Serde (Rust), native JSON (TS) |

## Docs

- `docs/PRD.md` — problem statement, execution modes, success criteria
- `docs/SPEC.md` — type definitions and URP protocol schema
- `docs/PLAN.md` — 6-phase implementation roadmap (Phase 3 complete as of initial commits)
- `docs/URP_SERVER_IMPLEMENTATION.md` — guide for implementing a compatible backend
