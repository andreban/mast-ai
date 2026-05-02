# Built-in AI — Phase 4: Translation Tool

## Goal

Implement a `translate` MAST `Tool` backed by the browser's Translator API, and add it to the `@mast-ai/built-in-ai` package. Any agent — regardless of which `LlmAdapter` it uses — can register this tool to translate text on-device between supported language pairs.

---

## Reference

Use `packages/built-in-ai/src/tools/detectLanguage.ts` as the structural reference for copyright header, import style, `AdapterError` usage, and the `addToRegistry` / `call()` pattern.

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

## Translator API Overview

The Translator API exposes on-device translation via the `Translator` bare global.

```typescript
// Check availability for a specific language pair
const availability = await Translator.availability({ sourceLanguage, targetLanguage });
// → "readily" | "after-download" | "downloading" | "unavailable"

// Create a translator (language pair is baked in at creation time)
const translator = await Translator.create({ sourceLanguage, targetLanguage, signal?, monitor? });

// Translate (blocking)
const result = await translator.translate(text, { signal? });

// Free resources
translator.destroy();
```

### Creation options

| Option | Type | Notes |
|--------|------|-------|
| `sourceLanguage` | `string` | BCP 47 language tag (e.g. `"en"`, `"fr"`) |
| `targetLanguage` | `string` | BCP 47 language tag |
| `signal` | `AbortSignal` | Cancels session creation |
| `monitor` | `(m: EventTarget) => void` | Download progress |

### Per-call options

| Option | Type | Notes |
|--------|------|-------|
| `signal` | `AbortSignal` | Cancels this call |

### Key design constraint

The `sourceLanguage` and `targetLanguage` are **baked into the translator instance at creation time**. Unlike the Summarizer (which has one default session that can be recreated if options change), the Translator has no meaningful default language pair to pre-warm. Sessions must be created lazily, on first use for each language pair. The tool caches one session per `sourceLanguage:targetLanguage` pair and reuses it across calls.

---

## Tool Design

### Input schema

```typescript
export interface TranslateArgs {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}
```

### Output

The tool returns the translated text as a plain `string`.

### Tool name

`"translate"`

### Tool description

`"Translate a piece of text from one language to another using an on-device AI model. Languages are specified as BCP 47 tags (e.g. 'en', 'fr', 'ja')."`

### `definition()` parameters JSON Schema

```typescript
{
  type: 'object',
  properties: {
    text:           { type: 'string', description: 'The text to translate.' },
    sourceLanguage: { type: 'string', description: 'BCP 47 language tag of the source language (e.g. "en").' },
    targetLanguage: { type: 'string', description: 'BCP 47 language tag of the target language (e.g. "fr").' },
  },
  required: ['text', 'sourceLanguage', 'targetLanguage'],
}
```

---

## Implementation: `TranslateTool`

The tool is implemented as a class. Consumers never instantiate it directly — they call the static `TranslateTool.addToRegistry()` method.

```typescript
// packages/built-in-ai/src/tools/translate.ts

export interface TranslateToolOptions {
  onDownloadProgress?: (progress: { loaded: number; total: number }) => void;
}

export class TranslateTool implements Tool<TranslateArgs, string> {
  static async addToRegistry(
    registry: ToolRegistry,
    options?: TranslateToolOptions,
  ): Promise<void> { ... }

  definition(): ToolDefinition { ... }
  call(args: TranslateArgs, context: ToolContext): Promise<string> { ... }
}
```

### `addToRegistry` — availability and registration

Because the Translator API requires a specific language pair to check availability, there is no meaningful session to pre-warm at registration time. `addToRegistry` only verifies the global exists and registers the tool immediately.

**Step 1 — API existence check:**
```typescript
if (typeof Translator === 'undefined') {
  throw new AdapterError('Translator API is not supported in this browser.');
}
```

**Step 2 — Register.** If the check passes, construct a new `TranslateTool` (passing through `options` for later use in `call()`) and call `registry.register(tool)`. The returned `Promise<void>` resolves immediately after registration.

Unlike `SummarizeTool`, there is no `"unavailable"` guard at registration time — language pair availability is checked lazily in `call()`.

### Session caching in `call()`

`call()` also guards against the API being absent:

```typescript
if (typeof Translator === 'undefined') {
  throw new AdapterError('Translator API is not supported in this browser.');
}
```

Maintain a `Map<string, TranslatorSession>` keyed on `"${sourceLanguage}:${targetLanguage}"`. On each `call()`:

1. Look up the cache key. If a session exists, reuse it.
2. If no session exists:
   a. Check availability for the language pair via `Translator.availability({ sourceLanguage, targetLanguage })`.
   b. If `"unavailable"`, throw `AdapterError('Translation from <src> to <tgt> is not available on this device.')`.
   c. Otherwise call `Translator.create({ sourceLanguage, targetLanguage, signal: context.signal, monitor })` where `monitor` is built from `this.options?.onDownloadProgress` (same pattern as `DetectLanguageTool`).
   d. Store the created session in the cache.
3. Call `session.translate(args.text, { signal: context.signal })` and return the result.

