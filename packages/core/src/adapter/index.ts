// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Message, ToolCall } from '../types';
import type { ToolDefinition } from '../tool';

/** Provider-specific model configuration options forwarded verbatim to the adapter. */
export interface ModelConfig {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  /** Pass-through for provider-specific fields not covered above. */
  [key: string]: unknown;
}

/** Normalised request sent from the runner to an {@link LlmAdapter}. */
export interface AdapterRequest {
  messages: Message[];
  /** System prompt / instructions for the model. */
  system?: string;
  tools: ToolDefinition[];
  /** JSON Schema for structured output; passed through to adapters that support it. */
  outputSchema?: Record<string, unknown>;
  config?: ModelConfig;
  signal?: AbortSignal;
}

/** Normalised response returned by an {@link LlmAdapter} from a non-streaming call. */
export interface AdapterResponse {
  /** Final text output; `undefined` when the model issued tool calls instead. */
  text?: string;
  /** Empty on a final text response; non-empty when the model wants to call tools. */
  toolCalls: ToolCall[];
}

/** A single chunk emitted by a streaming {@link LlmAdapter}. */
export type AdapterStreamChunk =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking';   delta: string }
  | { type: 'tool_call';  toolCall: ToolCall };

/**
 * Adapter interface that bridges the runner to a specific LLM provider.
 *
 * Implement this interface to connect any model backend.
 * `generateStream` is optional — the runner falls back to `generate` when absent.
 */
export interface LlmAdapter {
  /** Generates a response in a single round-trip. */
  generate(request: AdapterRequest): Promise<AdapterResponse>;
  /** Streams response chunks incrementally. Optional — the runner falls back to `generate` if absent. */
  generateStream?(request: AdapterRequest): AsyncIterable<AdapterStreamChunk>;
}
