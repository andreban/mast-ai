import type { LlmAdapter, AdapterRequest, AdapterResponse, AdapterStreamChunk } from './index';
import type { Message } from '../types';
import type { ToolDefinition } from '../tool';

export interface UrpRequest {
  messages: Message[];
  available_tools: ToolDefinition[];
  configuration?: Record<string, unknown>;
  stream?: boolean;
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

export interface UrpStreamChunk {
  type: 'text_delta' | 'tool_call' | 'thinking';
  delta?: string;
  tool_call?: UrpToolCall;
}

export interface UrpTransport {
  send(request: UrpRequest): Promise<UrpResponse>;
  sendStream?(request: UrpRequest): AsyncIterable<UrpStreamChunk>;
}

export class UrpAdapter implements LlmAdapter {
  constructor(private transport: UrpTransport) {}

  private prepareRequest(request: AdapterRequest, stream: boolean): UrpRequest {
    const urpRequest: UrpRequest = {
      messages: request.messages,
      available_tools: request.tools,
      stream,
    };

    if (request.config) {
      urpRequest.configuration = request.config;
    }

    if (request.system) {
      urpRequest.messages = [
        { role: 'user', content: { type: 'text', text: request.system } },
        ...request.messages
      ];
    }

    return urpRequest;
  }

  async generate(request: AdapterRequest): Promise<AdapterResponse> {
    const urpRequest = this.prepareRequest(request, false);
    const response = await this.transport.send(urpRequest);

    return {
      text: response.text_content,
      toolCalls: response.tool_calls ? response.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.name,
        args: tc.arguments,
      })) : [],
    };
  }

  async *generateStream(request: AdapterRequest): AsyncIterable<AdapterStreamChunk> {
    if (!this.transport.sendStream) {
      // Fallback to non-streaming if transport doesn't support it
      const response = await this.generate(request);
      if (response.text) {
        yield { type: 'text_delta', delta: response.text };
      }
      for (const tc of response.toolCalls) {
        yield { type: 'tool_call', toolCall: tc };
      }
      return;
    }

    const urpRequest = this.prepareRequest(request, true);
    for await (const chunk of this.transport.sendStream(urpRequest)) {
      if (chunk.type === 'text_delta') {
        yield { type: 'text_delta', delta: chunk.delta };
      } else if (chunk.type === 'thinking') {
        yield { type: 'thinking', delta: chunk.delta };
      } else if (chunk.type === 'tool_call' && chunk.tool_call) {
        yield {
          type: 'tool_call',
          toolCall: {
            id: chunk.tool_call.id,
            name: chunk.tool_call.name,
            args: chunk.tool_call.arguments,
          },
        };
      }
    }
  }
}
