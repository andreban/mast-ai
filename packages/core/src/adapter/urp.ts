import type { LlmAdapter, AdapterRequest, AdapterResponse } from './index';
import type { Message } from '../types';
import type { ToolDefinition } from '../tool';

export interface UrpRequest {
  messages: Message[];
  available_tools: ToolDefinition[];
  configuration?: Record<string, unknown>;
}

export interface UrpToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface UrpResponse {
  text_content?: string;
  tool_calls: UrpToolCall[];
  usage_metrics?: Record<string, unknown>;
}

export interface UrpTransport {
  send(request: UrpRequest): Promise<UrpResponse>;
}

export class UrpAdapter implements LlmAdapter {
  constructor(private transport: UrpTransport) {}

  async generate(request: AdapterRequest): Promise<AdapterResponse> {
    const urpRequest: UrpRequest = {
      messages: request.messages,
      available_tools: request.tools,
    };

    if (request.config) {
      urpRequest.configuration = request.config;
    }

    // Handle system prompt by injecting it into messages, or depending on URP spec.
    // URP spec in docs/SPEC.md doesn't explicitly have a system prompt,
    // so we can optionally prepend it as a 'user' or 'system' role if 'system' role exists,
    // or assume the backend handles it via messages.
    if (request.system) {
      urpRequest.messages = [
        // Since Role is 'user' | 'assistant', we can inject it as a user message or we would need to update Role.
        // For now, let's inject it as a user message with a specific prefix,
        // or just add it to the URP request if we want to extend the spec.
        // Extending URP locally for system prompt might be best, but we'll stick to messages.
        // We'll leave system handling to the implementation of the backend or prepend.
        { role: 'user', content: { type: 'text', text: request.system } },
        ...request.messages
      ];
    }

    const response = await this.transport.send(urpRequest);

    return {
      text: response.text_content,
      toolCalls: response.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.name,
        args: tc.arguments,
      })),
    };
  }
}
