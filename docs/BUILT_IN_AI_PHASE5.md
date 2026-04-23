# Built-in AI — Phase 5: Proofreader Tool

## Goal

Implement a `proofread` MAST `Tool` backed by the browser's Proofreader API, and add it to the `@mast-ai/built-in-ai` package. Any agent — regardless of which `LlmAdapter` it uses — can register this tool to check text for spelling and grammar errors on-device.

---

## Reference

Use `packages/built-in-ai/src/tools/translate.ts` as the structural reference for copyright header, import style, `AdapterError` usage, and the `addToRegistry` / `call()` pattern.

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

## Proofreader API Overview

The Proofreader API exposes on-device proofreading via the `Proofreader` bare global.

```typescript
// Check availability
const availability = await Proofreader.availability();
// → "readily" | "after-download" | "downloading" | "unavailable"

// Create a proofreader session
const proofreader = await Proofreader.create({ signal?, monitor? });

// Proofread (blocking) — returns an array of corrections
const corrections = await proofreader.proofread(text, { signal? });

// Free resources
proofreader.destroy();
```

### Creation options

| Option | Type | Notes |
|--------|------|-------|
| `signal` | `AbortSignal` | Cancels session creation |
| `monitor` | `(m: EventTarget) => void` | Download progress |

### Per-call options

| Option | Type | Notes |
|--------|------|-------|
| `signal` | `AbortSignal` | Cancels this call |

### Return value

`proofreader.proofread()` returns `Promise<ProofreadCorrection[]>`. Each entry describes one issue found in the input text:

| Field | Type | Notes |
|-------|------|-------|
| `text` | `string` | The problematic text span as it appears in the input |
| `suggestions` | `string[]` | One or more suggested replacements |
| `errorType` | `string` | e.g. `"spelling"`, `"grammar"` |

### Session reuse

Unlike the Translator (which is language-pair-specific), the Proofreader session has no baked-in configuration. A single session can be created at registration time and reused for all subsequent `call()` invocations. The session is recreated lazily if the first creation is aborted.

---

## Tool Design

### Input schema

```typescript
export interface ProofreadArgs {
  text: string;
}
```

### Output

The tool returns `ProofreadCorrection[]` — the raw array from the API. This lets the calling agent decide how to present the corrections to the user.

```typescript
export interface ProofreadCorrection {
  text: string;
  suggestions: string[];
  errorType: string;
}
```

### Tool name

`"proofread"`

### Tool description

`"Check a piece of text for spelling and grammar errors using an on-device AI model. Returns a list of corrections, each with the problematic span, suggested replacements, and the error type."`

### `definition()` parameters JSON Schema

```typescript
{
  type: 'object',
  properties: {
    text: { type: 'string', description: 'The text to proofread.' },
  },
  required: ['text'],
}
```

---

## Implementation: `ProofreadTool`

The tool is implemented as a class. Consumers never instantiate it directly — they call the static `ProofreadTool.addToRegistry()` method.

```typescript
// packages/built-in-ai/src/tools/proofread.ts

export interface ProofreadToolOptions {
  onDownloadProgress?: (progress: { loaded: number; total: number }) => void;
}

export class ProofreadTool implements Tool<ProofreadArgs, ProofreadCorrection[]> {
  static async addToRegistry(
    registry: ToolRegistry,
    options?: ProofreadToolOptions,
  ): Promise<void> { ... }

  definition(): ToolDefinition { ... }
  call(args: ProofreadArgs, context: ToolContext): Promise<ProofreadCorrection[]> { ... }
}
```

### `addToRegistry` — availability and registration

**Step 1 — API existence check:**
```typescript
if (typeof Proofreader === 'undefined') {
  throw new AdapterError('Proofreader API is not supported in this browser.');
}
```

**Step 2 — Availability check:**
```typescript
const availability = await Proofreader.availability();
if (availability === 'unavailable') {
  throw new AdapterError('Proofreader API is not available on this device.');
}
```

