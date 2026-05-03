// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { AgentEvent, Conversation } from '@mast-ai/core';
import { useAgentStream } from './useAgentStream.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type OnToolEvent = (toolName: string, event: AgentEvent) => void;

/**
 * Creates a minimal Conversation mock whose `runStream` yields the given
 * `mainEvents` in order.
 *
 * After yielding each `tool_call_started` event, any sub-events registered for
 * that tool name in `subEventsByTool` are synchronously forwarded to the
 * `onToolEvent` callback — simulating a sub-agent emitting events during tool
 * execution.
 */
function mockConversation(
  mainEvents: AgentEvent[],
  subEventsByTool?: Map<string, AgentEvent[]>,
): Conversation {
  return {
    history: [],
    runStream(
      _input: string,
      _signal?: AbortSignal,
      onToolEvent?: OnToolEvent,
    ): AsyncIterable<AgentEvent> {
      return (async function* () {
        for (const event of mainEvents) {
          yield event;
          if (event.type === 'tool_call_started' && onToolEvent && subEventsByTool) {
            for (const sub of subEventsByTool.get(event.name) ?? []) {
              onToolEvent(event.name, sub);
            }
          }
        }
      })();
    },
  } as unknown as Conversation;
}

/**
 * Creates a Conversation mock whose stream yields `beforeEvents`, then blocks
 * until the returned `resume` function is called, then yields `afterEvents`.
 *
 * Useful for asserting intermediate streaming state.
 */
function pausableConversation(
  beforeEvents: AgentEvent[],
  afterEvents: AgentEvent[],
): { conversation: Conversation; resume: () => void } {
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });

  const conversation = {
    history: [],
    runStream(): AsyncIterable<AgentEvent> {
      return (async function* () {
        for (const event of beforeEvents) yield event;
        await gate;
        for (const event of afterEvents) yield event;
      })();
    },
  } as unknown as Conversation;

  return { conversation, resume };
}

/**
 * Creates a Conversation mock whose stream yields `beforeEvents` then throws
 * an error, simulating a network failure or adapter error.
 */
function erroringConversation(beforeEvents: AgentEvent[]): Conversation {
  return {
    history: [],
    runStream(): AsyncIterable<AgentEvent> {
      return (async function* () {
        for (const event of beforeEvents) yield event;
        throw new Error('Stream error');
      })();
    },
  } as unknown as Conversation;
}

/**
 * Creates a Conversation mock whose stream blocks until the returned abort
 * signal fires, simulating a long-running run that is externally cancelled.
 */
