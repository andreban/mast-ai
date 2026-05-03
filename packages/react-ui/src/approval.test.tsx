// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  AgentRunner,
  ToolRegistry,
  type AdapterRequest,
  type AdapterStreamChunk,
  type AgentConfig,
  type LlmAdapter,
  type Tool,
  type ToolContext,
  type ToolDefinition,
} from '@mast-ai/core';

import { AgentProvider, useAgent } from './context';
import { INLINE_APPROVAL, type OnApprovalRequired } from './approval';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns an adapter that dequeues one scripted stream per `generateStream`
 * call. Every script must end with a final-text chunk (no tool calls), or the
 * runner will keep looping looking for more scripts.
 */
function scriptedAdapter(scripts: AdapterStreamChunk[][]): LlmAdapter {
  let i = 0;
  return {
    generate: vi.fn(),
    generateStream: (_request: AdapterRequest) => {
      const script = scripts[i++] ?? [];
      return (async function* () {
        for (const chunk of script) yield chunk;
      })();
    },
  };
}

class StubTool implements Tool {
  public readonly call: ReturnType<typeof vi.fn>;
  constructor(
    private readonly _definition: ToolDefinition,
    result: unknown = 'stub-result',
  ) {
    this.call = vi.fn(async (_args: unknown, _ctx: ToolContext) => result);
  }
  definition(): ToolDefinition {
    return this._definition;
  }
}

const SENSITIVE_DEF: ToolDefinition = {
  name: 'sensitive',
  description: 'A sensitive tool that requires approval.',
  parameters: { type: 'object', properties: {}, required: [] },
  scope: 'write',
  requiresApproval: true,
};

const SAFE_DEF: ToolDefinition = {
  name: 'safe',
  description: 'A safe tool that does not require approval.',
  parameters: { type: 'object', properties: {}, required: [] },
  scope: 'read',
};

const agentConfig: AgentConfig = { name: 'TestAgent', instructions: 'A test agent.' };

/**
 * Builds an `AgentRunner` whose adapter calls `toolName` once and then emits
 * `final` text on the next round-trip. Returns the runner and the registered
 * tool stub so tests can assert on it.
 */
function makeRunnerWithTool(
  toolDef: ToolDefinition,
  toolResult: unknown = 'stub-result',
  final: string = 'done',
) {
  const tool = new StubTool(toolDef, toolResult);
  const registry = new ToolRegistry().register(tool);
  const adapter = scriptedAdapter([
    [
      {
        type: 'tool_call',
        toolCall: { id: '1', name: toolDef.name, args: {} },
      },
    ],
    [{ type: 'text_delta', delta: final }],
  ]);
  const runner = new AgentRunner(adapter, registry);
  return { runner, tool };
}

function wrapper(props: {
  runner: AgentRunner;
  onApprovalRequired?: OnApprovalRequired;
  approvalOverride?: string[];
}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AgentProvider
        runner={props.runner}
        agent={agentConfig}
        onApprovalRequired={props.onApprovalRequired}
        approvalOverride={props.approvalOverride}
      >
        {children}
      </AgentProvider>
    );
  };
}

