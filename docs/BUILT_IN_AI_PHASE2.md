# Built-in AI — Phase 2: Summarizer Tool

## Goal

Implement a `summarize` MAST `Tool` backed by the browser's Summarizer API, and add it to the `@mast-ai/built-in-ai` package. Any agent — regardless of which `LlmAdapter` it uses — can register this tool to condense long-form content on-device.

---

## Reference

Use `packages/built-in-ai/src/BuiltInAIAdapter.ts` as the structural reference for copyright header, import style, and `AdapterError` usage.

The `Tool` interface to implement lives in `packages/core/src/tool.ts`:

```typescript
export interface Tool<TArgs = unknown, TResult = unknown> {
  definition(): ToolDefinition;
  call(args: TArgs, context: ToolContext): Promise<TResult>;
}
```

`ToolContext` carries an optional `AbortSignal`:

```typescript
export interface ToolContext {
  signal?: AbortSignal;
}
```

---

## Summarizer API Overview

The Summarizer API exposes on-device text summarization via the `Summarizer` bare global.

```typescript
// Check availability
const availability = await Summarizer.availability(options?);
// → "readily" | "after-download" | "downloading" | "unavailable"

// Create a summarizer
const summarizer = await Summarizer.create(options?);

// Summarize (blocking)
const summary = await summarizer.summarize(text, options?);

// Summarize (streaming)
const stream = summarizer.summarizeStreaming(text, options?);
for await (const chunk of stream) { /* progressive output */ }

// Free resources
summarizer.destroy();
```

### Creation options

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| `type` | `'key-points' \| 'tl;dr' \| 'teaser' \| 'headline'` | `'key-points'` | Shape of the summary |
| `format` | `'plain-text' \| 'markdown'` | `'plain-text'` | Output format |
| `length` | `'short' \| 'medium' \| 'long'` | `'medium'` | Target length |
| `sharedContext` | `string` | — | Domain context applied to every call on this instance |
| `signal` | `AbortSignal` | — | Cancels creation |
| `monitor` | `(m: EventTarget) => void` | — | Download progress |

### Per-call options

| Option | Type | Notes |
|--------|------|-------|
| `context` | `string` | Per-call context hint to guide summarization |
| `signal` | `AbortSignal` | Cancels this call |

### Key design constraint

The `type`, `format`, and `length` options are **baked into the summarizer instance at creation time**, not per-call. If a caller requests a combination that differs from an existing instance, a new summarizer must be created. The tool caches one summarizer instance and recreates it when the options change.

---

## Tool Design

### Input schema

```typescript
export interface SummarizeArgs {
  text: string;
  type?: 'key-points' | 'tl;dr' | 'teaser' | 'headline';
  format?: 'plain-text' | 'markdown';
  length?: 'short' | 'medium' | 'long';
  context?: string;
}
```

### Output

The tool returns the summary as a plain `string`.

### Tool name

`"summarize"`

### Tool description

`"Summarize a piece of text using an on-device AI model. Returns a condensed version according to the requested type, format, and length."`

### `definition()` parameters JSON Schema

```typescript
{
  type: 'object',
  properties: {
    text:    { type: 'string' },
    type:    { type: 'string', enum: ['key-points', 'tl;dr', 'teaser', 'headline'] },
    format:  { type: 'string', enum: ['plain-text', 'markdown'] },
    length:  { type: 'string', enum: ['short', 'medium', 'long'] },
    context: { type: 'string' },
  },
  required: ['text'],
}
```

---

## Implementation: `SummarizeTool`

The tool is implemented as a class. Consumers never instantiate it directly — they call the static `SummarizeTool.addToRegistry()` method, which handles availability checking and registration as a single async operation.

```typescript
// packages/built-in-ai/src/tools/summarize.ts

export interface SummarizeToolOptions {
  onDownloadProgress?: (progress: { loaded: number; total: number }) => void;
}

export class SummarizeTool implements Tool<SummarizeArgs, string> {
  static async addToRegistry(
    registry: ToolRegistry,
    options?: SummarizeToolOptions,
  ): Promise<void> { ... }

  definition(): ToolDefinition { ... }
  call(args: SummarizeArgs, context: ToolContext): Promise<string> { ... }
}
```

