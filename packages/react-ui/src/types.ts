// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react';

/**
 * Outcome of a completed tool call.
 *
 * - `success`: tool returned normally
 * - `error`: tool threw an exception (or the tool was not found)
 * - `cancelled`: the user rejected the call via the approval flow
 */
export type ToolCallStatus = 'success' | 'error' | 'cancelled';

/**
 * The rendered state of a single tool invocation within an assistant turn.
 *
 * Created when a `tool_call_started` event is received and updated as the tool
 * executes. For tools that run sub-agents, `nestedContentBlocks` accumulates the
 * sub-agent's interleaved thinking and tool calls in source order, and
 * `subText` accumulates the sub-agent's final text response. Both are streamed
 * via {@link AgentRunner}'s `onToolEvent` callback.
 */
export interface ToolEventEntry {
  /**
   * Stable identifier for this tool invocation. Generated when the
   * `tool_call_started` event is received and used as the React `key` in
   * lists and to correlate `PendingApproval` handles back to the entry.
   */
  id: string;

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
   * Accumulated text streamed from a sub-agent running inside this tool.
   * Populated incrementally via `onToolEvent` → `text_delta` deltas.
   * `undefined` for tools that are not sub-agents.
   */
  subText?: string;

  /**
   * Ordered content blocks produced by a sub-agent running inside this tool.
   * Each `thinking` delta forwarded via `onToolEvent` is accumulated into the
   * last {@link ThinkingEntry} block, or starts a new one when the previous
   * block is a tool call. Each `tool_call_started` event appends a new
   * {@link ToolEventEntry}. The ordering faithfully reflects the sequence in
   * which the sub-agent emitted thinking and tool calls, mirroring the
   * top-level {@link ConversationEntry.contentBlocks} pattern.
   *
   * Because each `ToolEventEntry` in the array can itself carry its own
   * `nestedContentBlocks`, this nests recursively for sub-sub-agents.
   *
   * `undefined` when the tool is not a sub-agent or has not yet emitted any
   * nested events.
   */
  nestedContentBlocks?: ContentBlock[];

  /**
   * `true` while the tool is executing; `false` once `tool_call_completed` is received.
   * Drives the spinner → check-mark transition in `<ToolCallBlock>`.
   */
  isStreaming: boolean;

  /**
   * `true` while the approval proxy is awaiting the user's decision via the
   * `onApprovalRequired` callback or the inline approval queue. Set to `true`
   * immediately before the callback is invoked and cleared once a decision
   * is reached (approved, rejected, or replaced with a synthetic result).
   * Always `false` for tools that do not require approval.
   *
   * Only meaningful while `isStreaming` is also `true`.
   */
  awaitingApproval?: boolean;

  /**
   * Final outcome of the tool call.
   *
   * Populated when `isStreaming` transitions to `false`:
   * - `success`: tool returned normally
   * - `error`: tool threw an exception (or was not registered)
   * - `cancelled`: the user rejected the call via the approval flow
   *
   * `undefined` while the tool is still streaming.
   */
  status?: ToolCallStatus;
}

/**
 * A thinking/reasoning block produced during one LLM turn.
 *
 * Created when the first `thinking` delta arrives after a tool call (or at
 * the very start of the stream) and accumulated until the next tool call or
 * the end of the turn. Multiple `ThinkingEntry` blocks may appear in
 * `ConversationEntry.contentBlocks` when the model thinks, calls a tool,
 * then thinks again.
 */
export interface ThinkingEntry {
  /** Stable identifier used as the React `key` for this block. */
  id: string;

  /** Discriminator. */
  type: 'thinking';

  /** Accumulated reasoning text. Grows with each `thinking` delta. */
  content: string;
}

/**
 * A single content block within an assistant turn. Either a thinking/reasoning
 * trace or a tool invocation. The array is ordered by arrival time, so
 * thinking blocks and tool calls are interleaved in the sequence they occurred.
 */
export type ContentBlock = ThinkingEntry | ToolEventEntry;

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
   * Ordered list of content blocks produced during this assistant turn.
   *
   * Each `thinking` delta is accumulated into the last `ThinkingEntry` block,
   * or starts a new one when the previous block is a tool call. Each
   * `tool_call_started` event appends a `ToolEventEntry`. The ordering
   * faithfully reflects the sequence in which thinking and tool calls occurred,
   * so multi-turn reasoning (think → tool → think again) renders correctly.
   */
  contentBlocks: ContentBlock[];

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
  /** Shown in the `<ToolCallBlock>` header when the tool succeeded. */
  check?: ReactNode;
  /** Shown in the `<ToolCallBlock>` header when the tool threw an error. */
  error?: ReactNode;
  /** Shown in the `<ToolCallBlock>` header when the user cancelled the tool call. */
  cancelled?: ReactNode;
  /** Animated spinner shown during streaming and pending tool calls. */
  loader?: ReactNode;
  /** Shown on the send button in `<ChatInput>`. */
  send?: ReactNode;
  /** Shown on the cancel button in `<ChatInput>` while `isRunning` is true. */
  stop?: ReactNode;
}