async function sendAndWait(result: { current: ReturnType<typeof useAgent> }, text: string) {
  await act(async () => {
    result.current.sendMessage(text);
  });
  // The stream is consumed asynchronously inside an async IIFE in
  // useAgentStream. One extra microtask flush settles the final state.
  await act(async () => {
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// Tests — SPEC §11.2 approval flow
// ---------------------------------------------------------------------------

describe('AgentProvider — approval flow', () => {
  it('calls onApprovalRequired before executing a tool with requiresApproval: true', async () => {
    const { runner, tool } = makeRunnerWithTool(SENSITIVE_DEF);
    const onApprovalRequired = vi.fn(async () => true);

    const { result } = renderHook(() => useAgent(), {
      wrapper: wrapper({ runner, onApprovalRequired }),
    });

    await sendAndWait(result, 'go');

    expect(onApprovalRequired).toHaveBeenCalledTimes(1);
    expect(onApprovalRequired).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'sensitive', isStreaming: true }),
    );
    expect(tool.call).toHaveBeenCalledTimes(1);
  });

  it('cancels the tool call when the callback returns false', async () => {
    const { runner, tool } = makeRunnerWithTool(SENSITIVE_DEF);
    const onApprovalRequired = vi.fn(async () => false);

    const { result } = renderHook(() => useAgent(), {
      wrapper: wrapper({ runner, onApprovalRequired }),
    });

    await sendAndWait(result, 'go');

    expect(tool.call).not.toHaveBeenCalled();
    const lastTurn = result.current.messages.at(-1);
    const completed = lastTurn?.toolEvents.find((t) => t.name === 'sensitive');
    expect(completed?.result).toMatch(/cancel/i);
  });

  it('injects the string return value as the tool result without executing the tool', async () => {
    const { runner, tool } = makeRunnerWithTool(SENSITIVE_DEF);
    const onApprovalRequired = vi.fn(async () => 'synthetic result');

    const { result } = renderHook(() => useAgent(), {
      wrapper: wrapper({ runner, onApprovalRequired }),
    });

    await sendAndWait(result, 'go');

    expect(tool.call).not.toHaveBeenCalled();
    const lastTurn = result.current.messages.at(-1);
    const completed = lastTurn?.toolEvents.find((t) => t.name === 'sensitive');
    expect(completed?.result).toBe('synthetic result');
  });

  it('executes the tool normally when the callback returns true', async () => {
    const { runner, tool } = makeRunnerWithTool(SENSITIVE_DEF, 'real-result');
    const onApprovalRequired = vi.fn(async () => true);

    const { result } = renderHook(() => useAgent(), {
      wrapper: wrapper({ runner, onApprovalRequired }),
    });

    await sendAndWait(result, 'go');

    expect(tool.call).toHaveBeenCalledTimes(1);
    const lastTurn = result.current.messages.at(-1);
    const completed = lastTurn?.toolEvents.find((t) => t.name === 'sensitive');
    expect(completed?.result).toBe('real-result');
  });

  it('approvalOverride adds approval to a tool that does not declare requiresApproval', async () => {
    const { runner, tool } = makeRunnerWithTool(SAFE_DEF);
    const onApprovalRequired = vi.fn(async () => true);

    const { result } = renderHook(() => useAgent(), {
      wrapper: wrapper({
        runner,
        onApprovalRequired,
        approvalOverride: ['safe'],
      }),
    });

    await sendAndWait(result, 'go');

    expect(onApprovalRequired).toHaveBeenCalledTimes(1);
    expect(tool.call).toHaveBeenCalledTimes(1);
  });

  it('approvalOverride with `!` suppresses approval for a tool flagged requiresApproval: true', async () => {
    const { runner, tool } = makeRunnerWithTool(SENSITIVE_DEF);
    const onApprovalRequired = vi.fn(async () => true);

    const { result } = renderHook(() => useAgent(), {
      wrapper: wrapper({
        runner,
        onApprovalRequired,
        approvalOverride: ['!sensitive'],
      }),
    });

    await sendAndWait(result, 'go');

    expect(onApprovalRequired).not.toHaveBeenCalled();
    expect(tool.call).toHaveBeenCalledTimes(1);
  });

  it('executes requiresApproval: true tools silently when no onApprovalRequired is provided', async () => {
    const { runner, tool } = makeRunnerWithTool(SENSITIVE_DEF);

    const { result } = renderHook(() => useAgent(), { wrapper: wrapper({ runner }) });

    await sendAndWait(result, 'go');

    expect(tool.call).toHaveBeenCalledTimes(1);
  });

  it('does not affect tools whose effective needsApproval is false', async () => {
    const { runner, tool } = makeRunnerWithTool(SAFE_DEF);
    const onApprovalRequired = vi.fn(async () => true);

    const { result } = renderHook(() => useAgent(), {
      wrapper: wrapper({ runner, onApprovalRequired }),
    });

    await sendAndWait(result, 'go');

    expect(onApprovalRequired).not.toHaveBeenCalled();
    expect(tool.call).toHaveBeenCalledTimes(1);
  });

  describe('awaitingApproval flag', () => {
    it('is true while the callback is pending and false after it resolves', async () => {
      const { runner } = makeRunnerWithTool(SENSITIVE_DEF);

      // Hold the approval callback open so we can observe the awaiting state.
      let resolveApproval!: (decision: boolean) => void;
      const onApprovalRequired = vi.fn(
        () => new Promise<boolean>((resolve) => (resolveApproval = resolve)),
      );

      const { result } = renderHook(() => useAgent(), {
        wrapper: wrapper({ runner, onApprovalRequired }),
      });

      // Kick off the run; do not flush past the awaiting point yet.
      act(() => {
        result.current.sendMessage('go');
      });

      // Let the runner emit tool_call_started and the proxy notify awaiting=true.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const awaitingEntry = result.current.messages
        .at(-1)
        ?.toolEvents.find((t) => t.name === 'sensitive');
      expect(awaitingEntry?.awaitingApproval).toBe(true);
      expect(awaitingEntry?.isStreaming).toBe(true);

      // Approve and let the rest of the run play out.
      await act(async () => {
        resolveApproval(true);
        await Promise.resolve();
        await Promise.resolve();
      });

      const completed = result.current.messages
        .at(-1)
        ?.toolEvents.find((t) => t.name === 'sensitive');
      expect(completed?.awaitingApproval).toBe(false);
      expect(completed?.isStreaming).toBe(false);
    });

    it('is cleared even when the callback rejects the call', async () => {
      const { runner } = makeRunnerWithTool(SENSITIVE_DEF);
      const onApprovalRequired = vi.fn(async () => false);

      const { result } = renderHook(() => useAgent(), {
        wrapper: wrapper({ runner, onApprovalRequired }),
      });

      await sendAndWait(result, 'go');

      const completed = result.current.messages
        .at(-1)
        ?.toolEvents.find((t) => t.name === 'sensitive');
      expect(completed?.awaitingApproval).toBe(false);
    });

    it('is cleared even when the callback throws', async () => {
      const { runner } = makeRunnerWithTool(SENSITIVE_DEF);
      const onApprovalRequired = vi.fn(async () => {
        throw new Error('boom');
      });

      const { result } = renderHook(() => useAgent(), {
        wrapper: wrapper({ runner, onApprovalRequired }),
      });

      await sendAndWait(result, 'go');

      const completed = result.current.messages
        .at(-1)
        ?.toolEvents.find((t) => t.name === 'sensitive');
      expect(completed?.awaitingApproval).toBe(false);
    });
  });

  describe('tool call status', () => {
    it("marks a successful tool call as 'success'", async () => {
      const { runner } = makeRunnerWithTool(SAFE_DEF);

      const { result } = renderHook(() => useAgent(), { wrapper: wrapper({ runner }) });

      await sendAndWait(result, 'go');

      const completed = result.current.messages.at(-1)?.toolEvents.find((t) => t.name === 'safe');
      expect(completed?.status).toBe('success');
    });

    it("marks a thrown tool call as 'error'", async () => {
      class ThrowingTool implements Tool {
        definition(): ToolDefinition {
          return SAFE_DEF;
        }
        async call(): Promise<unknown> {
          throw new Error('boom');
        }
      }
      const registry = new ToolRegistry().register(new ThrowingTool());
      const adapter = scriptedAdapter([
        [{ type: 'tool_call', toolCall: { id: '1', name: SAFE_DEF.name, args: {} } }],
        [{ type: 'text_delta', delta: 'done' }],
      ]);
      const runner = new AgentRunner(adapter, registry);

      const { result } = renderHook(() => useAgent(), { wrapper: wrapper({ runner }) });

      await sendAndWait(result, 'go');

      const completed = result.current.messages.at(-1)?.toolEvents.find((t) => t.name === 'safe');
      expect(completed?.status).toBe('error');
    });

    it("marks a user-rejected tool call as 'cancelled'", async () => {
      const { runner } = makeRunnerWithTool(SENSITIVE_DEF);
      const onApprovalRequired = vi.fn(async () => false);

      const { result } = renderHook(() => useAgent(), {
        wrapper: wrapper({ runner, onApprovalRequired }),
      });

      await sendAndWait(result, 'go');

      const completed = result.current.messages
        .at(-1)
        ?.toolEvents.find((t) => t.name === 'sensitive');
      expect(completed?.status).toBe('cancelled');
    });
  });

  describe('INLINE_APPROVAL queue', () => {
    it('exposes a PendingApproval handle on useAgent().pendingApprovals while awaiting', async () => {
      const { runner } = makeRunnerWithTool(SENSITIVE_DEF);
      const onApprovalRequired = vi.fn(async () => INLINE_APPROVAL);

      const { result } = renderHook(() => useAgent(), {
        wrapper: wrapper({ runner, onApprovalRequired }),
      });

      act(() => {
        result.current.sendMessage('go');
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.pendingApprovals).toHaveLength(1);
      expect(result.current.pendingApprovals[0]).toMatchObject({
        toolName: 'sensitive',
        args: {},
      });
    });

    it('approve() runs the tool and removes the handle from the queue', async () => {
      const { runner, tool } = makeRunnerWithTool(SENSITIVE_DEF, 'real-result');
      const onApprovalRequired = vi.fn(async () => INLINE_APPROVAL);

      const { result } = renderHook(() => useAgent(), {
        wrapper: wrapper({ runner, onApprovalRequired }),
      });

      act(() => {
        result.current.sendMessage('go');
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.pendingApprovals).toHaveLength(1);

      await act(async () => {
        result.current.pendingApprovals[0].approve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(tool.call).toHaveBeenCalledTimes(1);
      expect(result.current.pendingApprovals).toHaveLength(0);
      const completed = result.current.messages
        .at(-1)
        ?.toolEvents.find((t) => t.name === 'sensitive');
      expect(completed?.result).toBe('real-result');
      expect(completed?.status).toBe('success');
    });

    it("reject() cancels the call and marks status 'cancelled'", async () => {
      const { runner, tool } = makeRunnerWithTool(SENSITIVE_DEF);
      const onApprovalRequired = vi.fn(async () => INLINE_APPROVAL);

      const { result } = renderHook(() => useAgent(), {
        wrapper: wrapper({ runner, onApprovalRequired }),
      });

      act(() => {
        result.current.sendMessage('go');
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        result.current.pendingApprovals[0].reject();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(tool.call).not.toHaveBeenCalled();
      const completed = result.current.messages
        .at(-1)
        ?.toolEvents.find((t) => t.name === 'sensitive');
      expect(completed?.status).toBe('cancelled');
      expect(completed?.result).toMatch(/cancel/i);
    });

    it('respondWith() injects the string as the tool result without executing the tool', async () => {
      const { runner, tool } = makeRunnerWithTool(SENSITIVE_DEF);
      const onApprovalRequired = vi.fn(async () => INLINE_APPROVAL);

      const { result } = renderHook(() => useAgent(), {
        wrapper: wrapper({ runner, onApprovalRequired }),
      });

      act(() => {
        result.current.sendMessage('go');
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        result.current.pendingApprovals[0].respondWith('synthetic');
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(tool.call).not.toHaveBeenCalled();
      const completed = result.current.messages
        .at(-1)
        ?.toolEvents.find((t) => t.name === 'sensitive');
      expect(completed?.result).toBe('synthetic');
    });

    it('reset() rejects in-flight approvals so the run terminates', async () => {
      const { runner, tool } = makeRunnerWithTool(SENSITIVE_DEF);
      const onApprovalRequired = vi.fn(async () => INLINE_APPROVAL);

      const { result } = renderHook(() => useAgent(), {
        wrapper: wrapper({ runner, onApprovalRequired }),
      });

      act(() => {
        result.current.sendMessage('go');
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.pendingApprovals).toHaveLength(1);

      await act(async () => {
        result.current.reset();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(tool.call).not.toHaveBeenCalled();
      expect(result.current.pendingApprovals).toHaveLength(0);
      expect(result.current.messages).toEqual([]);
    });
  });
});
