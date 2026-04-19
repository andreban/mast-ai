# MAST Adapters Reference

Adapters implement the `LlmAdapter` interface to connect the `AgentRunner` to an inference engine.

## UrpAdapter (Hybrid Mode)

Connects to a remote Universal Remote Protocol (URP) server. Requires a transport layer.

```typescript
import { UrpAdapter, HttpTransport, WebSocketTransport } from '@mast-ai/core';

// HTTP Transport
const httpTransport = new HttpTransport({ 
  url: 'http://localhost:3000/api/chat',
  headers: { 'Authorization': 'Bearer ...' }
});
const httpAdapter = new UrpAdapter(httpTransport);

// WebSocket Transport
const wsTransport = new WebSocketTransport({ 
  url: 'ws://localhost:3000/api/chat/ws' 
});
const wsAdapter = new UrpAdapter(wsTransport);
```

## PromptApiAdapter (Planned)

The `PromptApiAdapter` for the Chrome Prompt API (Gemini Nano) is currently in the project roadmap but not yet implemented in the core library.

## Custom Adapters

For developers who wish to use other LLM providers (e.g., Google AI SDK, Transformers.js, MediaPipe), MAST provides the `LlmAdapter` interface. 

See [references/custom-adapters.md](custom-adapters.md) for a detailed implementation guide and boilerplate.
