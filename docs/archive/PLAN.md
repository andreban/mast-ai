# Implementation Plan: MAST (Modular Agent State Toolkit)

## Agent Instructions (For New Chat Sessions)
If you are picking up this plan in a new session, you MUST:
1. **Read `docs/SPEC.md`:** Do not guess type definitions, interfaces, or protocol schemas. The exact structures for `Message`, `ToolCall`, `UrpAdapter`, etc., are explicitly defined in the technical spec.
2. **Read `docs/PRD.md`:** To understand the "Hybrid Mode" and why the browser is the orchestrator.
3. **Understand the Monorepo:** This is a Bun workspace. The core library is in `packages/core` and the demos are in `apps/`. Use `bun run build` to verify changes.

---

This document outlines the phased implementation of the MAST library and its integration into a suite of focused demo applications under the `apps/` directory. Each phase is designed to be a standalone PR that maintains project build integrity while showcasing specific features of the toolkit.

## Phase 1: Core Types & Protocol Definitions (PR #1) - COMPLETED
**Goal:** Establish the foundational type system and the Universal Remote Protocol (URP) schema.

- **Library Tasks:**
  - Define `Role`, `Message`, `MessageContent`, and `ToolCall` in `packages/core/src/types.ts`.
  - Define `AgentEvent` for reactive UI updates.
  - Define `ToolDefinition` and `Tool` interfaces.
  - Implement a basic `ToolRegistry` for managing local functions.
- **Demo Tasks (`apps/demo-basic-chat`):**
  - Rename the existing `apps/demo` to `apps/demo-basic-chat` (update workspace configurations if necessary).
  - Update the app to import and display the version/status of `@mast-ai/core`.
  - Stub out a basic tool (e.g., `getCurrentTime`) using the new registry types.
- **Success Criteria:** `bun run build` passes for both `packages/core` and `apps/demo-basic-chat`.

## Phase 2: Transport & Adapters (PR #2)
**Goal:** Implement the communication layer for remote LLMs.

- **Library Tasks:**
  - Define `LlmAdapter` and `ModelConfig`.
  - Implement `HttpTransport` using the standard `fetch` API.
  - Implement `UrpAdapter` (Universal Remote Protocol) for "Hybrid Mode" support.
- **Demo Tasks (`apps/demo-basic-chat`):**
  - Add a configuration panel to the demo to set "Remote Endpoint URL".
  - Implement a "Connection Test" button that uses the `HttpTransport`.
- **Success Criteria:** Demo can successfully "ping" a URP-compatible endpoint (even if mocked).

## Phase 3: The Agent Runner & The Loop (PR #3) - COMPLETED
**Goal:** Implement the "Thinking" loop and tool execution logic.

- **Library Tasks:**
  - Implement `AgentRunner` to manage conversation history and the execution loop.
  - Handle `tool_calls` by automatically invoking tools from the `ToolRegistry`.
  - Implement `RunBuilder` for a fluent API.
  - Implement `Conversation` for automatic multi-turn history management (`runner.conversation(agent)`).
- **Demo Tasks (`apps/demo-basic-chat`):**
  - Build a chat interface that uses `AgentRunner`.
  - Visualize the loop states: `Thinking` (including streaming reasoning tokens) -> `Executing Tool` -> `Responding`.
  - Migrate demo to use `Conversation` instead of manual history tracking.
- **Success Criteria:** A user can "chat" with a remote LLM and see local tools being triggered in the console/UI.

## Phase 4: Client-Side Mode (Chrome Prompt API) (PR #4)
**Goal:** Support on-device inference using Gemini Nano.

- **Library Tasks:**
  - Implement `PromptApiAdapter` wrapping `window.ai` (Chrome Prompt API).
  - Handle message translation between MAST types and Prompt API types.
- **Demo Tasks (`apps/demo-local-ai`):**
  - Scaffold a new application: `apps/demo-local-ai`.
  - Build a UI that runs entirely locally using `PromptApiAdapter`.
  - Display a warning/error if the browser doesn't support the Prompt API.
- **Success Criteria:** The new demo runs entirely locally (no network calls for inference).

## Phase 5: Recursive Agents (Sub-Agents) (PR #5)
**Goal:** Allow agents to be treated as tools by other agents.

- **Library Tasks:**
  - Implement `AgentExecutor` interface.
  - Implement `AgentTool` (a tool that, when called, runs another agent).
  - Add support for the Agent Call Protocol (ACP).
- **Demo Tasks (`apps/demo-sub-agents`):**
  - Scaffold a new application: `apps/demo-sub-agents`.
  - Create a "Manager Agent" demo that delegates tasks to a "Researcher Agent" tool.
  - Visualize the recursive calls in the UI (e.g., showing nested thought processes).
- **Success Criteria:** Nested agent loops function without state collision.

## Phase 6: Performance & Production Ready (PR #6)
**Goal:** Offload heavy logic and finalize the bundle.

- **Library Tasks:**
  - Implement `WorkerAgentRunner` to run the loop in a Web Worker.
  - Finalise bundle size optimisations.
  - Add comprehensive unit tests for the state machine.
- **Demo Tasks (`apps/demo-worker-perf`):**
  - Scaffold a new application: `apps/demo-worker-perf`.
  - Demonstrate UI responsiveness (60fps) during long-running "Thinking" cycles using the web worker architecture.
- **Success Criteria:** Bundle size < 20KB gzipped; all tests pass; performance demo remains responsive under heavy simulated load.