### `addToRegistry` — availability and registration

`addToRegistry` is the single entry point for registration. Before calling `Summarizer.availability()`, it must guard against the API being absent entirely — if the browser does not support the Summarizer API, `Summarizer` is `undefined` and calling any method on it throws a `ReferenceError`.

**Step 1 — API existence check:**
```typescript
if (typeof Summarizer === 'undefined') {
  throw new AdapterError('Summarizer API is not supported in this browser.');
}
```

**Step 2 — availability check.** It then handles all three meaningful availability states:

| `Summarizer.availability()` | Behaviour |
|-----------------------------|-----------|
| `"unavailable"` | Rejects with `AdapterError("Summarizer API is unavailable on this device.")` |
| `"readily"` | Registers the tool immediately. The first `call()` will create the summarizer instance lazily. |
| `"after-download"` / `"downloading"` | Calls `Summarizer.create()` with a `monitor` to await the download. Once `create()` resolves the promise, caches the resulting instance and registers the tool. |

The `"after-download"` / `"downloading"` path leverages the fact that `Summarizer.create()` does not resolve until the model is ready — the `monitor` callback just surfaces progress events to the caller via `onDownloadProgress`. The returned `Promise<void>` from `addToRegistry` resolves only after the tool has been added to the registry.

### Instance caching in `call()`

`call()` also guards against the API being absent, as a safety net for callers who construct `SummarizeTool` directly without going through `addToRegistry`:

```typescript
if (typeof Summarizer === 'undefined') {
  throw new AdapterError('Summarizer API is not supported in this browser.');
}
```

Cache one `SummarizerSession` alongside the creation options it was built with (`type`, `format`, `length`). On each `call()`:

1. If the cached instance's options match the request's `type`/`format`/`length` — reuse it.
2. If they differ — destroy the old instance and create a new one.
3. Always destroy in a `finally` block if creation of a replacement fails.

When `addToRegistry` pre-warmed an instance (download case), it is stored as the initial cache entry with default options (`type: undefined, format: undefined, length: undefined`).

### AbortSignal

Pass `context.signal` to both `Summarizer.create()` and `summarizer.summarize()`.

---

## TypeScript Types (`types.ts` additions)

The Summarizer API is not in `lib.dom.d.ts`. Add the following to `packages/built-in-ai/src/types.ts`:

```typescript
export type SummarizerAvailability =
  | "readily"
  | "after-download"
  | "downloading"
  | "unavailable";

export type SummarizerType = "key-points" | "tl;dr" | "teaser" | "headline";
export type SummarizerFormat = "plain-text" | "markdown";
export type SummarizerLength = "short" | "medium" | "long";

export interface SummarizerCreateOptions {
  type?: SummarizerType;
  format?: SummarizerFormat;
  length?: SummarizerLength;
  sharedContext?: string;
  signal?: AbortSignal;
  monitor?: (monitor: EventTarget) => void;
}

export interface SummarizerCallOptions {
  context?: string;
  signal?: AbortSignal;
}

export interface SummarizerSession {
  summarize(text: string, options?: SummarizerCallOptions): Promise<string>;
  summarizeStreaming(text: string, options?: SummarizerCallOptions): ReadableStream<string>;
  destroy(): void;
}

declare global {
  const Summarizer: {
    availability(options?: Partial<SummarizerCreateOptions>): Promise<SummarizerAvailability>;
    create(options?: SummarizerCreateOptions): Promise<SummarizerSession>;
  };
}
```

---

## Testing (`summarize.test.ts`)

The Summarizer API only exists in supporting browsers; tests must mock it. Vitest runs in jsdom (no real `Summarizer` global), so inject a mock via `vi.stubGlobal`.

### Cases to cover

