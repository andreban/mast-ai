// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

/**
 * Represents the role of a message sender.
 */
export type Role = 'user' | 'assistant';

/**
 * A single tool call issued by the assistant.
 */
export interface ToolCall {
  id: string; // opaque identifier echoed back to the adapter
  name: string;
  args: unknown; // parsed JSON object matching the tool's parameters schema
  /**
   * Opaque per-call metadata controlled by the adapter / backend
   * (e.g. Gemini `thoughtSignature`). MAST round-trips this value
   * unchanged on the matching `tool_result`; it has no schema and
   * is never inspected by the runner.
   */
  provider_metadata?: unknown;
}

/**
 * Discriminated union of possible message content types.
 */
export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'tool_calls'; calls: ToolCall[] }
  | {
      type: 'tool_result';
      id: string;
      name: string;
      result: unknown;
      /** Copied verbatim from the originating tool call. */
      provider_metadata?: unknown;
    };

/**
 * A single message in a conversation history.
 */
export interface Message {
  role: Role;
  content: MessageContent;
}

/**
 * Events emitted by the AgentRunner during execution.
 */
export type AgentEvent =
  | { type: 'tool_call_started'; name: string; args: unknown }
  | { type: 'tool_call_completed'; name: string; result: unknown; error?: boolean }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'done'; output: string; history: Message[] };

/**
 * Pure data blueprint for an agent.
 */
export interface AgentConfig {
  name: string;
  instructions: string;
  tools?: string[]; // names of tools the agent may invoke
  outputSchema?: Record<string, unknown>; // JSON Schema for structured output
}

/**
 * The final result of an agent run.
 */
export interface AgentResult {
  output: string;
}
