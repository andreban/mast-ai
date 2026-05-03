// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { AgentRunner, ToolRegistry, createAgent } from '@mast-ai/core';
import type { Tool, ToolContext } from '@mast-ai/core';
import { GoogleGenAIAdapter } from '@mast-ai/google-genai';
import { AgentProvider, ConversationPanel } from '@mast-ai/react-ui';
import '@mast-ai/react-ui/styles.css';

// 1. Define a browser-native tool. The runner sends each tool's definition()
//    to the LLM and the registry resolves names to implementations at call
//    time. Tool execution always happens in the browser.
class GetCurrentTimeTool implements Tool {
  definition() {
    return {
      name: 'get_current_time',
      description: 'Returns the current time as an ISO 8601 string.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      scope: 'read' as const,
    };
  }

  async call(_args: unknown, _context: ToolContext): Promise<string> {
    return new Date().toISOString();
  }
}

// 2. Build the registry and runner. GoogleGenAIAdapter calls the Gemini API
//    directly from the browser; for production apps fetch a short-lived token
//    from a backend instead of baking the key into the bundle.
const registry = new ToolRegistry().register(new GetCurrentTimeTool());
const runner = new AgentRunner(
  new GoogleGenAIAdapter(import.meta.env.VITE_GEMINI_API_KEY),
  registry,
);

// 3. Configure the agent. The `tools` array is the LLM's allowlist for the
//    turn; a tool registered on the registry but missing from this list is
//    invisible to the model.
const agent = createAgent({
  name: 'Assistant',
  instructions:
    'You are a helpful assistant. Call get_current_time when the user asks about the current time.',
  tools: ['get_current_time'],
});

// 4. Render the chat UI. <AgentProvider> drives a Conversation, exposes the
//    streaming state via useAgent(), and must wrap any component that calls it.
export default function App() {
  return (
    <AgentProvider runner={runner} agent={agent}>
      <ConversationPanel inputPlaceholder="Ask me anything." />
    </AgentProvider>
  );
}