function cancellableConversation(beforeEvents: AgentEvent[]): {
  conversation: Conversation;
} {
  const conversation = {
    history: [],
    runStream(_input: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
      return (async function* () {
        for (const event of beforeEvents) yield event;
        await new Promise<never>((_, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        });
      })();
    },
  } as unknown as Conversation;
  return { conversation };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAgentStream', () => {
  it('starts with empty entries and isRunning false', () => {
    const conv = mockConversation([]);
    const { result } = renderHook(() => useAgentStream(conv));

    expect(result.current.entries).toHaveLength(0);
    expect(result.current.isRunning).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Text streaming
  // -------------------------------------------------------------------------

  it('appends a user entry and a streaming assistant entry immediately on sendMessage', () => {
    const { conversation, resume } = pausableConversation([], []);
    const { result } = renderHook(() => useAgentStream(conversation));

    act(() => {
      result.current.sendMessage('Hello');
    });

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[0]).toMatchObject({
      role: 'user',
      text: 'Hello',
      isStreaming: false,
    });
    expect(result.current.entries[1]).toMatchObject({
      role: 'assistant',
      text: '',
      isStreaming: true,
    });
    expect(result.current.isRunning).toBe(true);

    resume();
  });

  it('accumulates text_delta events into the assistant entry text', async () => {
    const conv = mockConversation([
      { type: 'text_delta', delta: 'Hello' },
      { type: 'text_delta', delta: ', ' },
      { type: 'text_delta', delta: 'world' },
      { type: 'done', output: 'Hello, world', history: [] },
    ]);
    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('Hi');
    });

    expect(result.current.entries[1].text).toBe('Hello, world');
    expect(result.current.entries[1].isStreaming).toBe(false);
  });

  it('sets isStreaming false on the assistant entry after the done event', async () => {
    const conv = mockConversation([
      { type: 'text_delta', delta: 'Hi' },
      { type: 'done', output: 'Hi', history: [] },
    ]);
    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('Hey');
    });

    expect(result.current.entries[1].isStreaming).toBe(false);
    expect(result.current.isRunning).toBe(false);
  });

  it('finalises text from done.output, not from accumulated deltas', async () => {
    const conv = mockConversation([
      { type: 'text_delta', delta: 'partial' },
      { type: 'done', output: 'canonical output', history: [] },
    ]);
    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('go');
    });

    expect(result.current.entries[1].text).toBe('canonical output');
  });

  it('isStreaming is true during streaming and false after completion', async () => {
    const { conversation, resume } = pausableConversation(
      [{ type: 'text_delta', delta: 'So far...' }],
      [{ type: 'done', output: 'So far...', history: [] }],
    );
    const { result } = renderHook(() => useAgentStream(conversation));

    // Start the run but do not let it complete yet.
    act(() => {
      result.current.sendMessage('test');
    });

    expect(result.current.entries[1].isStreaming).toBe(true);
    expect(result.current.isRunning).toBe(true);

    // Let the stream complete.
    resume();
    await act(async () => {});

    expect(result.current.entries[1].isStreaming).toBe(false);
    expect(result.current.isRunning).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Thinking streaming
  // -------------------------------------------------------------------------

  it('accumulates thinking deltas into the thinking field', async () => {
    const conv = mockConversation([
      { type: 'thinking', delta: 'Step 1. ' },
      { type: 'thinking', delta: 'Step 2.' },
      { type: 'text_delta', delta: 'Answer' },
      { type: 'done', output: 'Answer', history: [] },
    ]);
    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('think');
    });

    expect(result.current.entries[1].thinking).toBe('Step 1. Step 2.');
    expect(result.current.entries[1].text).toBe('Answer');
  });

  it('thinking field is undefined when no thinking deltas are emitted', async () => {
    const conv = mockConversation([
      { type: 'text_delta', delta: 'Answer' },
      { type: 'done', output: 'Answer', history: [] },
    ]);
    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('hi');
    });

    expect(result.current.entries[1].thinking).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Tool call lifecycle
  // -------------------------------------------------------------------------

  it('appends a streaming ToolEventEntry on tool_call_started', async () => {
    const { conversation, resume } = pausableConversation(
      [{ type: 'tool_call_started', name: 'my_tool', args: { x: 1 } }],
      [
        { type: 'tool_call_completed', name: 'my_tool', result: 'done' },
        { type: 'done', output: 'ok', history: [] },
      ],
    );
    const { result } = renderHook(() => useAgentStream(conversation));

    act(() => {
      result.current.sendMessage('run');
    });

    // The tool_call_started state update is async; waitFor polls until it lands.
    await waitFor(() => {
      expect(result.current.entries[1].toolEvents).toHaveLength(1);
    });
    expect(result.current.entries[1].toolEvents[0]).toMatchObject({
      type: 'tool_call_started',
      name: 'my_tool',
      args: { x: 1 },
      isStreaming: true,
    });

    resume();
    await act(async () => {});
  });

  it('marks ToolEventEntry completed with result on tool_call_completed', async () => {
    const conv = mockConversation([
      { type: 'tool_call_started', name: 'calc', args: { expr: '2+2' } },
      { type: 'tool_call_completed', name: 'calc', result: 4 },
      { type: 'done', output: 'The answer is 4.', history: [] },
    ]);
    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('calculate');
    });

    const toolEvent = result.current.entries[1].toolEvents[0];
    expect(toolEvent.type).toBe('tool_call_completed');
    expect(toolEvent.result).toBe(4);
    expect(toolEvent.isStreaming).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Sub-agent thinking via onToolEvent
  // -------------------------------------------------------------------------

  it('appends sub-agent thinking deltas to ToolEventEntry.subThinking', async () => {
    const subEvents = new Map<string, AgentEvent[]>([
      [
        'agent_tool',
        [
          { type: 'thinking', delta: 'Considering...' },
          { type: 'thinking', delta: ' Done.' },
        ],
      ],
    ]);
    const conv = mockConversation(
      [
        { type: 'tool_call_started', name: 'agent_tool', args: {} },
        { type: 'tool_call_completed', name: 'agent_tool', result: 'ok' },
        { type: 'done', output: 'done', history: [] },
      ],
      subEvents,
    );
    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('run agent');
    });

    expect(result.current.entries[1].toolEvents[0].subThinking).toBe('Considering... Done.');
  });

  // -------------------------------------------------------------------------
  // Sub-agent text via onToolEvent
  // -------------------------------------------------------------------------

  it('appends sub-agent text_delta events to ToolEventEntry.subText', async () => {
    const subEvents = new Map<string, AgentEvent[]>([
      [
        'agent_tool',
        [
          { type: 'text_delta', delta: 'Sub ' },
          { type: 'text_delta', delta: 'response.' },
        ],
      ],
    ]);
    const conv = mockConversation(
      [
        { type: 'tool_call_started', name: 'agent_tool', args: {} },
        { type: 'tool_call_completed', name: 'agent_tool', result: 'ok' },
        { type: 'done', output: 'done', history: [] },
      ],
      subEvents,
    );
    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('run agent');
    });

    expect(result.current.entries[1].toolEvents[0].subText).toBe('Sub response.');
  });

  // -------------------------------------------------------------------------
  // Sub-agent done event ignored
  // -------------------------------------------------------------------------

  it('ignores sub-agent done events — parent isStreaming is unaffected', async () => {
    const { conversation, resume } = pausableConversation(
      [{ type: 'tool_call_started', name: 'agent_tool', args: {} }],
      [
        { type: 'tool_call_completed', name: 'agent_tool', result: 'ok' },
        { type: 'done', output: 'done', history: [] },
      ],
    );

    // Patch runStream to fire a sub-agent done event before releasing the gate.
    const base = conversation.runStream.bind(conversation);
    (conversation as unknown as { runStream: typeof base }).runStream = function (
      input: string,
      signal?: AbortSignal,
      onToolEvent?: OnToolEvent,
    ) {
      const inner = base(input, signal, onToolEvent);
      return (async function* () {
        for await (const event of inner) {
          yield event;
          if (event.type === 'tool_call_started' && onToolEvent) {
            // Fire a sub-agent done — should be ignored by the hook.
            onToolEvent('agent_tool', { type: 'done', output: 'sub done', history: [] });
          }
        }
      })();
    };

    const { result } = renderHook(() => useAgentStream(conversation));

    act(() => {
      result.current.sendMessage('run');
    });

    // Parent assistant entry should still be streaming.
    expect(result.current.entries[1].isStreaming).toBe(true);

    resume();
    await act(async () => {});

    // After the parent done, it should be false.
    expect(result.current.entries[1].isStreaming).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Nested tool calls (sub-agent fires its own tool calls)
  // -------------------------------------------------------------------------

  it('appends a nested ToolEventEntry on a child tool_call_started', async () => {
    const subEvents = new Map<string, AgentEvent[]>([
      [
        'agent_tool',
        [
          { type: 'tool_call_started', name: 'inner_tool', args: { q: 1 } },
          { type: 'tool_call_completed', name: 'inner_tool', result: 'inner_result' },
        ],
      ],
    ]);
    const conv = mockConversation(
      [
        { type: 'tool_call_started', name: 'agent_tool', args: {} },
        { type: 'tool_call_completed', name: 'agent_tool', result: 'outer_result' },
        { type: 'done', output: 'done', history: [] },
      ],
      subEvents,
    );
    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('run nested');
    });

    const parent = result.current.entries[1].toolEvents[0];
    expect(parent.name).toBe('agent_tool');
    expect(parent.nestedToolEvents).toHaveLength(1);
    expect(parent.nestedToolEvents![0]).toMatchObject({
      type: 'tool_call_completed',
      name: 'inner_tool',
      args: { q: 1 },
      result: 'inner_result',
      isStreaming: false,
      status: 'success',
    });
  });

  it('marks a nested entry isStreaming: true while the child tool is in flight', async () => {
    const { conversation, resume } = pausableConversation(
      [{ type: 'tool_call_started', name: 'agent_tool', args: {} }],
      [
        { type: 'tool_call_completed', name: 'agent_tool', result: 'outer_result' },
        { type: 'done', output: 'done', history: [] },
      ],
    );

    // Patch runStream so the child fires tool_call_started but not completed
    // while the gate is closed.
    const base = conversation.runStream.bind(conversation);
    (conversation as unknown as { runStream: typeof base }).runStream = function (
      input: string,
      signal?: AbortSignal,
      onToolEvent?: OnToolEvent,
    ) {
      const inner = base(input, signal, onToolEvent);
      return (async function* () {
        for await (const event of inner) {
          yield event;
          if (event.type === 'tool_call_started' && onToolEvent) {
            onToolEvent('agent_tool', {
              type: 'tool_call_started',
              name: 'inner_tool',
              args: {},
            });
          }
        }
      })();
    };

    const { result } = renderHook(() => useAgentStream(conversation));

    act(() => {
      result.current.sendMessage('run');
    });

    await waitFor(() => {
      const parent = result.current.entries[1].toolEvents[0];
      expect(parent?.nestedToolEvents).toHaveLength(1);
    });

    const parent = result.current.entries[1].toolEvents[0];
    expect(parent.nestedToolEvents![0]).toMatchObject({
      type: 'tool_call_started',
      name: 'inner_tool',
      isStreaming: true,
    });

    resume();
    await act(async () => {});
  });

  it('records error status on a nested tool_call_completed with error: true', async () => {
    const subEvents = new Map<string, AgentEvent[]>([
      [
        'agent_tool',
        [
          { type: 'tool_call_started', name: 'inner_tool', args: {} },
          {
            type: 'tool_call_completed',
            name: 'inner_tool',
            result: 'boom',
            error: true,
          },
        ],
      ],
    ]);
    const conv = mockConversation(
      [
        { type: 'tool_call_started', name: 'agent_tool', args: {} },
        { type: 'tool_call_completed', name: 'agent_tool', result: 'outer_result' },
        { type: 'done', output: 'done', history: [] },
      ],
      subEvents,
    );
    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('run');
    });

    const parent = result.current.entries[1].toolEvents[0];
    expect(parent.nestedToolEvents![0].status).toBe('error');
  });

  it('routes multiple nested tool calls under the same parent in order', async () => {
    const subEvents = new Map<string, AgentEvent[]>([
      [
        'agent_tool',
        [
          { type: 'tool_call_started', name: 'inner_a', args: {} },
          { type: 'tool_call_completed', name: 'inner_a', result: 'a' },
          { type: 'tool_call_started', name: 'inner_b', args: {} },
          { type: 'tool_call_completed', name: 'inner_b', result: 'b' },
        ],
      ],
    ]);
    const conv = mockConversation(
      [
        { type: 'tool_call_started', name: 'agent_tool', args: {} },
        { type: 'tool_call_completed', name: 'agent_tool', result: 'outer_result' },
        { type: 'done', output: 'done', history: [] },
      ],
      subEvents,
    );
    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('run');
    });

    const nested = result.current.entries[1].toolEvents[0].nestedToolEvents!;
    expect(nested.map((n) => n.name)).toEqual(['inner_a', 'inner_b']);
    expect(nested.map((n) => n.result)).toEqual(['a', 'b']);
    expect(nested.every((n) => !n.isStreaming)).toBe(true);
  });

  it('still routes child thinking and text deltas to the parent entry, not nested', async () => {
    const subEvents = new Map<string, AgentEvent[]>([
      [
        'agent_tool',
        [
          { type: 'thinking', delta: 'planning ' },
          { type: 'tool_call_started', name: 'inner_tool', args: {} },
          { type: 'text_delta', delta: 'narration ' },
          { type: 'tool_call_completed', name: 'inner_tool', result: 'inner' },
        ],
      ],
    ]);
    const conv = mockConversation(
      [
        { type: 'tool_call_started', name: 'agent_tool', args: {} },
        { type: 'tool_call_completed', name: 'agent_tool', result: 'outer_result' },
        { type: 'done', output: 'done', history: [] },
      ],
      subEvents,
    );
    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('run');
    });

    const parent = result.current.entries[1].toolEvents[0];
    expect(parent.subThinking).toBe('planning ');
    expect(parent.subText).toBe('narration ');
    expect(parent.nestedToolEvents).toHaveLength(1);
    expect(parent.nestedToolEvents![0].subThinking).toBeUndefined();
    expect(parent.nestedToolEvents![0].subText).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Concurrent tool calls
  // -------------------------------------------------------------------------

  it('tracks concurrent tool calls independently and routes sub-agent events correctly', async () => {
    const subEvents = new Map<string, AgentEvent[]>([
      ['tool_a', [{ type: 'text_delta', delta: 'Sub text A' }]],
      ['tool_b', [{ type: 'thinking', delta: 'Sub thinking B' }]],
    ]);
    const conv = mockConversation(
      [
        { type: 'tool_call_started', name: 'tool_a', args: { a: 1 } },
        { type: 'tool_call_started', name: 'tool_b', args: { b: 2 } },
        { type: 'tool_call_completed', name: 'tool_a', result: 'result_a' },
        { type: 'tool_call_completed', name: 'tool_b', result: 'result_b' },
        { type: 'done', output: 'Both done.', history: [] },
      ],
      subEvents,
    );
    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('run both');
    });

    const toolEvents = result.current.entries[1].toolEvents;
    expect(toolEvents).toHaveLength(2);

    const a = toolEvents.find((t) => t.name === 'tool_a')!;
    expect(a.subText).toBe('Sub text A');
    expect(a.result).toBe('result_a');
    expect(a.isStreaming).toBe(false);

    const b = toolEvents.find((t) => t.name === 'tool_b')!;
    expect(b.subThinking).toBe('Sub thinking B');
    expect(b.result).toBe('result_b');
    expect(b.isStreaming).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Error / cancel
  // -------------------------------------------------------------------------

  it('sets isStreaming false on the last entry when the stream errors', async () => {
    const conv = erroringConversation([{ type: 'text_delta', delta: 'Partial...' }]);
    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('go');
    });

    expect(result.current.entries[1].isStreaming).toBe(false);
    expect(result.current.isRunning).toBe(false);
  });

  it('leaves prior entries unchanged when a later run errors', async () => {
    // First turn completes successfully.
    const conv1 = mockConversation([
      { type: 'text_delta', delta: 'First response' },
      { type: 'done', output: 'First response', history: [] },
    ]);
    const { result, rerender } = renderHook(
      ({ conv }: { conv: Conversation }) => useAgentStream(conv),
      { initialProps: { conv: conv1 } },
    );

    await act(async () => {
      result.current.sendMessage('first');
    });

    const firstAssistantText = result.current.entries[1].text;
    expect(firstAssistantText).toBe('First response');

    // Second turn errors.
    const conv2 = erroringConversation([]);
    rerender({ conv: conv2 });

    await act(async () => {
      result.current.sendMessage('second');
    });

    // First entry text is unchanged.
    expect(result.current.entries[1].text).toBe('First response');
    // Last (errored) entry has isStreaming: false.
    expect(result.current.entries[3].isStreaming).toBe(false);
  });

  it('sets isStreaming false when cancel() is called', async () => {
    // No beforeEvents: the stream blocks immediately so the abort listener is
    // registered during the first generator.next() call.
    const { conversation } = cancellableConversation([]);
    const { result } = renderHook(() => useAgentStream(conversation));

    act(() => {
      result.current.sendMessage('go');
    });

    // Flush the microtask that starts the stream and registers the abort listener.
    await act(async () => {});

    act(() => {
      result.current.cancel();
    });

    // Abort resolution is async; waitFor polls until state settles.
    await waitFor(() => {
      expect(result.current.entries[1].isStreaming).toBe(false);
    });
    expect(result.current.isRunning).toBe(false);
  });

  // -------------------------------------------------------------------------
  // New turn sequencing
  // -------------------------------------------------------------------------

  it('appends a new entry pair on a second sendMessage rather than mutating the first', async () => {
    const makeConv = (output: string) => mockConversation([{ type: 'done', output, history: [] }]);

    const { result, rerender } = renderHook(
      ({ conv }: { conv: Conversation }) => useAgentStream(conv),
      { initialProps: { conv: makeConv('First') } },
    );

    await act(async () => {
      result.current.sendMessage('Turn 1');
    });

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[0].text).toBe('Turn 1');
    expect(result.current.entries[1].text).toBe('First');

    rerender({ conv: makeConv('Second') });

    await act(async () => {
      result.current.sendMessage('Turn 2');
    });

    expect(result.current.entries).toHaveLength(4);
    expect(result.current.entries[2].text).toBe('Turn 2');
    expect(result.current.entries[3].text).toBe('Second');

    // Original entries are unchanged.
    expect(result.current.entries[0].text).toBe('Turn 1');
    expect(result.current.entries[1].text).toBe('First');
  });

  // -------------------------------------------------------------------------
  // displayText override
  // -------------------------------------------------------------------------

  it('uses the prompt as the user bubble text when no displayText is given', async () => {
    const promptCalls: string[] = [];
    const conv = {
      history: [],
      runStream(input: string): AsyncIterable<AgentEvent> {
        promptCalls.push(input);
        return (async function* () {
          yield { type: 'done', output: 'ok', history: [] };
        })();
      },
    } as unknown as Conversation;

    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('Hello world');
    });

    expect(promptCalls).toEqual(['Hello world']);
    expect(result.current.entries[0]).toMatchObject({
      role: 'user',
      text: 'Hello world',
    });
  });

  it('uses displayText for the user bubble while the runner receives the prompt', async () => {
    const promptCalls: string[] = [];
    const conv = {
      history: [],
      runStream(input: string): AsyncIterable<AgentEvent> {
        promptCalls.push(input);
        return (async function* () {
          yield { type: 'done', output: 'ok', history: [] };
        })();
      },
    } as unknown as Conversation;

    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('Summarize the active document.', '/summarize');
    });

    expect(promptCalls).toEqual(['Summarize the active document.']);
    expect(result.current.entries[0]).toMatchObject({
      role: 'user',
      text: '/summarize',
    });
  });

  it('treats empty-string displayText as a deliberate override', async () => {
    const promptCalls: string[] = [];
    const conv = {
      history: [],
      runStream(input: string): AsyncIterable<AgentEvent> {
        promptCalls.push(input);
        return (async function* () {
          yield { type: 'done', output: 'ok', history: [] };
        })();
      },
    } as unknown as Conversation;

    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('hidden prompt', '');
    });

    expect(promptCalls).toEqual(['hidden prompt']);
    expect(result.current.entries[0]).toMatchObject({
      role: 'user',
      text: '',
    });
  });

  it('assigns stable unique ids to every entry', async () => {
    const conv = mockConversation([{ type: 'done', output: 'ok', history: [] }]);
    const { result } = renderHook(() => useAgentStream(conv));

    await act(async () => {
      result.current.sendMessage('hi');
    });

    const ids = result.current.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toBeTruthy());
  });
});
