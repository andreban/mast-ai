# Plan: `@mast-ai/built-in-ai` — Browser Built-in AI Adapter

## Overview

This document plans the scope and implementation of a new package, `@mast-ai/built-in-ai`, that exposes the browser's Built-in AI APIs as a MAST `LlmAdapter` and as individual MAST tools. These APIs are being proposed as web standards and are intended to be available across browsers. This allows agents to leverage on-device AI capabilities without a remote backend.

---

## Built-in AI APIs

The following APIs are available or in trial in browsers that support them:

| API | Purpose | Status | Docs |
|-----|---------|--------|------|
| **Prompt API** | Send natural language prompts to the on-device model | Stable (extensions), Origin trial (web) | https://developer.chrome.com/docs/ai/prompt-api |
| **Summarizer API** | Condense long-form content | Stable | https://developer.chrome.com/docs/ai/summarizer-api |
| **Writer API** | Generate new content for writing tasks | Developer trial | https://developer.chrome.com/docs/ai/writer-api |
| **Rewriter API** | Revise and restructure existing text | Developer trial | https://developer.chrome.com/docs/ai/rewriter-api |
| **Translator API** | Translate user-generated and dynamic content | Stable | https://developer.chrome.com/docs/ai/translator-api |
| **Language Detector API** | Detect the language of text | Stable | https://developer.chrome.com/docs/ai/language-detection |
| **Proofreader API** | Interactive proofreading | Origin trial | https://developer.chrome.com/docs/ai/proofreader-api |

---

## Integration Strategy

The Prompt API is the only Built-in AI API that maps to the general-purpose LLM adapter interface (`LlmAdapter`). The remaining APIs are specialized text-processing utilities that are better exposed as MAST **tools**, allowing an agent (backed by any adapter) to call them during a reasoning loop.

### 1. `BuiltInAIAdapter` — implements `LlmAdapter`

Uses the **Prompt API** to power a full agent loop entirely on-device. This adapter enables a "local-only" mode with no network dependency.

**Scope:**
- Implement `generate()` using `LanguageModel.create()` and `session.prompt()`
- Implement `generateStream()` using `session.promptStreaming()`
- Map MAST `Message[]` history into the Prompt API's `initialPrompts` format
- Map `system` instruction to a `{ role: "system" }` entry in `initialPrompts`
- Handle `AbortSignal` via session destroy or by checking signal in the stream loop
- Tool calling: The Prompt API does **not** natively support structured tool calls. `BuiltInAIAdapter` will always return `toolCalls: []` and ignore any tools passed in the request. This is a known, documented limitation — callers should not register tools with a runner backed by this adapter.

**Constraints:**
- Browser-only environment (no Node.js support)
- Availability gated on `typeof LanguageModel !== "undefined"`
- Model download may be required on first use; expose session `downloadprogress` events
- Sessions are stateless across page loads; history must be passed via `initialPrompts`

### 2. Built-in AI Tools — MAST `Tool` implementations

Each stable/trial API below maps to one or more MAST tools that any agent can invoke:

| Tool Name | Underlying API | Input | Output |
|-----------|---------------|-------|--------|
| `summarize` | Summarizer API | text, optional type/length/format | summary string |
| `write` | Writer API | task description, optional context/tone/length | generated text |
| `rewrite` | Rewriter API | text, optional goal/tone/length | rewritten text |
| `translate` | Translator API | text, source language, target language | translated text |
| `detectLanguage` | Language Detector API | text | detected language + confidence |
| `proofread` | Proofreader API | text | corrections/suggestions |

Each tool should:
- Check for API availability at call time and throw a descriptive `AdapterError` if unavailable
- Accept the minimal required inputs plus relevant optional parameters
- Handle `AbortSignal` where the underlying API supports it

---

## Package Structure

```
packages/built-in-ai/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── BuiltInAIAdapter.ts
    ├── BuiltInAIAdapter.test.ts
    ├── tools/
    │   ├── index.ts
    │   ├── summarize.ts
    │   ├── write.ts
    │   ├── rewrite.ts
    │   ├── translate.ts
    │   ├── detectLanguage.ts
    │   └── proofread.ts
    └── types.ts           ← Built-in AI API type declarations (not yet in lib.dom.d.ts)
```

### `types.ts`

The Built-in AI APIs are not yet in `lib.dom.d.ts`. This file will declare the bare globals (e.g. `LanguageModel`) and the types for each API (session objects, options, results) so the package compiles under strict TypeScript without `@ts-ignore`.

---

## Package Config

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

No external runtime dependencies — all APIs are accessed via bare globals.

---

## Public API (index.ts exports)

```typescript
// Adapter
export { BuiltInAIAdapter } from './BuiltInAIAdapter.js';

// Individual tools (consumers can register whichever they need)
export { createSummarizeTool } from './tools/summarize.js';
export { createWriteTool } from './tools/write.js';
export { createRewriteTool } from './tools/rewrite.js';
export { createTranslateTool } from './tools/translate.js';
export { createDetectLanguageTool } from './tools/detectLanguage.js';
export { createProofreadTool } from './tools/proofread.js';

// Convenience: all tools as an array for bulk registration
export { createAllBuiltInAITools } from './tools/index.js';

// Types
export type { BuiltInAIAdapterOptions } from './BuiltInAIAdapter.js';
```

---

## Phased Delivery

### Phase 1 — Adapter (MVP)
- `BuiltInAIAdapter` with `generate()` and `generateStream()`
- Text-only, no tool calling
- `types.ts` with Prompt API declarations
- Unit tests with mocked `LanguageModel` global

### Phase 2 — Summarizer Tool
- `summarize` tool wrapping the Summarizer API
- Availability guard and tests

### Phase 3 — Translation & Language Detection Tools
- `translate` and `detectLanguage` tools wrapping the Translator and Language Detector APIs
- These two APIs are closely related but present different integration challenges from the Summarizer (language pair availability, detection confidence handling)
- Availability guards and tests

### Phase 4 — Trial Tools
- `write`, `rewrite`, `proofread` tools (once APIs stabilize)
- Update `createAllBuiltInAITools` to include them

---

## Open Questions

1. **Testing environment:** Built-in AI APIs only exist in supporting browsers. Unit tests will mock the `LanguageModel` global. Integration/e2e testing requires a browser with the APIs enabled (possibly via Playwright with experimental flags).
2. **Demo app:** A new `apps/demo-built-in-ai` or a toggle in `apps/demo-basic-chat` to switch to the `BuiltInAIAdapter` when running in a supporting browser would demonstrate the local-only mode effectively.
