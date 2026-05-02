// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useRef } from 'react';
import type { Conversation } from '@mast-ai/core';
import type { AgentEvent } from '@mast-ai/core';
import type { ConversationEntry, ToolEventEntry } from '../types';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function makeEntry(role: 'user' | 'assistant', text: string, isStreaming: boolean): ConversationEntry {
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
   * @param text - The user's message text.
   */
  sendMessage: (text: string) => void;

  /**
   * Aborts the current run.
   *
   * Signals the underlying `AbortController`, which causes the agent loop to
   * stop and sets the last assistant entry's `isStreaming` flag to `false`.
   * Has no effect when `isRunning` is false.
   */
  cancel: () => void;
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
export function useAgentStream(conversation: Conversation): UseAgentStreamReturn {
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    (text: string) => {
      if (isRunning) return;

      const userEntry = makeEntry('user', text, false);
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
                })),
              );
            } else if (event.type === 'done') {
              setEntries((prev) =>
                updateEntry(prev, assistantId, (e) => ({
                  ...e,
                  text: event.output,
                  isStreaming: false,
                })),
              );
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

  return { entries, isRunning, sendMessage, cancel };
}
