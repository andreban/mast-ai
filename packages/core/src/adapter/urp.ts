// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { LlmAdapter, AdapterRequest, AdapterResponse, AdapterStreamChunk } from './index.js';
import type { Message, MessageContent, Role } from '../types.js';
import type { ToolDefinition } from '../tool.js';

/** Wire format for a request sent over the Universal Runtime Protocol (URP). */
export interface UrpRequest {
  messages: UrpMessage[];
  available_tools: ToolDefinition[];
  configuration?: Record<string, unknown>;
  stream?: boolean;
}

/** A tool call as represented in the URP wire format. */
export interface UrpToolCall {
  id: string;
  name: string;
  arguments: unknown;
  /**
   * Opaque per-call metadata controlled by the server (e.g. Gemini
   * `thoughtSignature`). Round-tripped unchanged on the matching
   * `tool_result` message in the next turn.
   */
  provider_metadata?: unknown;
}

/**
 * Message content as represented in the URP wire format.
 *
 * Mirrors {@link MessageContent}, except that `tool_calls` entries carry
 * {@link UrpToolCall} objects (`arguments`) rather than internal
 * {@link ToolCall} objects (`args`).
 */
export type UrpMessageContent =
  | Exclude<MessageContent, { type: 'tool_calls' }>
  | { type: 'tool_calls'; calls: UrpToolCall[] };

/** A single conversation message as represented in the URP wire format. */
export interface UrpMessage {
  role: Role;
  content: UrpMessageContent;
}

/** Converts an internal {@link Message} into its URP wire representation. */
function toUrpMessage({ role, content }: Message): UrpMessage {
  if (content.type !== 'tool_calls') {
    return { role, content };
  }
  return {
    role,
    content: {
      type: 'tool_calls',
      calls: content.calls.map((tc) => {
        const call: UrpToolCall = { id: tc.id, name: tc.name, arguments: tc.args };
        if (tc.provider_metadata !== undefined) {
          call.provider_metadata = tc.provider_metadata;
        }
        return call;
      }),
    },
  };
}

/** Wire format for a non-streaming URP response. */
export interface UrpResponse {
  text_content?: string;
  tool_calls: UrpToolCall[];
  usage_metrics?: Record<string, unknown>;
}

/** A single chunk emitted by a streaming URP response. */
export interface UrpStreamChunk {
  type: 'text_delta' | 'tool_call' | 'thinking';
  delta?: string;
  tool_call?: UrpToolCall;
}

/**
 * Low-level transport abstraction for the Universal Runtime Protocol.
 *
 * Implement this to connect `UrpAdapter` to a custom backend (e.g. `HttpTransport`).
 */
export interface UrpTransport {
  /** Sends a non-streaming request and returns the full response. */
  send(request: UrpRequest, signal?: AbortSignal): Promise<UrpResponse>;
  /** Sends a streaming request and yields response chunks. Optional. */
  sendStream?(request: UrpRequest, signal?: AbortSignal): AsyncIterable<UrpStreamChunk>;
}

/**
 * {@link LlmAdapter} implementation backed by any {@link UrpTransport}.
 *
 * Translates between the normalised {@link AdapterRequest}/{@link AdapterResponse} types
 * and the URP wire format.
 */
export class UrpAdapter implements LlmAdapter {
  constructor(private transport: UrpTransport) {}

  private prepareRequest(request: AdapterRequest, stream: boolean): UrpRequest {
    const urpRequest: UrpRequest = {
      messages: request.messages.map(toUrpMessage),
      available_tools: request.tools,
      stream,
    };

    if (request.config) {
      urpRequest.configuration = request.config;
    }

    // URP has no dedicated system field; inject instructions as a leading user message.
    if (request.system) {
      urpRequest.messages = [
        { role: 'user', content: { type: 'text', text: request.system } },
        ...urpRequest.messages,
      ];
    }

    return urpRequest;
  }

  /** {@inheritDoc LlmAdapter.generate} */
  async generate(request: AdapterRequest): Promise<AdapterResponse> {
    const urpRequest = this.prepareRequest(request, false);
    const response = await this.transport.send(urpRequest, request.signal);

    return {
      text: response.text_content,
      toolCalls: response.tool_calls
        ? response.tool_calls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            args: tc.arguments,
            provider_metadata: tc.provider_metadata,
          }))
        : [],
    };
  }

  /** {@inheritDoc LlmAdapter.generateStream} */
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
    for await (const chunk of this.transport.sendStream(urpRequest, request.signal)) {
      if (chunk.type === 'text_delta' && chunk.delta !== undefined) {
        yield { type: 'text_delta', delta: chunk.delta };
      } else if (chunk.type === 'thinking' && chunk.delta !== undefined) {
        yield { type: 'thinking', delta: chunk.delta };
      } else if (chunk.type === 'tool_call' && chunk.tool_call) {
        yield {
          type: 'tool_call',
          toolCall: {
            id: chunk.tool_call.id,
            name: chunk.tool_call.name,
            args: chunk.tool_call.arguments,
            provider_metadata: chunk.tool_call.provider_metadata,
          },
        };
      }
    }
  }
}
