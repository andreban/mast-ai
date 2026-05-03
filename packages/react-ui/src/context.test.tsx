// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { renderHook, act, render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import type { AgentConfig, AgentEvent, AgentRunner, Conversation, Message } from '@mast-ai/core';

import { AgentProvider, useAgent } from './context';
import { defaultIcons, useIcons } from './icons';
import type { ConversationEntry, IconMap } from './types';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fake `AgentRunner` whose `conversation()` returns a fresh fake
 * `Conversation` that yields the supplied scripted events on `runStream`.
 *
 * The `vi.fn` wrapping `conversation` lets tests assert how many times a fresh
 * `Conversation` was created. Each created `Conversation` is appended to
 * `created` so tests can inspect or mutate them after construction (e.g. to
 * verify that `initialHistory` was seeded onto `Conversation.history`).
 */
function makeMockRunner(events: AgentEvent[] = []): {
  runner: AgentRunner;
  created: Conversation[];
  runStreamSpy: ReturnType<typeof vi.fn>;
} {
  const created: Conversation[] = [];
  const runStreamSpy = vi.fn();
  const make = (): Conversation => {
    const conv = {
      history: [] as Message[],
      runStream(input: string): AsyncIterable<AgentEvent> {
        runStreamSpy(input, [...conv.history]);
        return (async function* () {
          for (const event of events) yield event;
        })();
      },
    } as unknown as Conversation;
    created.push(conv);
    return conv;
  };

  const runner = {
    conversation: vi.fn(make),
  } as unknown as AgentRunner;
  return { runner, created, runStreamSpy };
}

const agentConfig: AgentConfig = {
  name: 'TestAgent',
  instructions: 'A test agent.',
};

