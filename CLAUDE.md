# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MAST (Modular Agent State Toolkit)** is a TypeScript library that moves AI agent loop execution into the web browser. The browser owns the "think-act" orchestration loop while remote backends serve as stateless reasoning engines. Tools execute locally in the browser (DOM, localStorage, client state); the server never executes tools.

## Commands

### Monorepo (npm workspace)

```bash
npm install              # Install all workspace dependencies
npm run build            # Build all packages
npm run lint             # Lint all packages (ESLint + typescript-eslint)
npm run format           # Format all files (Prettier)
```

### Core Library (`packages/core`)

```bash
npm run build            # Build with type declarations
npm run dev              # Watch mode
npm test                 # Run tests
npm run lint             # Lint
npm run format           # Format
```

### Google GenAI Adapter (`packages/google-genai`)

```bash
npm run build            # Build with type declarations
npm run dev              # Watch mode
npm test                 # Run tests
npm run lint             # Lint
npm run format           # Format
```

### Built-in AI Adapter (`packages/built-in-ai`)

```bash
npm run build            # Build with type declarations
npm run dev              # Watch mode
npm test                 # Run tests
npm run lint             # Lint
npm run format           # Format
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
├── conversation.ts  → Conversation history helpers
├── error.ts         → AgentError, AdapterError
├── adapter/
│   ├── index.ts     → LlmAdapter interface
│   └── urp.ts       → UrpAdapter (hybrid mode via HTTP)
└── transport/
    └── http.ts      → HttpTransport (fetch-based SSE/JSON)

packages/google-genai/src/
└── GoogleGenAIAdapter.ts  → LlmAdapter calling Google GenAI directly

packages/built-in-ai/src/
├── BuiltInAIAdapter.ts    → LlmAdapter wrapping Chrome Prompt API
└── tools/                 → summarize, translate, detectLanguage, proofread

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

### Packages

- **`@mast-ai/core`** — `AgentRunner`, `UrpAdapter`, `ToolRegistry`, all core types; no Node globals, browser-native
- **`@mast-ai/google-genai`** — `GoogleGenAIAdapter`: calls Google GenAI directly from the browser (no backend needed)
- **`@mast-ai/built-in-ai`** — `BuiltInAIAdapter`: wraps Chrome's built-in AI (Prompt API / Gemini Nano) as an `LlmAdapter`; also exposes browser built-in AI capabilities as MAST tools (`SummarizeTool`, `TranslateTool`, `DetectLanguageTool`, `ProofreadTool`)

### Key Abstractions

- **LlmAdapter** — swappable interface; `UrpAdapter` for remote backends, `GoogleGenAIAdapter` for direct API calls, `BuiltInAIAdapter` for on-device inference
- **URP (Universal Reasoning Protocol)** — the HTTP JSON/SSE protocol between browser and backend; defined in `docs/SPEC.md`
- **ToolRegistry** — browser-side tool store; server only receives tool metadata, never executes tools
- **AgentRunner** — emits `AgentEvent` stream (text delta, thinking, tool call, tool result, done, error)

## Tech Stack

| Layer                     | Technology                                   |
| ------------------------- | -------------------------------------------- |
| Package manager / runtime | npm                                          |
| Core library              | TypeScript, browser-native (no Node globals) |
| Frontend demo             | Vite, TypeScript                             |
| Backend demo              | Rust, Axum 0.8, Tokio, agent-rig (GitHub)    |
| LLM                       | Gemini 2.5 Flash via Google API              |
| Serialization             | Serde (Rust), native JSON (TS)               |

## Docs

- `docs/PRD.md` — problem statement, execution modes, success criteria
- `docs/SPEC.md` — type definitions and URP protocol schema
- `docs/urp-server/IMPLEMENTATION.md` — guide for implementing a compatible backend
- `docs/built-in-ai/` — plans and phase docs for the `@mast-ai/built-in-ai` package
- `docs/tool-event-streaming/` — plan for tool event streaming feature
- `docs/archive/` — completed planning documents

`docs/PRD.md` and `docs/SPEC.md` are library-level and live in the `docs/` root. Sub-feature docs go in a subdirectory under `docs/` with their own `PRD.md` and `SPEC.md`. When a feature is complete, move its subdirectory to `docs/archive/`. Do not rewrite or restructure files in `docs/archive/`.

Before starting work on a feature, check its subdirectory in `docs/` for context. When creating docs for a new feature, create a subdirectory under `docs/` and write a `PRD.md` and `SPEC.md` there.

**PRD.md and SPEC.md must be kept up to date throughout implementation.** Any change to requirements, technical decisions, or architecture must be reflected in the relevant doc before or alongside the code change. Both files must be current before opening a pull request.

## GitHub Issues

- Each feature has a GitHub label matching its `docs/` subdirectory name (e.g. `built-in-ai`).
- All issues belonging to a feature must carry that label. Create the label first if it doesn't exist.
- To see all issues for a feature: `gh issue list --label <feature-name>`.
- Issues must contain enough information to implement the task without needing to ask for clarification: relevant context, constraints, acceptance criteria, and any non-obvious decisions.
- Reference the PRD and SPEC by file path and section rather than repeating their content. Reference related issues by number where dependencies or shared context exist.
- Explicitly state dependencies with "Depends on #N" so the implementation order is clear. Before starting work on an issue, check that all its dependencies are merged.
- Implementation details (key decisions, non-obvious choices, patterns introduced) belong in the PR description, not in issue comments. When starting work on an issue with dependencies, read the PRs that closed those issues for implementation context.
- Always include `Closes #N` in the PR description so GitHub auto-closes the issue on merge.

## Git Conventions

- Do not add `Co-Authored-By` trailers to commit messages.
- Always run `npm run lint`, `npm run format`, `npm run build`, and `npm test` before committing and fix any failures.
- Always use `Edit` to modify existing files — never rewrite them wholesale with `Write`. Small diffs make reviews easier.
- Always ask the user to manually test before committing. Never commit or open a pull request until the user has confirmed the test passed.
- **Branch strategy:**
  1. Before starting work on an issue, check out `main` and pull the latest (`git checkout main && git pull`).
  2. Create a branch off `main` for the issue's work, namespacing by feature (e.g. `git checkout -b feat/built-in-ai/summarize-tool`).
  3. Open the PR against `main` (`gh pr create --base main`).
