# MAST Adapters Reference

Adapters implement the `LlmAdapter` interface to connect the `AgentRunner` to an inference engine.

## UrpAdapter (Hybrid Mode)

Connects to a remote Universal Remote Protocol (URP) server via `HttpTransport`.

```typescript
import { UrpAdapter, HttpTransport } from '@mast-ai/core';

const transport = new HttpTransport({ 
  url: 'http://localhost:3000/api/chat',
  headers: { 'Authorization': 'Bearer ...' }  // optional
});
const adapter = new UrpAdapter(transport);
```

## GoogleGenAIAdapter

Calls the Gemini API directly from the browser. Supports tool calling, structured output, streaming, and thinking mode (enabled by default at `ThinkingLevel.HIGH`).

```typescript
import { GoogleGenAIAdapter } from '@mast-ai/google-genai';

const adapter = new GoogleGenAIAdapter(
  'YOUR_API_KEY',
  'gemini-3.1-flash-lite-preview',  // optional, this is the default
  (usage) => console.log('Tokens used:', usage)  // optional usage callback
);
```

## BuiltInAIAdapter (On-device)

Runs inference fully on-device via the browser Prompt API (no network requests). Does not support tool calling — `toolCalls` is always empty.

```typescript
import { BuiltInAIAdapter, checkAvailability } from '@mast-ai/built-in-ai';

const availability = await checkAvailability();
// availability: 'readily' | 'after-download' | 'downloading' | 'unavailable'

const adapter = new BuiltInAIAdapter({
  onDownloadProgress: (progress) => console.log(progress)  // optional
});
```

## Built-in AI Browser Tools (`@mast-ai/built-in-ai`)

These tools wrap browser-native APIs and can be registered alongside any adapter.

```typescript
import { 
  SummarizeTool, 
  DetectLanguageTool, 
  TranslateTool, 
  addAllBuiltInAITools 
} from '@mast-ai/built-in-ai';
import { ToolRegistry } from '@mast-ai/core';

const registry = new ToolRegistry();

// Register individually
await SummarizeTool.addToRegistry(registry);
await DetectLanguageTool.addToRegistry(registry);
await TranslateTool.addToRegistry(registry);

// Or register all at once
await addAllBuiltInAITools(registry);
```

Tool arguments:
- **SummarizeTool**: `{ text, type?, format?, length?, context? }` → `string`
- **DetectLanguageTool**: `{ text }` → `{ detectedLanguage: string | null, confidence: number }`
- **TranslateTool**: `{ text, sourceLanguage, targetLanguage }` → `string`

## Custom Adapters

For other LLM providers (Transformers.js, MediaPipe, etc.), implement the `LlmAdapter` interface.

See [references/custom-adapters.md](custom-adapters.md) for a detailed implementation guide.
