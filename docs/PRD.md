# Product Requirements Document: MAST

## 1. Executive Summary
**MAST** (Modular Agent State Toolkit) is a TypeScript library that enables the execution of AI agent loops directly within web browsers. Unlike traditional frameworks that run the "brain" on a server, this kit treats the browser as the primary orchestrator. It allows agents to use local tools, call sub-agents regardless of where those sub-agents run (browser, server, or hybrid), and communicate with remote LLMs via a standardized, language-agnostic protocol.

## 2. Problem Statement
Existing agent frameworks are server-centric, which presents three major hurdles for web developers:
1.  **Limited Environment Access:** Servers cannot natively interact with a user's browser DOM, local storage, or client-side application state without complex, high-latency "callback" plumbing.
2.  **Privacy Concerns:** Processing local user files or sensitive browser data often requires uploading that data to a server for the agent to "see" it.
3.  **Rigid Architectures:** Most frameworks are tied to a specific backend language (Python/Node), making it difficult to share agent logic across different tech stacks.

## 3. Goals & Objectives
* **Client-Led Orchestration:** Shift the agentic "think-act" loop to the browser.
* **Environment Agnostic Inference:** Allow the client to use any backend (Python, Go, Rust, Ruby) for LLM reasoning.
* **Recursive Sub-Agents:** Enable agents to call other agents as tools. Each sub-agent may run in any execution mode — client-side, server-side, or hybrid — independently of its parent.
* **Native Tool Integration:** Provide a seamless way to wrap TypeScript functions and Browser APIs as agent tools.
* **Automatic History Management:** Provide a `Conversation` abstraction that tracks conversation history automatically across turns, so developers building multi-turn chatbots do not need to maintain a `Message[]` array manually.

---

## 4. Execution Mode Requirements
The kit must support three distinct operational modes, defined by where the Loop, Tools, and Inference occur.

| Component | Client-Side Mode | Server-Side Mode | Hybrid Mode |
| :--- | :--- | :--- | :--- |
| **Agent Loop** | Browser (TS) | Server (Any) | **Browser (TS)** |
| **Tool Execution** | Browser APIs | Server Resources | **Browser APIs** |
| **LLM Inference** | Local (e.g. WebLLM) | Server / Cloud | **Remote (via Protocol)** |

### 4.1 Hybrid Mode Requirements (Primary Focus)
* The client must maintain the "Source of Truth" for the conversation state.
* The client must be able to pause the loop, execute a local TypeScript tool, and resume the loop by sending results to the remote provider.

---

## 5. Functional Requirements

### 5.1 Agent Orchestration
* **The Loop:** The library must manage a stateful loop that handles `thought -> tool_call -> execution -> result -> response`.
* **Reasoning Models:** The library must support models with "extended thinking" or "reasoning tokens" by streaming `thinking` events to the consumer before final output or tool calls are issued.
* **Sub-Agent Support:** The library must allow any agent — regardless of its execution mode — to be registered as a `Tool` within another `Agent` instance. A sub-agent may run locally in the browser (client-side or hybrid) or on a remote server; the parent agent is unaware of where the sub-agent executes. The library must define a standard protocol (Agent Call Protocol) for calling server-side agent endpoints, and provide a standard interface (`AgentExecutor`) so third-party agent providers can be integrated without modifying core types. Sub-agent execution must not pollute the parent agent's conversation context — only the final tool result is appended to parent history.
* **Sub-Agent Event Streaming:** Tools that internally run sub-agents must be able to surface child events (thinking chunks, text deltas, tool calls) to the parent runner's consumer in real time, without blocking parallel tool execution. The `ToolContext` passed to every tool must carry an optional `onEvent` callback for this purpose. The `RunBuilder` must expose an `onToolEvent` hook so UI consumers can subscribe to child events and display sub-agent progress in real time.
* **Interruption Handling:** The loop must be capable of pausing for asynchronous tool execution (e.g., waiting for user input or a network fetch).

### 5.2 Tooling System
* **TypeScript Wrappers:** Developers must be able to define tools using standard TS functions with JSON Schema definitions.
* **Context Injection:** Tools must have access to the current browser context (DOM, state) without serializing that context to the server.

### 5.3 Universal Remote Protocol (URP)
The kit must implement a standardized communication layer to allow any backend to serve as the "Reasoning Engine."

* **Request Specification:** Must include `messages`, `available_tools` (metadata only), and `configuration` (temperature, max tokens).
* **Response Specification:** Must support `text_content`, `tool_calls` (with IDs and arguments), and `usage_metrics`.
* **Transport Independence:** The protocol must be compatible with fetch (HTTP POST) and WebSockets.

---

## 6. Non-Functional Requirements
* **Performance:** The core library must be under 20KB gzipped to avoid impacting page load times.
* **Thread Safety:** The loop should ideally run in a Web Worker to ensure the UI remains responsive (60fps) during complex reasoning cycles.
* **Type Safety:** The library must be written in strict TypeScript to provide compile-time guarantees for tool inputs and outputs.
* **Backend Agnosticism:** The library must not depend on any specific Node.js globals, ensuring compatibility with Edge Workers, Deno, and all modern browsers.

## 7. User Personas
* **The Frontend Engineer:** Wants to add an agent that can "operate" their SaaS dashboard by clicking buttons and reading tables on behalf of the user.
* **The Privacy-Conscious Architect:** Wants to build an agent that analyzes local spreadsheets in the browser, only sending high-level summaries to a cloud LLM.
* **The Full-Stack Polyglot:** Wants to write their agent logic in TypeScript but use an existing high-performance inference engine written in Go or Python.

---

## 8. Success Criteria
1.  **Protocol Compliance:** A developer can implement a compatible backend in a language other than JavaScript in under 50 lines of code.
2.  **Recursive Depth:** The library can successfully manage a "Grandparent" agent calling a "Parent" agent calling a "Child" agent without state collision.
3.  **Local Latency:** Executing a browser-native tool (e.g., `window.alert`) via the agent loop should happen in <10ms after the LLM decision is received.
