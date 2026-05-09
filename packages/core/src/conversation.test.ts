// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from './runner.js';
import { ApprovalResponse, ToolRegistry } from './tool.js';
import type { LlmAdapter, AdapterRequest } from './adapter/index.js';
import type { AgentConfig, AgentEvent } from './types.js';
import type { ApprovalHandler, Tool } from './tool.js';

const agent: AgentConfig = {
  name: 'Test',
  instructions: 'Be tested.',
};

function approvalTool(name: string): Tool {
  return {
    definition: () => ({
      name,
      description: `${name} tool`,
      parameters: {},
      scope: 'write' as const,
      requiresApproval: true,
    }),
    call: vi.fn(async () => 'ok'),
  };
}

/**
 * Adapter that, on each call to `generateStream`, alternates between emitting
 * a single tool call and a final text turn. Each two-turn cycle represents
 * one full `runStream` invocation.
 */
function alternatingToolCallAdapter(toolName: string): LlmAdapter {
  let turn = 0;
  return {
    generate: vi.fn(),
    generateStream: (_request: AdapterRequest) =>
      (async function* () {
        if (turn++ % 2 === 0) {
          yield {
            type: 'tool_call' as const,
            toolCall: { id: String(turn), name: toolName, args: {} },
          };
        } else {
          yield { type: 'text_delta' as const, delta: 'done' };
        }
      })(),
  };
}

async function drain(stream: AsyncIterable<AgentEvent>): Promise<void> {
  for await (const _ of stream) {
    // drain
  }
}

describe('Conversation approval handler propagation', () => {
  it('propagates the configured handler into every runStream call', async () => {
    const handler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.approve()),
    };
    const tool = approvalTool('risky_tool');
    const registry = new ToolRegistry();
    registry.register(tool);
    const runner = new AgentRunner(alternatingToolCallAdapter('risky_tool'), registry);

    const conversation = runner.conversation(agent, { approvalHandler: handler });

    await drain(conversation.runStream('first'));
    await drain(conversation.runStream('second'));

    expect(handler.requestApproval).toHaveBeenCalledTimes(2);
    expect(tool.call).toHaveBeenCalledTimes(2);
  });

  it('does not consult the runner default when a Conversation handler is set', async () => {
    const conversationHandler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.approve()),
    };
    const runnerHandler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.reject()),
    };
    const tool = approvalTool('risky_tool');
    const registry = new ToolRegistry();
    registry.register(tool);
    const runner = new AgentRunner(alternatingToolCallAdapter('risky_tool'), registry);
    runner.approvalHandler = runnerHandler;

    const conversation = runner.conversation(agent, { approvalHandler: conversationHandler });
    await drain(conversation.runStream('hi'));

    expect(conversationHandler.requestApproval).toHaveBeenCalledTimes(1);
    expect(runnerHandler.requestApproval).not.toHaveBeenCalled();
    expect(tool.call).toHaveBeenCalledTimes(1);
  });

  it('falls back to the runner default when no Conversation handler is set', async () => {
    const runnerHandler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.approve()),
    };
    const tool = approvalTool('risky_tool');
    const registry = new ToolRegistry();
    registry.register(tool);
    const runner = new AgentRunner(alternatingToolCallAdapter('risky_tool'), registry);
    runner.approvalHandler = runnerHandler;

    const conversation = runner.conversation(agent);
    await drain(conversation.runStream('hi'));

    expect(runnerHandler.requestApproval).toHaveBeenCalledTimes(1);
    expect(tool.call).toHaveBeenCalledTimes(1);
  });

  it('reads the handler by reference so swaps take effect on the next run', async () => {
    const firstHandler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.approve()),
    };
    const secondHandler: ApprovalHandler = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.reject()),
    };
    const tool = approvalTool('risky_tool');
    const registry = new ToolRegistry();
    registry.register(tool);
    const runner = new AgentRunner(alternatingToolCallAdapter('risky_tool'), registry);

    // The handler is held inside an object whose reference is stable, so the
    // Conversation reads through to its current value on every run.
    const ref: { current: ApprovalHandler } = { current: firstHandler };
    const proxy: ApprovalHandler = {
      requestApproval: (req) => ref.current.requestApproval(req),
    };
    const conversation = runner.conversation(agent, { approvalHandler: proxy });

    await drain(conversation.runStream('one'));
    ref.current = secondHandler;
    await drain(conversation.runStream('two'));

    expect(firstHandler.requestApproval).toHaveBeenCalledTimes(1);
    expect(secondHandler.requestApproval).toHaveBeenCalledTimes(1);
    // First run approved, second rejected — so tool.call only ran once.
    expect(tool.call).toHaveBeenCalledTimes(1);
  });
});
