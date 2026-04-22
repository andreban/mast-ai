# Built-in AI — Phase 1: `BuiltInAIAdapter` (Prompt API)

## Goal

Implement `BuiltInAIAdapter` using the browser's Prompt API, exposing on-device text generation through the standard MAST `LlmAdapter` interface. No tool calling support (documented limitation).

## Reference Implementation

Use `packages/google-genai/src/GoogleGenAIAdapter.ts` as the structural reference — file layout, copyright header, constructor pattern, and mapping helpers. The core interface to implement lives in `packages/core/src/adapter/index.ts`.

---

## `LlmAdapter` Interface

```typescript
// packages/core/src/adapter/index.ts

export interface AdapterRequest {
  messages: Message[];       // full conversation history
  system?: string;           // system prompt
  tools: ToolDefinition[];   // always empty for BuiltInAIAdapter (no tool support)
  outputSchema?: Record<string, unknown>;
  config?: ModelConfig;
  signal?: AbortSignal;
}

export interface AdapterResponse {
  text?: string;             // undefined when tool calls were issued
  toolCalls: ToolCall[];     // always [] for BuiltInAIAdapter
}

export type AdapterStreamChunk =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking';   delta: string }
  | { type: 'tool_call';  toolCall: ToolCall };

export interface LlmAdapter {
  generate(request: AdapterRequest): Promise<AdapterResponse>;
  generateStream?(request: AdapterRequest): AsyncIterable<AdapterStreamChunk>;
}
```

`Message` (from `packages/core/src/types.ts`):

```typescript
export type Role = 'user' | 'assistant';

export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'tool_calls'; calls: ToolCall[] }
  | { type: 'tool_result'; id: string; name: string; result: unknown };

export interface Message {
  role: Role;
  content: MessageContent;
}
```

---

## Prompt API Overview

The Prompt API exposes an on-device language model via the `LanguageModel` bare global. Key operations:

```typescript
// Check availability
const availability = await LanguageModel.availability(options?);
// → "readily" | "after-download" | "downloading" | "unavailable"

// Create a session
const session = await LanguageModel.create(options?);

// Prompt (blocking)
const text = await session.prompt(input, options?);

// Prompt (streaming)
const stream = session.promptStreaming(input, options?);
for await (const chunk of stream) { /* each chunk is a text delta, not cumulative */ }

// Free resources
session.destroy();
```

---

## Mapping MAST → Prompt API

### Messages and System Prompt

MAST passes conversation history as `Message[]` and a separate `system` string. The Prompt API maps these to `initialPrompts` on session creation and the ongoing `session.prompt()` call.

**Proposed mapping:**

| MAST | Prompt API |
|------|-----------|
| `request.system` | `{ role: "system", content: system }` as first entry in `initialPrompts` |
| `request.messages` (all but last) | Remaining entries in `initialPrompts` |
| `request.messages` (last user message) | Argument to `session.prompt()` / `session.promptStreaming()` |

The Prompt API supports `role: "user" | "assistant" | "system"` in `initialPrompts`, so this mapping is clean. The last message is separated out because the API expects prompts to be sent via `prompt()`, not injected into history.

### Session Lifecycle

The Prompt API session is stateful — each `session.prompt()` call appends to its internal context (including KV cache). MAST's `generate()` is stateless (it receives the full history each call), so the adapter must bridge that gap.

**Strategy — cached session with history matching:**

Cache one session alongside the list of messages already fed into it. On each `generate()` call:

- **History is an extension of the cache** (common case — ongoing conversation): the session already holds the earlier context, so call `session.prompt(newTurn)` directly. O(1) cost.
- **History has diverged** (different conversation, or messages were edited): destroy the cached session and create a new one with the full history in `initialPrompts`. O(n) cost, but only on a cache miss.

`session.clone()` is not used here. Cloning forks the session's KV cache cheaply, but it would require keeping a frozen root session and discarding the clone after every turn — paying the clone cost every turn with no benefit for a linear conversation.

**History comparison:** Use an optimistic length + last-message check. Verify that `cachedHistory.length === request.messages.length - 1`, then spot-check that `request.messages[cachedHistory.length - 1]` matches the last cached message. O(1) cost per turn. This is sound because MAST's `Conversation` is append-only — if length and the most recent message match, the rest is guaranteed to be the same.

### Context Window

