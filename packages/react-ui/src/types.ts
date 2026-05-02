// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react';

/**
 * The rendered state of a single tool invocation within an assistant turn.
 *
 * Created when a `tool_call_started` event is received and updated as the tool
 * executes. For tools that run sub-agents, `subThinking` and `subText` accumulate
 * live output streamed via {@link AgentRunner}'s `onToolEvent` callback.
 */
export interface ToolEventEntry {
  /** Discriminates between a pending and a completed tool call. */
  type: 'tool_call_started' | 'tool_call_completed';

  /** The registered name of the tool. */
  name: string;

  /** The arguments passed to the tool, as parsed JSON. Present once the call has started. */
  args?: unknown;

  /**
   * The value returned by the tool.
   * Only present when `type` is `'tool_call_completed'`.
   */
  result?: unknown;

  /**
   * Accumulated thinking text streamed from a sub-agent running inside this tool.
   * Populated incrementally via `onToolEvent` → `thinking` deltas.
   * `undefined` for tools that are not sub-agents.
   */
  subThinking?: string;

  /**
   * Accumulated text streamed from a sub-agent running inside this tool.
   * Populated incrementally via `onToolEvent` → `text_delta` deltas.
   * `undefined` for tools that are not sub-agents.
   */
  subText?: string;

  /**
   * `true` while the tool is executing; `false` once `tool_call_completed` is received.
   * Drives the spinner → check-mark transition in `<ToolCallBlock>`.
   */
  isStreaming: boolean;
}

/**
 * The rendered state of a single turn in the conversation.
 *
 * Each `sendMessage` call produces one user entry and one assistant entry.
 * The assistant entry is updated in place as `AgentEvent`s stream in; it is
 * never replaced — its `id` is stable for React reconciliation.
 */
export interface ConversationEntry {
  /** Stable identifier used as the React `key` for this entry. */
  id: string;

  /** Whether this entry was produced by the user or the assistant. */
  role: 'user' | 'assistant';

  /**
   * The accumulated text content of this entry.
   *
   * For user entries this is the original message text.
   * For assistant entries it grows with each `text_delta` event and is
   * finalised to `event.output` when `done` is received.
   */
  text: string;

  /**
   * Accumulated thinking/reasoning trace for this assistant turn.
   * Only present when the model emits `thinking` deltas.
   */
  thinking?: string;

  /**
   * Ordered list of tool invocations made during this assistant turn.
   * Each element corresponds to one `tool_call_started` event and is updated
   * in-place as the tool executes.
   */
  toolEvents: ToolEventEntry[];

  /**
   * `true` while the assistant is generating this entry; `false` once `done`,
   * an error, or a cancellation is received.
   * Drives streaming indicators across all child components.
   */
  isStreaming: boolean;
}

/**
 * Allows consumers to replace any or all of the six built-in SVG icons with
 * their own React nodes (e.g. from `lucide-react` or a custom design system).
 *
 * Pass an `IconMap` to the `icons` prop of `<AgentProvider>`. Unspecified keys
 * fall back to the bundled inline SVG defaults.
 *
 * @example
 * ```tsx
 * import { Brain, Wrench, CircleCheck, LoaderCircle, Send, Square } from 'lucide-react';
 *
 * <AgentProvider icons={{
 *   brain:  <Brain size={16} />,
 *   wrench: <Wrench size={16} />,
 *   check:  <CircleCheck size={16} />,
 *   loader: <LoaderCircle size={16} className="mast-spin" />,
 *   send:   <Send size={16} />,
 *   stop:   <Square size={16} />,
 * }}>
 * ```
 */
export interface IconMap {
  /** Shown in the `<ThinkingBlock>` header. */
  brain?: ReactNode;
  /** Shown in the `<ToolCallBlock>` header while the tool is pending. */
  wrench?: ReactNode;
  /** Shown in the `<ToolCallBlock>` header once the tool has completed. */
  check?: ReactNode;
  /** Animated spinner shown during streaming and pending tool calls. */
  loader?: ReactNode;
  /** Shown on the send button in `<ChatInput>`. */
  send?: ReactNode;
  /** Shown on the cancel button in `<ChatInput>` while `isRunning` is true. */
  stop?: ReactNode;
}