**Step 3 — Create session.** Call `Proofreader.create({ monitor })` where `monitor` is built from `options?.onDownloadProgress` (same pattern as `DetectLanguageTool`). Store the resulting session on the instance.

**Step 4 — Register.** Call `registry.register(tool)`.

### Session management in `call()`

`call()` guards against the API being absent:

```typescript
if (typeof Proofreader === 'undefined') {
  throw new AdapterError('Proofreader API is not supported in this browser.');
}
```

The session is created at `addToRegistry` time and reused across all `call()` invocations. If `this.session` is `null` (creation was aborted at registration time and a subsequent `addToRegistry` was not called), throw an `AdapterError('Proofreader session is not available.')`.

Call `session.proofread(args.text, { signal: context.signal })` and return the result array directly.

### AbortSignal

Pass `context.signal` to `session.proofread()`. Session creation in `addToRegistry` does not receive a signal — it is a one-time setup operation.

---

## TypeScript Types (`types.ts` additions)

The Proofreader API is not in `lib.dom.d.ts`. Add the following to `packages/built-in-ai/src/types.ts`:

```typescript
export type ProofreaderAvailability =
  | "available"
  | "downloadable"
  | "downloading"
  | "unavailable";

export interface ProofreaderCreateOptions {
  signal?: AbortSignal;
  monitor?: (monitor: EventTarget) => void;
}

export interface ProofreaderCallOptions {
  signal?: AbortSignal;
}

export interface ProofreadCorrection {
  text: string;
  suggestions: string[];
  errorType: string;
}

export interface ProofreaderSession {
  proofread(text: string, options?: ProofreaderCallOptions): Promise<ProofreadCorrection[]>;
  destroy(): void;
}

declare global {
  const Proofreader: {
    availability(): Promise<ProofreaderAvailability>;
    create(options?: ProofreaderCreateOptions): Promise<ProofreaderSession>;
  };
}
```

---

## Testing (`proofread.test.ts`)

The Proofreader API only exists in supporting browsers; tests must mock it via `vi.stubGlobal`.

### Cases to cover

| Case | Expected behaviour |
|------|--------------------|
| `addToRegistry` — `Proofreader` global absent | Rejects with `AdapterError`; tool not registered |
| `addToRegistry` — availability `"unavailable"` | Rejects with `AdapterError`; tool not registered |
| `addToRegistry` — availability `"readily"` | `Proofreader.create` called; tool registered |
| `addToRegistry` — availability `"after-download"` | `Proofreader.create` called with monitor; tool registered after mock create resolves |
| `onDownloadProgress` callback | Mock `downloadprogress` event fires; callback receives `{ loaded, total }` |
| `call()` — `Proofreader` global absent | Rejects with `AdapterError` |
| `call()` — no session (e.g. creation was aborted) | Rejects with `AdapterError` |
| `call()` — returns corrections array | `session.proofread` called with input text; returns corrections |
| `call()` — returns empty array | Returns `[]` without error |
| `call()` — `context.signal` forwarded | Mock verifies signal passed to `proofread()` |
| `call()` — `proofread()` throws | Error propagates from `call()` |
| `call()` — session reused across calls | `Proofreader.create` called once; `session.proofread` called twice |

---

## Package Structure Changes

```
packages/built-in-ai/src/
├── index.ts                  ← updated exports
├── BuiltInAIAdapter.ts       (unchanged)
├── BuiltInAIAdapter.test.ts  (unchanged)
├── types.ts                  ← Proofreader types added
└── tools/
    ├── index.ts              ← ProofreadTool added to addAllBuiltInAITools
    ├── summarize.ts          (unchanged)
    ├── summarize.test.ts     (unchanged)
    ├── detectLanguage.ts     (unchanged)
    ├── detectLanguage.test.ts (unchanged)
    ├── translate.ts          (unchanged)
    ├── translate.test.ts     (unchanged)
    ├── proofread.ts          ← new
    └── proofread.test.ts     ← new
```

---

## `index.ts` Export Updates

```typescript
// Phase 5 additions
export { ProofreadTool } from './tools/proofread.js';
export type { ProofreadToolOptions } from './tools/proofread.js';
export type { ProofreadCorrection } from './types.js';
```

