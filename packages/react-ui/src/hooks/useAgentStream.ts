// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Conversation, Message } from '@mast-ai/core';
import type { AgentEvent } from '@mast-ai/core';
import type { ConversationEntry, ToolCallStatus, ToolEventEntry } from '../types';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function makeEntry(
  role: 'user' | 'assistant',
  text: string,
  isStreaming: boolean,
): ConversationEntry {
  return { id: crypto.randomUUID(), role, text, toolEvents: [], isStreaming };
}

/**
 * Returns a new array with the entry identified by `id` replaced by the result
 * of calling `updater` on it. All other entries are returned unchanged.
 */
function updateEntry(
  entries: ConversationEntry[],
  id: string,
  updater: (e: ConversationEntry) => ConversationEntry,
): ConversationEntry[] {
  return entries.map((e) => (e.id === id ? updater(e) : e));
}

/**
 * Returns a new array where the first `ToolEventEntry` in the entry identified
 * by `entryId` that matches `toolName` and is still streaming is replaced by
 * the result of `updater`. All other entries and tool events are unchanged.
 */
function updateToolEvent(
  entries: ConversationEntry[],
  entryId: string,
  toolName: string,
  updater: (t: ToolEventEntry) => ToolEventEntry,
): ConversationEntry[] {
  return updateEntry(entries, entryId, (entry) => {
    let patched = false;
    const toolEvents = entry.toolEvents.map((t) => {
      if (!patched && t.name === toolName && t.isStreaming) {
        patched = true;
        return updater(t);
      }
      return t;
    });
    return { ...entry, toolEvents };
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Options accepted by {@link useAgentStream}.
 */
export interface UseAgentStreamOptions {
  /**
   * Initial UI entry list. Used to restore a previously-saved conversation
   * so existing turns render immediately on mount. Read once when the hook
   * first initialises; changes to this prop after mount are ignored.
   */
  initialEntries?: ConversationEntry[];

  /**
   * Called after a turn ends with the `done` event, with the freshly
   * committed `entries` and `history`. Not called when a run is cancelled
   * or errors before `done` is received.
   */
  onTurnComplete?: (entries: ConversationEntry[], history: Message[]) => void;
}

/**
 * The value returned by {@link useAgentStream}.
 */
export interface UseAgentStreamReturn {
  /**
   * Ordered list of conversation entries built from the `AgentEvent` stream.
   * Each `sendMessage` call appends one user entry and one assistant entry.
   * Entries are updated in-place as events stream in; their `id` values are
   * stable across renders.
   */
  entries: ConversationEntry[];

  /**
   * Live mirror of the underlying `Conversation.history`. Initialised from
   * `conversation.history` and updated to `event.history` whenever a `done`
   * event is observed. Use this to imperatively persist conversation state.
   */
  history: Message[];

  /**
   * `true` while the agent is generating a response; `false` otherwise.
   * Reflects the overall run state rather than the individual entry's streaming
   * flag, which may differ briefly at the boundaries of a run.
   */
  isRunning: boolean;

  /**
   * Sends a user message and starts a new agent run.
   *
   * Appends a user `ConversationEntry` and an empty streaming assistant
   * `ConversationEntry`, then consumes the `AgentEvent` stream emitted by
   * `conversation.runStream`. Calling `sendMessage` while a run is already in
   * progress is a no-op (the caller should disable the input while `isRunning`
   * is true).
   *
   * @param text - The prompt sent to the LLM via `Conversation.runStream`.
   * @param displayText - Optional override for the text rendered in the user
   *   bubble. When provided, the user `ConversationEntry.text` is set to this
   *   value while `text` is still passed unchanged to the runner. An empty
   *   string is treated as a deliberate override (it does not fall back to
   *   `text`).
   */
  sendMessage: (text: string, displayText?: string) => void;

  /**
   * Aborts the current run.
   *
   * Signals the underlying `AbortController`, which causes the agent loop to
   * stop and sets the last assistant entry's `isStreaming` flag to `false`.
   * Has no effect when `isRunning` is false.
   */
  cancel: () => void;

  /**
   * Aborts any in-flight run and clears all conversation entries.
   *
   * Note that this only resets the UI rendering state owned by this hook. It
   * does not clear the underlying `Conversation.history`; callers wanting to
   * start a fresh conversation should also replace the `Conversation` instance.
   */
  reset: () => void;

  /**
   * Sets the `awaitingApproval` flag on the first matching streaming
   * `ToolEventEntry` (by `name`) within the most recent assistant entry.
   *
   * Used by the approval proxy in `AgentProvider` to surface "awaiting human
   * decision" as a first-class state on the entry, so renderers can show a
   * pause indicator without correlating tool calls themselves.
   */
  setToolAwaitingApproval: (name: string, awaiting: boolean) => void;

  /**
   * Sets the `status` field on the first matching streaming `ToolEventEntry`
   * (by `name`). Used by the approval proxy to mark a call as `'cancelled'`
   * before the runner emits `tool_call_completed` so the eventual completion
   * event preserves the cancellation rather than defaulting to `'success'`.
   */
  setToolStatus: (name: string, status: ToolCallStatus) => void;
}

/**
 * Internal hook that drives the streaming state machine for a single
 * `Conversation` instance.
 *
 * Subscribes to `AgentEvent`s emitted by `conversation.runStream` and
 * maintains a `ConversationEntry[]` that reflects the current rendered state
 * of the conversation. Sub-agent events are captured via `onToolEvent` and
 * routed to the matching `ToolEventEntry` by tool name.
 *
 * This hook is consumed by `<AgentProvider>` and is not part of the public API.
 * It is exported so that it can be used independently in advanced scenarios.
 *
 * ### State machine summary
 *
 * | Event | Action |
 * |-------|--------|
 * | `sendMessage(text)` | Append user entry; append assistant entry with `isStreaming: true` |
 * | `text_delta` | Append delta to last assistant entry's `text` |
 * | `thinking` | Append delta to last assistant entry's `thinking` |
 * | `tool_call_started` | Push new `ToolEventEntry` with `isStreaming: true` |
 * | `onToolEvent` → `thinking` | Append delta to matching `ToolEventEntry.subThinking` |
 * | `onToolEvent` → `text_delta` | Append delta to matching `ToolEventEntry.subText` |
 * | `onToolEvent` → `done` | Ignored |
 * | `tool_call_completed` | Set `result` and `isStreaming: false` on matching entry |
 * | `done` | Set `text = output` and `isStreaming: false` on assistant entry |
 * | Error / cancel | Set `isStreaming: false` on last assistant entry |
 *
 * @param conversation - A `Conversation` instance obtained from
 *   `AgentRunner.conversation(agentConfig)`.
 *
 * @example
 * ```tsx
 * const conversation = useMemo(() => runner.conversation(agentConfig), [runner, agentConfig]);
 * const { entries, sendMessage, cancel, isRunning } = useAgentStream(conversation);
 * ```
 */
export function useAgentStream(
  conversation: Conversation,
  options?: UseAgentStreamOptions,
): UseAgentStreamReturn {
  const [entries, setEntries] = useState<ConversationEntry[]>(() => options?.initialEntries ?? []);
  const [history, setHistory] = useState<Message[]>(() => [...conversation.history]);
  const [isRunning, setIsRunning] = useState(false);
  // Bumped after every `done` event to trigger the onTurnComplete effect once
  // the new entries and history have been committed by React.
  const [completedTurnId, setCompletedTurnId] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const onTurnCompleteRef = useRef(options?.onTurnComplete);
  onTurnCompleteRef.current = options?.onTurnComplete;

  // Effect intentionally depends only on completedTurnId — it ticks atomically
  // with the state updates from the `done` event, and we do not want it to
  // fire on intermediate streaming updates to entries/history.
  useEffect(() => {
    if (completedTurnId === 0) return;
    onTurnCompleteRef.current?.(entries, history);
  }, [completedTurnId]);

  const findStreamingAssistantId = (entries: ConversationEntry[]): string | undefined => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.role === 'assistant' && e.isStreaming) return e.id;
    }
    return undefined;
  };

  const setToolAwaitingApproval = useCallback((name: string, awaiting: boolean) => {
    setEntries((prev) => {
      const assistantId = findStreamingAssistantId(prev);
      if (assistantId === undefined) return prev;
      return updateToolEvent(prev, assistantId, name, (t) => ({
        ...t,
        awaitingApproval: awaiting,
      }));
    });
  }, []);

  const setToolStatus = useCallback((name: string, status: ToolCallStatus) => {
    setEntries((prev) => {
      const assistantId = findStreamingAssistantId(prev);
      if (assistantId === undefined) return prev;
      return updateToolEvent(prev, assistantId, name, (t) => ({ ...t, status }));
    });
  }, []);

  const sendMessage = useCallback(
    (text: string, displayText?: string) => {
      if (isRunning) return;

      // `??` (not `||`) so an explicit empty-string displayText is respected as
      // a deliberate override rather than collapsing back to `text`.
      const userEntry = makeEntry('user', displayText ?? text, false);
      const assistantEntry = makeEntry('assistant', '', true);
      const assistantId = assistantEntry.id;

      setEntries((prev) => [...prev, userEntry, assistantEntry]);
      setIsRunning(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const run = async () => {
        try {
          const stream = conversation.runStream(
            text,
            controller.signal,
            (toolName, event: AgentEvent) => {
              if (event.type === 'thinking') {
                setEntries((prev) =>
                  updateToolEvent(prev, assistantId, toolName, (t) => ({
                    ...t,
                    subThinking: (t.subThinking ?? '') + event.delta,
                  })),
                );
              } else if (event.type === 'text_delta') {
                setEntries((prev) =>
                  updateToolEvent(prev, assistantId, toolName, (t) => ({
                    ...t,
                    subText: (t.subText ?? '') + event.delta,
                  })),
                );
              }
              // done events from sub-agents are intentionally ignored —
              // tool_call_completed is the authoritative signal that a tool finished.
            },
          );

          for await (const event of stream) {
            if (event.type === 'text_delta') {
              setEntries((prev) =>
                updateEntry(prev, assistantId, (e) => ({
                  ...e,
                  text: e.text + event.delta,
                })),
              );
            } else if (event.type === 'thinking') {
              setEntries((prev) =>
                updateEntry(prev, assistantId, (e) => ({
                  ...e,
                  thinking: (e.thinking ?? '') + event.delta,
                })),
              );
            } else if (event.type === 'tool_call_started') {
              const toolEvent: ToolEventEntry = {
                id: crypto.randomUUID(),
                type: 'tool_call_started',
                name: event.name,
                args: event.args,
                isStreaming: true,
              };
              setEntries((prev) =>
                updateEntry(prev, assistantId, (e) => ({
                  ...e,
                  toolEvents: [...e.toolEvents, toolEvent],
                })),
              );
            } else if (event.type === 'tool_call_completed') {
              setEntries((prev) =>
                updateToolEvent(prev, assistantId, event.name, (t) => ({
                  ...t,
                  type: 'tool_call_completed',
                  result: event.result,
                  isStreaming: false,
                  // Preserve a status set by the proxy (e.g. 'cancelled'); only
                  // fall back to error/success based on the runner's flag.
                  status: t.status ?? (event.error ? 'error' : 'success'),
                })),
              );
            } else if (event.type === 'done') {
              const finalHistory = event.history;
              setEntries((prev) =>
                updateEntry(prev, assistantId, (e) => ({
                  ...e,
                  text: event.output,
                  isStreaming: false,
                })),
              );
              setHistory(finalHistory);
              setCompletedTurnId((n) => n + 1);
            }
          }
        } catch {
          setEntries((prev) =>
            updateEntry(prev, assistantId, (e) => ({ ...e, isStreaming: false })),
          );
        } finally {
          setIsRunning(false);
        }
      };

      void run();
    },
    [conversation, isRunning],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setEntries([]);
    setHistory([]);
    setIsRunning(false);
  }, []);

  return {
    entries,
    history,
    isRunning,
    sendMessage,
    cancel,
    reset,
    setToolAwaitingApproval,
    setToolStatus,
  };
}