| Case | Expected behaviour |
|------|--------------------|
| `addToRegistry` — `Summarizer` global absent | Rejects with `AdapterError`; tool not registered |
| `call()` — `Summarizer` global absent | Rejects with `AdapterError` |
| `addToRegistry` — `"readily"` | Resolves; tool is registered; `Summarizer.create` not called yet |
| `addToRegistry` — `"after-download"` | `Summarizer.create` called with monitor; resolves after mock create resolves; tool registered |
| `addToRegistry` — `"downloading"` | Same as `"after-download"` |
| `addToRegistry` — `"unavailable"` | Rejects with `AdapterError`; tool not registered |
| `onDownloadProgress` callback | Mock `downloadprogress` event fires; callback receives `{ loaded, total }` |
| `call()` happy path | Resolves with summary string |
| `call()` — options match cached instance | `Summarizer.create` called only once across two calls |
| `call()` — options differ | Cached instance destroyed; new one created |
| `call()` — `context.signal` forwarded | Mock verifies signal passed to `summarize()` |
| `call()` — `summarize()` throws | Error propagates from `call()` |

---

## Package Structure Changes

```
packages/built-in-ai/src/
├── index.ts                  ← updated exports
├── BuiltInAIAdapter.ts       (unchanged)
├── BuiltInAIAdapter.test.ts  (unchanged)
├── types.ts                  ← Summarizer types added
└── tools/
    ├── index.ts              ← new: addAllBuiltInAITools
    ├── summarize.ts          ← new
    └── summarize.test.ts     ← new
```

---

## `index.ts` Export Updates

```typescript
// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

export { BuiltInAIAdapter, checkAvailability } from './BuiltInAIAdapter.js';
export type { BuiltInAIAdapterOptions } from './BuiltInAIAdapter.js';
export type { LanguageModelAvailability } from './types.js';

// Phase 2 additions
export { SummarizeTool } from './tools/summarize.js';
export type { SummarizeToolOptions } from './tools/summarize.js';
export { addAllBuiltInAITools } from './tools/index.js';
```

### `tools/index.ts`

A convenience function that calls `addToRegistry` for every available tool. Each tool's failure is independent — if one API is unavailable the others still register.

```typescript
// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { SummarizeTool } from './summarize.js';
import type { ToolRegistry } from '@mast-ai/core';

export interface AddAllBuiltInAIToolsOptions {
  onDownloadProgress?: (tool: string, progress: { loaded: number; total: number }) => void;
}

export async function addAllBuiltInAITools(
  registry: ToolRegistry,
  options?: AddAllBuiltInAIToolsOptions,
): Promise<void> {
  await Promise.allSettled([
    SummarizeTool.addToRegistry(registry, {
      onDownloadProgress: options?.onDownloadProgress
        ? (p) => options.onDownloadProgress!('summarize', p)
        : undefined,
    }),
    // Phase 3+ tools added here
  ]);
}
```

`Promise.allSettled` is intentional — if the Summarizer is unavailable but a future translation tool is ready, the translation tool still registers.

---

## Sample Usage

```typescript
import { SummarizeTool } from '@mast-ai/built-in-ai';
import { ToolRegistry } from '@mast-ai/core';

const registry = new ToolRegistry();

// Model already downloaded — registers immediately
await SummarizeTool.addToRegistry(registry);

// Model not yet downloaded — awaits download, then registers
await SummarizeTool.addToRegistry(registry, {
  onDownloadProgress: ({ loaded, total }) => {
    console.log(`Downloading summarizer model: ${loaded}/${total} bytes`);
  },
});

// Model unavailable on this device — rejects
try {
  await SummarizeTool.addToRegistry(registry);
} catch (err) {
  // AdapterError: Summarizer API is unavailable on this device.
  console.error(err.message);
}

// Bulk registration — registers whichever tools are available, ignores the rest
import { addAllBuiltInAITools } from '@mast-ai/built-in-ai';
await addAllBuiltInAITools(registry, {
  onDownloadProgress: (tool, { loaded, total }) => {
    console.log(`[${tool}] downloading: ${loaded}/${total}`);
  },
});
```

---

## Files to Create / Modify

| Path | Action |
|------|--------|
| `packages/built-in-ai/src/types.ts` | Add Summarizer API types |
| `packages/built-in-ai/src/tools/summarize.ts` | Create |
| `packages/built-in-ai/src/tools/summarize.test.ts` | Create |
| `packages/built-in-ai/src/tools/index.ts` | Create |
| `packages/built-in-ai/src/index.ts` | Add tool exports |

---