function makeWrapper(runner: AgentRunner) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AgentProvider runner={runner} agent={agentConfig}>
        {children}
      </AgentProvider>
    );
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAgent', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React logs caught render errors to console.error. Suppress to keep
    // the throws-outside-provider test output clean.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('throws a descriptive error when called outside <AgentProvider>', () => {
    expect(() => renderHook(() => useAgent())).toThrow(/AgentProvider/);
  });

  it('returns { messages, sendMessage, cancel, isRunning, reset }', () => {
    const { runner } = makeMockRunner();
    const { result } = renderHook(() => useAgent(), { wrapper: makeWrapper(runner) });

    expect(result.current.messages).toEqual([]);
    expect(typeof result.current.sendMessage).toBe('function');
    expect(typeof result.current.cancel).toBe('function');
    expect(typeof result.current.reset).toBe('function');
    expect(result.current.isRunning).toBe(false);
  });

  it('sendMessage appends entries that are exposed via messages', async () => {
    const { runner } = makeMockRunner([
      { type: 'text_delta', delta: 'Hi' },
      { type: 'done', output: 'Hi', history: [] },
    ]);
    const { result } = renderHook(() => useAgent(), { wrapper: makeWrapper(runner) });

    await act(async () => {
      result.current.sendMessage('hello');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', text: 'hello' });
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', text: 'Hi' });
  });

  it('exposes the bundled icon defaults when no `icons` prop is provided', () => {
    const { runner } = makeMockRunner();
    const { result } = renderHook(() => useIcons(), { wrapper: makeWrapper(runner) });

    expect(result.current).toBe(defaultIcons);
  });

  it('overrides individual icon slots from the `icons` prop, leaving the rest as defaults', () => {
    const { runner } = makeMockRunner();
    const customSend = <span data-testid="custom-send">SEND</span>;
    const customStop = <span data-testid="custom-stop">STOP</span>;
    const icons: IconMap = { send: customSend, stop: customStop };

    function ProbeIcons() {
      const map = useIcons();
      return (
        <div>
          <div data-testid="brain-slot">{map.brain}</div>
          <div data-testid="send-slot">{map.send}</div>
          <div data-testid="stop-slot">{map.stop}</div>
        </div>
      );
    }

    const { getByTestId } = render(
      <AgentProvider runner={runner} agent={agentConfig} icons={icons}>
        <ProbeIcons />
      </AgentProvider>,
    );

    expect(getByTestId('custom-send').textContent).toBe('SEND');
    expect(getByTestId('custom-stop').textContent).toBe('STOP');
    // The unspecified `brain` slot still renders the bundled SVG default.
    expect(getByTestId('brain-slot').querySelector('svg')).not.toBeNull();
  });

  it('reset() clears messages and creates a fresh Conversation', async () => {
    const { runner } = makeMockRunner([{ type: 'done', output: 'ok', history: [] }]);
    const { result } = renderHook(() => useAgent(), { wrapper: makeWrapper(runner) });

    expect(runner.conversation).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.sendMessage('hi');
    });

    expect(result.current.messages).toHaveLength(2);

    act(() => {
      result.current.reset();
    });

    expect(result.current.messages).toEqual([]);
    expect(runner.conversation).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Conversation persistence (initialHistory, initialEntries, onConversationChange)
  // -------------------------------------------------------------------------

  const userMessage = (text: string): Message => ({
    role: 'user',
    content: { type: 'text', text },
  });
  const assistantMessage = (text: string): Message => ({
    role: 'assistant',
    content: { type: 'text', text },
  });

  it('onConversationChange fires after a `done` event with the latest history and entries', async () => {
    const finalHistory: Message[] = [userMessage('hi'), assistantMessage('Hi back')];
    const { runner } = makeMockRunner([
      { type: 'text_delta', delta: 'Hi back' },
      { type: 'done', output: 'Hi back', history: finalHistory },
    ]);
    const onConversationChange = vi.fn();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AgentProvider
        runner={runner}
        agent={agentConfig}
        onConversationChange={onConversationChange}
      >
        {children}
      </AgentProvider>
    );
    const { result } = renderHook(() => useAgent(), { wrapper });

    expect(onConversationChange).not.toHaveBeenCalled();

    await act(async () => {
      result.current.sendMessage('hi');
    });

    expect(onConversationChange).toHaveBeenCalledTimes(1);
    const [history, entries] = onConversationChange.mock.calls[0] as [
      Message[],
      ConversationEntry[],
    ];
    expect(history).toEqual(finalHistory);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ role: 'user', text: 'hi' });
    expect(entries[1]).toMatchObject({ role: 'assistant', text: 'Hi back', isStreaming: false });
  });

  it('does not fire onConversationChange when a run errors before `done`', async () => {
    const created: Conversation[] = [];
    const erroringConv: Conversation = {
      history: [],
      runStream(): AsyncIterable<AgentEvent> {
        return (async function* () {
          yield { type: 'text_delta', delta: 'partial' } as AgentEvent;
          throw new Error('boom');
        })();
      },
    } as unknown as Conversation;
    created.push(erroringConv);
    const runner = {
      conversation: vi.fn(() => created[0]),
    } as unknown as AgentRunner;
    const onConversationChange = vi.fn();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AgentProvider
        runner={runner}
        agent={agentConfig}
        onConversationChange={onConversationChange}
      >
        {children}
      </AgentProvider>
    );
    const { result } = renderHook(() => useAgent(), { wrapper });

    await act(async () => {
      result.current.sendMessage('hi');
    });

    expect(result.current.isRunning).toBe(false);
    expect(onConversationChange).not.toHaveBeenCalled();
  });

  it('does not fire onConversationChange when the run is cancelled before `done`', async () => {
    const cancellableConv: Conversation = {
      history: [],
      runStream(_input: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
        async function* gen() {
          await new Promise<never>((_, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('Aborted')));
          });
          yield { type: 'done', output: '', history: [] } as AgentEvent;
        }
        return gen();
      },
    } as unknown as Conversation;
    const runner = {
      conversation: vi.fn(() => cancellableConv),
    } as unknown as AgentRunner;
    const onConversationChange = vi.fn();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AgentProvider
        runner={runner}
        agent={agentConfig}
        onConversationChange={onConversationChange}
      >
        {children}
      </AgentProvider>
    );
    const { result } = renderHook(() => useAgent(), { wrapper });

    act(() => {
      result.current.sendMessage('hi');
    });
    // Flush the microtask that registers the abort listener.
    await act(async () => {});

    act(() => {
      result.current.cancel();
    });
    await act(async () => {});

    expect(result.current.isRunning).toBe(false);
    expect(onConversationChange).not.toHaveBeenCalled();
  });

  it('seeds Conversation.history with initialHistory before the first run', async () => {
    const seeded: Message[] = [userMessage('previous question'), assistantMessage('prior answer')];
    const finalHistory: Message[] = [
      ...seeded,
      userMessage('next'),
      assistantMessage('next answer'),
    ];
    const { runner, created, runStreamSpy } = makeMockRunner([
      { type: 'done', output: 'next answer', history: finalHistory },
    ]);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AgentProvider runner={runner} agent={agentConfig} initialHistory={seeded}>
        {children}
      </AgentProvider>
    );
    const { result } = renderHook(() => useAgent(), { wrapper });

    // Conversation.history is seeded immediately on mount.
    expect(created).toHaveLength(1);
    expect(created[0].history).toEqual(seeded);

    // The seeded history is also reflected via useAgent().history before any run.
    expect(result.current.history).toEqual(seeded);

    // Sending a message forwards the seeded history into the runner.
    await act(async () => {
      result.current.sendMessage('next');
    });

    expect(runStreamSpy).toHaveBeenCalledTimes(1);
    const [, historyAtRunStart] = runStreamSpy.mock.calls[0] as [string, Message[]];
    expect(historyAtRunStart).toEqual(seeded);

    // After the turn completes, useAgent().history reflects event.history.
    expect(result.current.history).toEqual(finalHistory);
  });

  it('seeds messages from initialEntries on mount', () => {
    const initialEntries: ConversationEntry[] = [
      {
        id: 'u-1',
        role: 'user',
        text: 'previously',
        toolEvents: [],
        isStreaming: false,
      },
      {
        id: 'a-1',
        role: 'assistant',
        text: 'previously answered',
        toolEvents: [],
        isStreaming: false,
      },
    ];
    const { runner } = makeMockRunner();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AgentProvider runner={runner} agent={agentConfig} initialEntries={initialEntries}>
        {children}
      </AgentProvider>
    );
    const { result } = renderHook(() => useAgent(), { wrapper });

    expect(result.current.messages).toEqual(initialEntries);
  });

  it('reset() clears both messages and history', async () => {
    const finalHistory: Message[] = [userMessage('hi'), assistantMessage('Hi back')];
    const { runner } = makeMockRunner([{ type: 'done', output: 'Hi back', history: finalHistory }]);
    const { result } = renderHook(() => useAgent(), { wrapper: makeWrapper(runner) });

    await act(async () => {
      result.current.sendMessage('hi');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.history).toEqual(finalHistory);

    act(() => {
      result.current.reset();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.history).toEqual([]);
  });

  it('useAgent().history reflects the latest core history after each turn', async () => {
    const firstHistory: Message[] = [userMessage('one'), assistantMessage('first')];
    const secondHistory: Message[] = [
      ...firstHistory,
      userMessage('two'),
      assistantMessage('second'),
    ];
    let scriptedHistory = firstHistory;
    const created: Conversation[] = [];
    const runner = {
      conversation: vi.fn(() => {
        const conv = {
          history: [] as Message[],
          runStream(): AsyncIterable<AgentEvent> {
            const out = scriptedHistory;
            return (async function* () {
              yield { type: 'done', output: 'ok', history: out } as AgentEvent;
            })();
          },
        } as unknown as Conversation;
        created.push(conv);
        return conv;
      }),
    } as unknown as AgentRunner;

    const { result } = renderHook(() => useAgent(), { wrapper: makeWrapper(runner) });

    expect(result.current.history).toEqual([]);

    await act(async () => {
      result.current.sendMessage('one');
    });
    expect(result.current.history).toEqual(firstHistory);

    scriptedHistory = secondHistory;
    await act(async () => {
      result.current.sendMessage('two');
    });
    expect(result.current.history).toEqual(secondHistory);
  });
});
