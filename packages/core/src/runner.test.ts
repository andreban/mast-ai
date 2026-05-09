// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from './runner.js';
import { AgentError } from './error.js';
import { APPROVAL_CANCELLED_RESULT, ApprovalResponse, ToolRegistry } from './tool.js';
import type { LlmAdapter, AdapterRequest, AdapterStreamChunk } from './adapter/index.js';
import type { AgentConfig, AgentEvent } from './types.js';
import type { ApprovalHandler, Tool, ToolContext, ToolDefinition } from './tool.js';

function streamingAdapter(chunks: AdapterStreamChunk[]): LlmAdapter {
  return {
    generate: vi.fn(),
    generateStream: (_request: AdapterRequest) =>
      (async function* () {
        for (const chunk of chunks) yield chunk;
      })(),
  };
}

const agent: AgentConfig = {
  name: 'Child',
  instructions: 'Be a child agent.',
};

describe('hallucinated tool calls', () => {
  it('does not emit tool_call_started for unregistered tools', async () => {
    let callCount = 0;
    const adapter: LlmAdapter = {
      generate: vi.fn(),
      generateStream: (_request: AdapterRequest) =>
        (async function* () {
          if (callCount++ === 0) {
            // First turn: LLM calls a real tool and a hallucinated one.
            yield {
              type: 'tool_call' as const,
              toolCall: { id: '1', name: 'real_tool', args: {} },
            };
            yield {
              type: 'tool_call' as const,
              toolCall: { id: '2', name: 'ghost_tool', args: {} },
            };
          } else {
            yield { type: 'text_delta' as const, delta: 'done' };
          }
        })(),
    };

    const registry = new ToolRegistry();
    registry.register({
      definition: () => ({
        name: 'real_tool',
        description: 'A real tool',
        parameters: {},
        scope: 'read' as const,
      }),
      call: async () => 'real result',
    });

    const runner = new AgentRunner(adapter, registry);
    const events: AgentEvent[] = [];
    for await (const event of runner.runStream(agent, 'go')) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    // tool_call_started must appear exactly once — for real_tool only.
    expect(types.filter((t) => t === 'tool_call_started')).toHaveLength(1);
    expect(events.find((e) => e.type === 'tool_call_started')).toMatchObject({
      name: 'real_tool',
    });
    // tool_call_completed must appear exactly once — for real_tool only.
    expect(types.filter((t) => t === 'tool_call_completed')).toHaveLength(1);
    expect(events.find((e) => e.type === 'tool_call_completed')).toMatchObject({
      name: 'real_tool',
      error: false,
    });
  });

  it('feeds an error result back to the LLM for unregistered tools', async () => {
    const turnRequests: AdapterRequest[] = [];
    let callCount = 0;
    const adapter: LlmAdapter = {
      generate: vi.fn(),
      generateStream: (request: AdapterRequest) =>
        (async function* () {
          turnRequests.push(request);
          if (callCount++ === 0) {
            yield {
              type: 'tool_call' as const,
              toolCall: { id: '1', name: 'ghost_tool', args: {} },
            };
          } else {
            yield { type: 'text_delta' as const, delta: 'done' };
          }
        })(),
    };

    const runner = new AgentRunner(adapter, new ToolRegistry());
    for await (const _ of runner.runStream(agent, 'go')) {
      // drain
    }

    // Second request's history should contain a tool_result for ghost_tool.
    const secondRequest = turnRequests[1];
    const toolResultMsg = secondRequest.messages.find(
      (m) => m.content.type === 'tool_result' && m.content.name === 'ghost_tool',
    );
    expect(toolResultMsg).toBeDefined();
    expect((toolResultMsg!.content as { result: string }).result).toContain('ghost_tool');
  });
});

