// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import type { AgentConfig, AgentEvent, AgentRunner, Conversation } from '@mast-ai/core';

import { AgentProvider, useAgent } from './context';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fake `AgentRunner` whose `conversation()` returns a fresh fake
 * `Conversation` that yields the supplied scripted events on `runStream`.
 *
 * The `vi.fn` wrapping `conversation` lets tests assert how many times a fresh
 * `Conversation` was created.
 */
function makeMockRunner(events: AgentEvent[] = []): AgentRunner {
  const make = (): Conversation =>
    ({
      history: [],
      runStream(): AsyncIterable<AgentEvent> {
        return (async function* () {
          for (const event of events) yield event;
        })();
      },
    }) as unknown as Conversation;

  return {
    conversation: vi.fn(make),
  } as unknown as AgentRunner;
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
    const runner = makeMockRunner();
    const { result } = renderHook(() => useAgent(), { wrapper: makeWrapper(runner) });

    expect(result.current.messages).toEqual([]);
    expect(typeof result.current.sendMessage).toBe('function');
    expect(typeof result.current.cancel).toBe('function');
    expect(typeof result.current.reset).toBe('function');
    expect(result.current.isRunning).toBe(false);
  });

  it('sendMessage appends entries that are exposed via messages', async () => {
    const runner = makeMockRunner([
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

  it('reset() clears messages and creates a fresh Conversation', async () => {
    const runner = makeMockRunner([{ type: 'done', output: 'ok', history: [] }]);
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
});