### `tools/index.ts` changes

Add `ProofreadTool` to the `Promise.allSettled` call in `addAllBuiltInAITools`:

```typescript
import { ProofreadTool } from './proofread.js';

// Inside addAllBuiltInAITools:
ProofreadTool.addToRegistry(registry, {
  onDownloadProgress: options?.onDownloadProgress
    ? (p) => options.onDownloadProgress!('proofread', p)
    : undefined,
}),
```

---

## Sample Usage

```typescript
import { ProofreadTool } from '@mast-ai/built-in-ai';
import { ToolRegistry } from '@mast-ai/core';

const registry = new ToolRegistry();

// Session is created at registration time
await ProofreadTool.addToRegistry(registry);

// With download progress reporting
await ProofreadTool.addToRegistry(registry, {
  onDownloadProgress: ({ loaded, total }) => {
    console.log(`Downloading proofreader model: ${loaded}/${total} bytes`);
  },
});

// Bulk registration
import { addAllBuiltInAITools } from '@mast-ai/built-in-ai';
await addAllBuiltInAITools(registry);
```

---

## Files to Create / Modify

| Path | Action |
|------|--------|
| `packages/built-in-ai/src/types.ts` | Add Proofreader API types |
| `packages/built-in-ai/src/tools/proofread.ts` | Create |
| `packages/built-in-ai/src/tools/proofread.test.ts` | Create |
| `packages/built-in-ai/src/tools/index.ts` | Add `ProofreadTool` to `addAllBuiltInAITools` |
| `packages/built-in-ai/src/index.ts` | Add `ProofreadTool`, `ProofreadToolOptions`, and `ProofreadCorrection` exports |

---

## Implementation Notes

This section documents friction points and design changes discovered during implementation that differ from the original plan.

### 1. Availability strings differ from every other Built-in AI API

All other APIs (`Summarizer`, `LanguageDetector`, `Translator`) use `"readily"` and `"after-download"`. The Proofreader API uses different strings:

| Expected | Actual |
|----------|--------|
| `"readily"` | `"available"` |
| `"after-download"` | `"downloadable"` |

The `ProofreaderAvailability` type was updated accordingly. The `"downloading"` and `"unavailable"` values match the other APIs.

### 2. `Proofreader.create()` requires a user gesture when a download is needed

When availability is `"downloadable"` or `"downloading"`, calling `Proofreader.create()` from page load (no user gesture) throws:

```
NotAllowedError: Requires a user gesture when availability is "downloading" or "downloadable".
```

This constraint is not present in any of the other Built-in AI APIs and was not reflected in the original plan.

### 3. Session creation strategy revised to handle the user gesture constraint

The original plan called for eager session creation in `addToRegistry` unconditionally. The final design splits on availability:

- **`"available"`** — session created eagerly in `addToRegistry`. No download needed, no gesture required, session is warm before the first tool call.
- **`"downloadable"` / `"downloading"`** — tool registered immediately with no session. Session is created lazily on the first `call()`, which executes within a user-initiated agent turn and therefore satisfies the gesture requirement.

The `onDownloadProgress` callback is wired into `call()`'s lazy `create()` path via a private `buildMonitor()` helper, so progress reporting works regardless of which path creates the session.

### 4. Actual API return type is completely different from the spec

The plan assumed `proofread()` returns `ProofreadCorrection[]` where each entry has `{ text, suggestions, errorType }`. The actual return type is a single object:

```typescript
{
  correctedInput: string;           // full input with all corrections applied
  corrections: ProofreadCorrection[];
}
```

And each `ProofreadCorrection` has:

```typescript
{
  correction: string;   // the replacement text
  startIndex: number;   // start of the error span in the original input (inclusive)
  endIndex: number;     // end of the error span in the original input (exclusive)
}
```

There is no `suggestions` array and no `errorType` field. A `ProofreadResult` wrapper type was introduced to represent the full return value. The exact indices make annotation rendering straightforward and reliable — no string searching required.