describe('event ordering within a single LLM turn', () => {
  it('interleaves thinking and tool_call_started in source order from the adapter', async () => {
    let turn = 0;
    const adapter: LlmAdapter = {
      generate: vi.fn(),
      generateStream: (_request: AdapterRequest) =>
        (async function* () {
          if (turn++ === 0) {
            // Mimic Gemini emitting thought → functionCall → thought →
            // functionCall in a single response stream.
            yield { type: 'thinking' as const, delta: 'first thought' };
            yield {
              type: 'tool_call' as const,
              toolCall: { id: '1', name: 'tool_a', args: {} },
            };
            yield { type: 'thinking' as const, delta: 'second thought' };
            yield {
              type: 'tool_call' as const,
              toolCall: { id: '2', name: 'tool_b', args: {} },
            };
          } else {
            yield { type: 'text_delta' as const, delta: 'done' };
          }
        })(),
    };

    const registry = new ToolRegistry();
    for (const name of ['tool_a', 'tool_b']) {
      registry.register({
        definition: () => ({ name, description: name, parameters: {}, scope: 'read' as const }),
        call: async () => `${name}-result`,
      });
    }

    const runner = new AgentRunner(adapter, registry);
    const types: string[] = [];
    for await (const event of runner.runStream(agent, 'go')) {
      types.push(event.type === 'tool_call_started' ? `start:${event.name}` : event.type);
    }

    // Within turn 1, expect interleaving: thinking → start tool_a →
    // thinking → start tool_b. Completed events follow in original order
    // after Promise.all resolves. Turn 2 yields the final text_delta + done.
    expect(types).toEqual([
      'thinking',
      'start:tool_a',
      'thinking',
      'start:tool_b',
      'tool_call_completed',
      'tool_call_completed',
      'text_delta',
      'done',
    ]);
  });

  it('still suppresses inline tool_call_started for hallucinated tools', async () => {
    let turn = 0;
    const adapter: LlmAdapter = {
      generate: vi.fn(),
      generateStream: (_request: AdapterRequest) =>
        (async function* () {
          if (turn++ === 0) {
            yield { type: 'thinking' as const, delta: 'thought' };
            yield {
              type: 'tool_call' as const,
              toolCall: { id: '1', name: 'real_tool', args: {} },
            };
            yield {
              type: 'tool_call' as const,
              toolCall: { id: '2', name: 'ghost_tool', args: {} },
            };
          } else {
            yield { type: 'text_delta' as const, delta: 'done' };
          }
        })(),
    };

    const registry = new ToolRegistry();
    registry.register({
      definition: () => ({
        name: 'real_tool',
        description: 'A real tool',
        parameters: {},
        scope: 'read' as const,
      }),
      call: async () => 'ok',
    });

    const runner = new AgentRunner(adapter, registry);
    const events: AgentEvent[] = [];
    for await (const event of runner.runStream(agent, 'go')) {
      events.push(event);
    }

    const startedNames = events
      .filter((e) => e.type === 'tool_call_started')
      .map((e) => (e as { name: string }).name);
    expect(startedNames).toEqual(['real_tool']);
  });
});

describe('provider_metadata round-trip', () => {
  it('copies provider_metadata from tool call onto matching tool_result message', async () => {
    const turnRequests: AdapterRequest[] = [];
    let callCount = 0;
    const sentinel = { thought_signature: 'sig-abc' };

    const adapter: LlmAdapter = {
      generate: vi.fn(),
      generateStream: (request: AdapterRequest) =>
        (async function* () {
          turnRequests.push(request);
          if (callCount++ === 0) {
            yield {
              type: 'tool_call' as const,
              toolCall: {
                id: '1',
                name: 'real_tool',
                args: {},
                provider_metadata: sentinel,
              },
            };
          } else {
            yield { type: 'text_delta' as const, delta: 'done' };
          }
        })(),
    };

    const registry = new ToolRegistry();
    registry.register({
      definition: () => ({
        name: 'real_tool',
        description: 'A real tool',
        parameters: {},
        scope: 'read' as const,
      }),
      call: async () => 'ok',
    });

    const runner = new AgentRunner(adapter, registry);
    for await (const _ of runner.runStream(agent, 'go')) {
      // drain
    }

    // The second request's history must carry both the tool_calls message
    // (with provider_metadata on each call) and the matching tool_result
    // message (with provider_metadata copied verbatim).
    const secondRequest = turnRequests[1];
    const toolCallsMsg = secondRequest.messages.find((m) => m.content.type === 'tool_calls');
    expect(toolCallsMsg).toBeDefined();
    const calls = (toolCallsMsg!.content as { calls: { provider_metadata?: unknown }[] }).calls;
    expect(calls[0].provider_metadata).toBe(sentinel);

    const toolResultMsg = secondRequest.messages.find((m) => m.content.type === 'tool_result');
    expect(toolResultMsg).toBeDefined();
    expect((toolResultMsg!.content as { provider_metadata?: unknown }).provider_metadata).toBe(
      sentinel,
    );
  });
});