### AbortSignal

Pass `context.signal` to both `Translator.create()` and `session.translate()`. Note that when the signal aborts during `create()`, the cache entry is never written, so the next call for the same language pair will retry creation.

---

## TypeScript Types (`types.ts` additions)

The Translator API is not in `lib.dom.d.ts`. Add the following to `packages/built-in-ai/src/types.ts`:

```typescript
export type TranslatorAvailability =
  | "readily"
  | "after-download"
  | "downloading"
  | "unavailable";

export interface TranslatorAvailabilityOptions {
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslatorCreateOptions {
  sourceLanguage: string;
  targetLanguage: string;
  signal?: AbortSignal;
  monitor?: (monitor: EventTarget) => void;
}

export interface TranslatorCallOptions {
  signal?: AbortSignal;
}

export interface TranslatorSession {
  translate(text: string, options?: TranslatorCallOptions): Promise<string>;
  destroy(): void;
}

declare global {
  const Translator: {
    availability(options: TranslatorAvailabilityOptions): Promise<TranslatorAvailability>;
    create(options: TranslatorCreateOptions): Promise<TranslatorSession>;
  };
}
```

---

## Testing (`translate.test.ts`)

The Translator API only exists in supporting browsers; tests must mock it via `vi.stubGlobal`.

### Cases to cover

| Case | Expected behaviour |
|------|--------------------|
| `addToRegistry` — `Translator` global absent | Rejects with `AdapterError`; tool not registered |
| `addToRegistry` — global present | Resolves; tool is registered immediately (no session created yet) |
| `call()` — `Translator` global absent | Rejects with `AdapterError` |
| `call()` — pair `"unavailable"` | Rejects with `AdapterError` mentioning the language pair; no session created |
| `call()` — pair `"readily"` | `Translator.create` called once; returns translated string |
| `call()` — pair `"after-download"` | `Translator.create` called with monitor; returns translated string after mock create resolves |
| `onDownloadProgress` callback | Mock `downloadprogress` event fires; callback receives `{ loaded, total }` |
| `call()` — same pair called twice | `Translator.create` called only once; session reused |
| `call()` — different pairs | `Translator.create` called once per unique pair; both sessions cached |
| `call()` — `context.signal` forwarded | Mock verifies signal passed to both `create()` and `translate()` |
| `call()` — `translate()` throws | Error propagates from `call()` |
| `call()` — `create()` aborted | Session not cached; subsequent call retries `create()` |

---

## Package Structure Changes

```
packages/built-in-ai/src/
├── index.ts                  ← updated exports
├── BuiltInAIAdapter.ts       (unchanged)
├── BuiltInAIAdapter.test.ts  (unchanged)
├── types.ts                  ← Translator types added
└── tools/
    ├── index.ts              ← TranslateTool added to addAllBuiltInAITools
    ├── summarize.ts          (unchanged)
    ├── summarize.test.ts     (unchanged)
    ├── detectLanguage.ts     (unchanged)
    ├── detectLanguage.test.ts (unchanged)
    ├── translate.ts          ← new
    └── translate.test.ts     ← new
```

---

## `index.ts` Export Updates

```typescript
// Phase 4 additions
export { TranslateTool } from './tools/translate.js';
export type { TranslateToolOptions } from './tools/translate.js';
```

### `tools/index.ts` changes

Add `TranslateTool` to the `Promise.allSettled` call in `addAllBuiltInAITools`:

```typescript
import { TranslateTool } from './translate.js';

// Inside addAllBuiltInAITools:
TranslateTool.addToRegistry(registry, {
  onDownloadProgress: options?.onDownloadProgress
    ? (p) => options.onDownloadProgress!('translate', p)
    : undefined,
}),
```

---

## Sample Usage

```typescript
import { TranslateTool } from '@mast-ai/built-in-ai';
import { ToolRegistry } from '@mast-ai/core';

const registry = new ToolRegistry();

// Registers immediately — no session created until first call
await TranslateTool.addToRegistry(registry);

// With download progress reporting for new language pairs
await TranslateTool.addToRegistry(registry, {
  onDownloadProgress: ({ loaded, total }) => {
    console.log(`Downloading translation model: ${loaded}/${total} bytes`);
  },
});

// Language pair unavailable — rejects at call time, not registration time
try {
  await runner.run('Translate "hello" from en to xx');
} catch (err) {
  // AdapterError: Translation from en to xx is not available on this device.
}

// Bulk registration
import { addAllBuiltInAITools } from '@mast-ai/built-in-ai';
await addAllBuiltInAITools(registry);
```

---

## Files to Create / Modify

| Path | Action |
|------|--------|
| `packages/built-in-ai/src/types.ts` | Add Translator API types |
| `packages/built-in-ai/src/tools/translate.ts` | Create |
| `packages/built-in-ai/src/tools/translate.test.ts` | Create |
| `packages/built-in-ai/src/tools/index.ts` | Add `TranslateTool` to `addAllBuiltInAITools` |
| `packages/built-in-ai/src/index.ts` | Add `TranslateTool` and `TranslateToolOptions` exports |

---
