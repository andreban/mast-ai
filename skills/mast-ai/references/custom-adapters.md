# Custom LlmAdapter Implementation

To use a custom client-side LLM (e.g., Google AI SDK, Transformers.js, MediaPipe) with MAST, you must implement the `LlmAdapter` interface.

## The LlmAdapter Interface

The adapter's job is to translate between the MAST `AgentRunner` and the specific LLM provider's API.

```typescript
import { LlmAdapter, AdapterRequest, AdapterResponse, AdapterStreamChunk } from '@mast-ai/core';

export class MyCustomAdapter implements LlmAdapter {
  async generate(request: AdapterRequest): Promise<AdapterResponse> {
    // 1. Translate MAST request to Provider request
    // 2. Call Provider API
    // 3. Translate Provider response back to MAST AdapterResponse
  }

  // Optional: implement for streaming support
  async *generateStream?(request: AdapterRequest): AsyncIterable<AdapterStreamChunk> {
    // Yield { type: 'text_delta', delta: '...' }
    // Yield { type: 'tool_call', toolCall: { ... } }
  }
}
```

## Implementation Guide

### 1. Handling History
MAST provides the full conversation history in `request.messages`. Your adapter should convert these messages to the format expected by your provider (e.g., Google AI SDK's `Content` objects).

### 2. Supporting Tools
If your LLM provider supports native function calling:
- Map `request.tools` to the provider's tool/function definitions.
- When the model emits a function call, return it in `AdapterResponse.toolCalls`.
- MAST will execute the tool and call `generate` again with the result in `request.messages`.

### 3. Structured Output
If `request.outputSchema` is provided, use the LLM provider's "JSON Mode" or "Response Schema" feature to ensure the output matches the requested format.

## Example: Google AI SDK Wrapper (Skeleton)

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

export class GoogleAIAdapter implements LlmAdapter {
  constructor(private model: any) {}

  async generate(request: AdapterRequest): Promise<AdapterResponse> {
    const contents = request.messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: JSON.stringify(m.content) }] // Simplified mapping
    }));

    const result = await this.model.generateContent({
      contents,
      systemInstruction: request.system,
      tools: request.tools.map(t => ({ functionDeclarations: [t] }))
    });

    const response = result.response;
    const toolCalls = response.functionCalls()?.map(call => ({
      id: Math.random().toString(36), // Providers usually provide this
      name: call.name,
      args: call.args
    })) || [];

    return {
      text: toolCalls.length === 0 ? response.text() : undefined,
      toolCalls
    };
  }
}
```