describe('RunBuilder.forwardTo', () => {
  it('forwards every non-done event to parentContext.onEvent in order', async () => {
    const runner = new AgentRunner(
      streamingAdapter([
        { type: 'thinking', delta: 'pondering' },
        { type: 'text_delta', delta: 'Hello ' },
        { type: 'text_delta', delta: 'world' },
      ]),
    );

    const forwarded: AgentEvent[] = [];
    const yielded: AgentEvent[] = [];
    const context: ToolContext = { onEvent: (e) => forwarded.push(e) };

    for await (const event of runner.runBuilder(agent).forwardTo(context).runStream('hi')) {
      yielded.push(event);
    }

    expect(forwarded.map((e) => e.type)).toEqual(['thinking', 'text_delta', 'text_delta']);
    expect(forwarded.some((e) => e.type === 'done')).toBe(false);

    // The stream itself still yields every event including done.
    expect(yielded.map((e) => e.type)).toEqual(['thinking', 'text_delta', 'text_delta', 'done']);
  });

  it('is a no-op when parentContext.onEvent is undefined', async () => {
    const runner = new AgentRunner(streamingAdapter([{ type: 'text_delta', delta: 'ok' }]));

    const yielded: AgentEvent[] = [];
    for await (const event of runner.runBuilder(agent).forwardTo({}).runStream('hi')) {
      yielded.push(event);
    }

    // Stream still yields normally; nothing to assert beyond not throwing.
    expect(yielded.map((e) => e.type)).toEqual(['text_delta', 'done']);
  });

  it('is chainable with history(), signal(), and onToolEvent()', async () => {
    const runner = new AgentRunner(streamingAdapter([{ type: 'text_delta', delta: 'ok' }]));
    const controller = new AbortController();
    const onToolEvent = vi.fn();
    const onEvent = vi.fn();

    const builder = runner
      .runBuilder(agent)
      .history([])
      .signal(controller.signal)
      .forwardTo({ onEvent })
      .onToolEvent(onToolEvent);

    const events: AgentEvent[] = [];
    for await (const event of builder.runStream('hi')) {
      events.push(event);
    }

    expect(events.map((e) => e.type)).toEqual(['text_delta', 'done']);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'text_delta', delta: 'ok' });
  });

  it('still propagates an aborted signal through the run', async () => {
    const controller = new AbortController();
    controller.abort('test reason');

    const runner = new AgentRunner(streamingAdapter([{ type: 'text_delta', delta: 'x' }]));

    await expect(
      (async () => {
        for await (const _event of runner
          .runBuilder(agent)
          .signal(controller.signal)
          .forwardTo({ onEvent: vi.fn() })
          .runStream('hi')) {
          // drain
        }
      })(),
    ).rejects.toBeInstanceOf(AgentError);
  });
});

