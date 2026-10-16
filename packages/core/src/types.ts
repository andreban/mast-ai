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
  | { type: 'text'; content: string }
  | { type: 'tool_calls'; content: ToolCall[] }
  | { type: 'tool_result'; content: ToolResult };

/**
 * The payload of a `tool_result` message: the originating tool call and the
 * value its tool returned.
 */
export interface ToolResult {
  /**
   * The originating tool call, copied verbatim (including `provider_metadata`)
   * from the preceding `tool_calls` message.
   */
  tool_call: ToolCall;
  result: unknown;
}

/**
 * A single message in a conversation history.
 *
 * The JSON shape matches agent-rig's `Message`, so histories serialise and
 * deserialise across the two libraries without translation.
 */
export interface Message {
  role: Role;
  content: MessageContent;
  /**
   * Opaque provider state attached to an assistant turn (e.g. agent-rig's
   * DeepSeek `reasoning_content`). MAST round-trips it unchanged in history
   * and never inspects it.
   */
  provider_metadata?: unknown;
}

/**
 * Events emitted by the AgentRunner during execution.
 */
export type AgentEvent =
  | {
      type: 'tool_call_started';
      /**
       * The originating {@link ToolCall.id}. Always set by `AgentRunner`; pair a
       * `tool_call_completed` with its `tool_call_started` by this id rather than
       * by `name`, which repeats when the model issues parallel calls to one tool.
       */
      id?: string;
      name: string;
      args: unknown;
    }
  | {
      type: 'tool_call_completed';
      /** The originating {@link ToolCall.id}; matches the `tool_call_started` id. */
      id?: string;
      name: string;
      result: unknown;
      error?: boolean;
    }
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
