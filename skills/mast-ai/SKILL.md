---
name: mast-ai
description: Guidance for building browser-native AI agents using the MAST (Modular Agent State Toolkit) library. Use when a user asks to implement an agent, add browser tools, configure the AgentRunner, or implement the Universal Remote Protocol (URP).
---

# MAST (Modular Agent State Toolkit) Developer Guide

This skill provides expert guidance for implementing AI agents using the MAST library. MAST shifts the execution of AI agent loops from the server directly into the web browser.

## Core Concepts

- **AgentRunner**: The core execution engine that runs in the browser. It owns the `LlmAdapter` and `ToolRegistry`.
- **ToolRegistry**: Registers standard TypeScript functions that have direct, synchronous access to the browser's DOM, `localStorage`, etc.
- **Adapters**: Connect the agent to a reasoning engine. 
  - `UrpAdapter` connects to a remote backend (Hybrid Mode).
  - `GoogleGenAIAdapter` (`@mast-ai/google-genai`) calls the Gemini API directly with tool calling, streaming, and thinking mode.
  - `BuiltInAIAdapter` (`@mast-ai/built-in-ai`) runs inference fully on-device via the browser Prompt API (no tool calling).
  - **Custom**: Implement `LlmAdapter` for other providers (Transformers.js, MediaPipe, etc.).

## Component References

When implementing MAST features, consult these references for API details and patterns:

- **Core API & Agent Configuration**: See [references/core-api.md](references/core-api.md) for `AgentConfig`, `AgentRunner`, `ToolRegistry`, and `Conversation`.
- **Adapters**: See [references/adapters.md](references/adapters.md) for `UrpAdapter` (HTTP transport), `GoogleGenAIAdapter`, and `BuiltInAIAdapter` with its built-in browser tools.
- **Custom Adapters**: See [references/custom-adapters.md](references/custom-adapters.md) for implementing your own `LlmAdapter` using Transformers.js, MediaPipe, etc.
- **Protocols (URP & ACP)**: See [references/protocols.md](references/protocols.md) if implementing a backend reasoning engine in Rust, Go, or Python.

## Installation

Because MAST is currently hosted on GitHub and not published to NPM, installation depends on your project context:

**Option A: Inside the MAST Monorepo (Recommended for Demos)**
If you are creating an app within the `apps/` directory of the MAST monorepo, use the workspace protocol in your `package.json`:
```json
"dependencies": {
  "@mast-ai/core": "workspace:*"
}
```

**Option B: External Projects (via GitHub)**
To install `@mast-ai/core` in an external project, you can install it directly from the GitHub repository. The `prepare` script will automatically build the library upon installation.

Using Bun or npm (if supported):
```bash
bun add github:andreban/mast-ai
```
*(Note: You may need to specify the workspace subdirectory depending on your package manager, e.g., `github:andreban/mast-ai#packages/core` or similar syntax)*

## Workflow: Creating a New Agent

1. **Define Tools**: Create browser-native tools and register them with `ToolRegistry`.
2. **Configure Agent**: Define an `AgentConfig` with instructions and tool names.
3. **Setup Adapter**: Use `UrpAdapter` for remote inference or implement a custom `LlmAdapter`.
4. **Run**: Instantiate an `AgentRunner` and use `runner.conversation(agent)` for stateful multi-turn interactions.

For a basic implementation example, see [assets/basic-agent.ts](assets/basic-agent.ts).