describe('approval gating', () => {
  function singleCallThenDoneAdapter(
    toolName: string,
    args: unknown = {},
    finalText = 'done',
  ): LlmAdapter {
    let turn = 0;
    return {
      generate: vi.fn(),
      generateStream: (_request: AdapterRequest) =>
        (async function* () {
          if (turn++ === 0) {
            yield {
              type: 'tool_call' as const,
              toolCall: { id: '1', name: toolName, args },
            };
          } else {
            yield { type: 'text_delta' as const, delta: finalText };
          }
        })(),
    };
  }

  function approvalTool(
    name: string,
    options: {
      requiresApproval?: boolean;
      result?: string;
      onCall?: (args: unknown, ctx: ToolContext) => void;
    } = {},
  ): Tool {
    return {
      definition: (): ToolDefinition => ({
        name,
        description: `${name} tool`,
        parameters: {},
        scope: 'write',
        requiresApproval: options.requiresApproval ?? false,
      }),
      call: vi.fn(async (args: unknown, ctx: ToolContext) => {
        options.onCall?.(args, ctx);
        return options.result ?? 'ok';
      }),
    };
  }

  function runnerWithTool(adapter: LlmAdapter, tool: Tool): AgentRunner {
    const registry = new ToolRegistry();
    registry.register(tool);
    return new AgentRunner(adapter, registry);
  }

  async function drain(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    for await (const event of stream) events.push(event);
    return events;
  }

  it('does not call the handler for tools with requiresApproval: false', async () => {
    const handler: ApprovalHandler = { requestApproval: vi.fn() };
    const tool = approvalTool('safe_tool', { requiresApproval: false });
    const runner = runnerWithTool(singleCallThenDoneAdapter('safe_tool'), tool);
    runner.approvalHandler = handler;

    await drain(runner.runStream(agent, 'go'));

    expect(handler.requestApproval).not.toHaveBeenCalled();
    expect(tool.call).toHaveBeenCalledTimes(1);
  });

  it('executes ungated when requiresApproval is true but no handler is attached', async () => {
    const tool = approvalTool('risky_tool', { requiresApproval: true, result: 'ran' });
    const runner = runnerWithTool(singleCallThenDoneAdapter('risky_tool'), tool);

    const events = await drain(runner.runStream(agent, 'go'));

    expect(tool.call).toHaveBeenCalledTimes(1);
    const completed = events.find((e) => e.type === 'tool_call_completed');
    expect(completed).toMatchObject({ name: 'risky_tool', result: 'ran', error: false });
  });

  it('runs the tool when the handler returns approve', async () => {
    const handler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.approve()),
    };
    const tool = approvalTool('risky_tool', { requiresApproval: true, result: 'ran' });
    const runner = runnerWithTool(singleCallThenDoneAdapter('risky_tool', { x: 1 }), tool);
    runner.approvalHandler = handler;

    const events = await drain(runner.runStream(agent, 'go'));

    expect(handler.requestApproval).toHaveBeenCalledWith({ name: 'risky_tool', args: { x: 1 } });
    expect(tool.call).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.type === 'tool_call_completed')).toMatchObject({
      name: 'risky_tool',
      result: 'ran',
      error: false,
    });
  });

  it('skips the tool and returns the default cancelled result on reject() with no result', async () => {
    const handler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.reject()),
    };
    const tool = approvalTool('risky_tool', { requiresApproval: true });
    const runner = runnerWithTool(singleCallThenDoneAdapter('risky_tool'), tool);
    runner.approvalHandler = handler;

    const events = await drain(runner.runStream(agent, 'go'));

    expect(tool.call).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === 'tool_call_completed')).toMatchObject({
      name: 'risky_tool',
      result: APPROVAL_CANCELLED_RESULT,
      error: false,
    });
  });

  it('skips the tool and returns the supplied result on reject(result)', async () => {
    const handler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.reject('Disabled in sandbox.')),
    };
    const tool = approvalTool('risky_tool', { requiresApproval: true });
    const runner = runnerWithTool(singleCallThenDoneAdapter('risky_tool'), tool);
    runner.approvalHandler = handler;

    const events = await drain(runner.runStream(agent, 'go'));

    expect(tool.call).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === 'tool_call_completed')).toMatchObject({
      name: 'risky_tool',
      result: 'Disabled in sandbox.',
      error: false,
    });
  });

  it('per-run handler set via RunBuilder.withApprovalHandler overrides the runner default', async () => {
    const runnerHandler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.approve()),
    };
    const perRunHandler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.reject()),
    };
    const tool = approvalTool('risky_tool', { requiresApproval: true });
    const runner = runnerWithTool(singleCallThenDoneAdapter('risky_tool'), tool);
    runner.approvalHandler = runnerHandler;

    await drain(runner.runBuilder(agent).withApprovalHandler(perRunHandler).runStream('go'));

    expect(perRunHandler.requestApproval).toHaveBeenCalledTimes(1);
    expect(runnerHandler.requestApproval).not.toHaveBeenCalled();
    expect(tool.call).not.toHaveBeenCalled();
  });

  it("falls back to the runner's default handler when no per-run handler is attached", async () => {
    const runnerHandler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.approve()),
    };
    const tool = approvalTool('risky_tool', { requiresApproval: true });
    const runner = runnerWithTool(singleCallThenDoneAdapter('risky_tool'), tool);
    runner.approvalHandler = runnerHandler;

    await drain(runner.runStream(agent, 'go'));

    expect(runnerHandler.requestApproval).toHaveBeenCalledTimes(1);
    expect(tool.call).toHaveBeenCalledTimes(1);
  });

  it('per-run override only applies to that builder; subsequent runs use the runner default', async () => {
    const runnerHandler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.approve()),
    };
    const perRunHandler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.reject()),
    };

    const adapter: LlmAdapter = {
      generate: vi.fn(),
      // Each call to generateStream is a fresh adapter cycle: tool call -> done.
      generateStream: (() => {
        let turn = 0;
        return (_request: AdapterRequest) =>
          (async function* () {
            if (turn++ % 2 === 0) {
              yield {
                type: 'tool_call' as const,
                toolCall: { id: String(turn), name: 'risky_tool', args: {} },
              };
            } else {
              yield { type: 'text_delta' as const, delta: 'done' };
            }
          })();
      })(),
    };

    const tool = approvalTool('risky_tool', { requiresApproval: true });
    const registry = new ToolRegistry();
    registry.register(tool);
    const runner = new AgentRunner(adapter, registry);
    runner.approvalHandler = runnerHandler;

    await drain(runner.runBuilder(agent).withApprovalHandler(perRunHandler).runStream('go'));
    await drain(runner.runStream(agent, 'go'));

    expect(perRunHandler.requestApproval).toHaveBeenCalledTimes(1);
    expect(runnerHandler.requestApproval).toHaveBeenCalledTimes(1);
  });

  it('passes the active handler to ToolContext.approvalHandler when invoking tool.call', async () => {
    const handler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.approve()),
    };

    let receivedCtx: ToolContext | undefined;
    const tool = approvalTool('risky_tool', {
      requiresApproval: true,
      onCall: (_args, ctx) => {
        receivedCtx = ctx;
      },
    });
    const runner = runnerWithTool(singleCallThenDoneAdapter('risky_tool'), tool);
    runner.approvalHandler = handler;

    await drain(runner.runStream(agent, 'go'));

    expect(receivedCtx?.approvalHandler).toBe(handler);
  });

  it('passes the handler to ToolContext even for tools that do not require approval', async () => {
    const handler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.approve()),
    };

    let receivedCtx: ToolContext | undefined;
    const tool = approvalTool('safe_tool', {
      requiresApproval: false,
      onCall: (_args, ctx) => {
        receivedCtx = ctx;
      },
    });
    const runner = runnerWithTool(singleCallThenDoneAdapter('safe_tool'), tool);
    runner.approvalHandler = handler;

    await drain(runner.runStream(agent, 'go'));

    expect(handler.requestApproval).not.toHaveBeenCalled();
    expect(receivedCtx?.approvalHandler).toBe(handler);
  });

  it('forwards the run signal to ApprovalRequest so handlers can race their UI against cancel', async () => {
    const handler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.approve()),
    };
    const tool = approvalTool('risky_tool', { requiresApproval: true });
    const runner = runnerWithTool(singleCallThenDoneAdapter('risky_tool'), tool);
    runner.approvalHandler = handler;

    const controller = new AbortController();
    await drain(runner.runBuilder(agent).signal(controller.signal).runStream('go'));

    expect(handler.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'risky_tool',
        signal: controller.signal,
      }),
    );
  });

  it('aborts cleanly when the signal fires while requestApproval is awaiting', async () => {
    const controller = new AbortController();
    const handler: ApprovalHandler = {
      // Race the abort: resolve as 'reject' once the signal fires, mimicking
      // an inline-approval queue that listens on the signal.
      requestApproval: vi.fn(({ signal }) => {
        return new Promise((resolve) => {
          if (signal?.aborted) {
            resolve(ApprovalResponse.reject());
            return;
          }
          signal?.addEventListener('abort', () => resolve(ApprovalResponse.reject()), {
            once: true,
          });
        });
      }),
    };
    const tool = approvalTool('risky_tool', { requiresApproval: true });
    const runner = runnerWithTool(singleCallThenDoneAdapter('risky_tool'), tool);
    runner.approvalHandler = handler;

    const stream = runner.runBuilder(agent).signal(controller.signal).runStream('go');
    // Kick the loop forward so requestApproval starts awaiting, then abort.
    const collected: AgentEvent[] = [];
    const pump = (async () => {
      for await (const event of stream) collected.push(event);
    })();

    // Let the runner reach the awaiting requestApproval call.
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();

    await expect(pump).rejects.toThrow(AgentError);
    expect(tool.call).not.toHaveBeenCalled();
  });
});
