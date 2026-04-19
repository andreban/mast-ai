// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Message, ToolCall } from '../types';
import type { ToolDefinition } from '../tool';

export interface ModelConfig {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  [key: string]: unknown;   // pass-through for provider-specific fields
}

export interface AdapterRequest {
  messages: Message[];
  system?: string;
  tools: ToolDefinition[];
  outputSchema?: Record<string, unknown>;  // JSON Schema
  config?: ModelConfig;
  signal?: AbortSignal;
}

export interface AdapterResponse {
  text?: string;            // undefined when tool calls were issued
  toolCalls: ToolCall[];    // empty on a final text response
}

export type AdapterStreamChunk =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking';   delta: string }
  | { type: 'tool_call';  toolCall: ToolCall };

export interface LlmAdapter {
  generate(request: AdapterRequest): Promise<AdapterResponse>;
  generateStream?(request: AdapterRequest): AsyncIterable<AdapterStreamChunk>;
}