The API exposes `session.contextUsage` and `session.contextWindow` (token counts) and fires a `contextoverflow` event when the context is full. On a cache miss, a new session is created with the full history in `initialPrompts`, which could exceed the context window for long conversations.

**Proposed handling:** After session creation, check `contextUsage < contextWindow`. If the context is already full before prompting, throw an `AdapterError` with a descriptive message rather than letting it fail silently.

### AbortSignal

The Prompt API supports `signal` both on `LanguageModel.create()` and on `session.prompt()` / `session.promptStreaming()`. MAST passes `request.signal` through.

**Proposed handling:**
- Pass `request.signal` to `LanguageModel.create()` so session creation itself is cancellable.
- Pass `request.signal` to `session.prompt()` / `session.promptStreaming()` for the actual generation.
- Call `session.destroy()` in a `finally` block to always free resources.

### Availability Checking

`LanguageModel.availability()` should be called before attempting session creation to give meaningful errors.

**Proposed handling:** Export a standalone `checkAvailability()` helper that returns the availability string. Inside the adapter, if availability is `"unavailable"`, throw an `AdapterError` immediately. If `"after-download"` or `"downloading"`, throw with a message instructing the user to wait for the model download — we will not block on the download inside the adapter, as this could hang indefinitely.

### Model Download Progress

`LanguageModel.create()` accepts a `monitor` option for tracking download progress. This is only relevant when availability is `"after-download"`.

**Proposed handling:** Expose an optional `onDownloadProgress` callback in `BuiltInAIAdapterOptions`, mirroring the `onUsageUpdate` pattern in `GoogleGenAIAdapter`. The callback receives `{ loaded: number, total: number }`.

---

## TypeScript Types (`types.ts`)

The Prompt API is not yet in `lib.dom.d.ts`. The package must declare the global interface. Key types to declare:

```typescript
type LanguageModelAvailability = "readily" | "after-download" | "downloading" | "unavailable";

interface LanguageModelMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface LanguageModelCreateOptions {
  signal?: AbortSignal;
  initialPrompts?: LanguageModelMessage[];
  // systemPrompt exists in the spec but is not used — system prompt is
  // injected as a { role: "system" } entry in initialPrompts instead.
  monitor?: (monitor: EventTarget) => void;
  // temperature and topK are only available in the Chrome extension version
  // of the Prompt API and have been removed from the browser version — omitted.
}

interface LanguageModelPromptOptions {
  signal?: AbortSignal;
}

interface LanguageModelSession {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
  promptStreaming(input: string, options?: LanguageModelPromptOptions): ReadableStream<string>;
  contextUsage: number;
  contextWindow: number;
  destroy(): void;
  addEventListener(type: "contextoverflow", listener: EventListener): void;
}

declare const LanguageModel: {
  availability(options?: Partial<LanguageModelCreateOptions>): Promise<LanguageModelAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
};
```


---

## Documented Limitation

`BuiltInAIAdapter` does not support tool calling. The Prompt API has no native mechanism for structured tool invocation. If tools are registered with a runner backed by this adapter, they will never be called — `toolCalls` in every response will be `[]`. This should be:

1. Stated in the JSDoc on the class.
2. Logged as a warning if `request.tools.length > 0` is detected at runtime.

---

## Package Config

**`package.json`:**
```json
{
  "name": "@mast-ai/built-in-ai",
  "version": "0.1.0",
  "license": "Apache-2.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsup src/index.ts --format esm --minify --out-dir dist && tsc --emitDeclarationOnly --rootDir src --outDir dist",
    "dev": "tsup src/index.ts --format esm --out-dir dist --watch",
    "test": "vitest"
  },
  "dependencies": {
    "@mast-ai/core": "*"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "~6.0.2",
    "vitest": "^4.1.4"
  }
}
```

**`tsconfig.json`** (identical to all other packages):
```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleDetection": "force",
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,
    "declaration": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

---

## `index.ts` Exports

```typescript
// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

export { BuiltInAIAdapter } from './BuiltInAIAdapter.js';
export type { BuiltInAIAdapterOptions } from './BuiltInAIAdapter.js';
```

The `tools/` exports are deferred to later phases.

---

## Files to Create

```
packages/built-in-ai/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── BuiltInAIAdapter.ts
    ├── BuiltInAIAdapter.test.ts
    └── types.ts
```

The `tools/` directory is deferred to Phase 2.

---

