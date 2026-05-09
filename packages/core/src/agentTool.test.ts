// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { createAgentTool } from './agentTool.js';
import { AgentRunner } from './runner.js';
import { AgentError } from './error.js';
import { ApprovalResponse, ToolRegistry } from './tool.js';
import type { LlmAdapter, AdapterRequest, AdapterStreamChunk } from './adapter/index.js';
import type { AgentConfig, AgentEvent } from './types.js';
import type { ApprovalHandler, Tool, ToolContext } from './tool.js';

function streamingAdapter(chunks: AdapterStreamChunk[]): LlmAdapter {
  return {
    generate: vi.fn(),
    generateStream: (_request: AdapterRequest) =>
      (async function* () {
        for (const chunk of chunks) yield chunk;
      })(),
  };
}

const childAgent: AgentConfig = {
  name: 'Child',
  instructions: 'Be a child agent.',
};

describe('createAgentTool', () => {
  it('exposes the configured definition', () => {
    const runner = new AgentRunner(streamingAdapter([]));
    const tool = createAgentTool(runner, childAgent, {
      name: 'classify',
      description: 'Classifies intent.',
      parameters: { type: 'object' },
      scope: 'write',
      requiresApproval: true,
      buildInput: () => '',
    });

    expect(tool.definition()).toEqual({
      name: 'classify',
      description: 'Classifies intent.',
      parameters: { type: 'object' },
      scope: 'write',
      requiresApproval: true,
    });
  });

  it("defaults scope to 'read' when omitted", () => {
    const runner = new AgentRunner(streamingAdapter([]));
    const tool = createAgentTool(runner, childAgent, {
      name: 't',
      description: 'd',
      parameters: {},
      buildInput: () => '',
    });
    expect(tool.definition().scope).toBe('read');
  });

  it('forwards non-done child events via context.onEvent and returns done.output', async () => {
    const runner = new AgentRunner(
      streamingAdapter([
        { type: 'thinking', delta: 'pondering' },
        { type: 'text_delta', delta: 'Hello ' },
        { type: 'text_delta', delta: 'world' },
      ]),
    );

    const tool = createAgentTool(runner, childAgent, {
      name: 'sub',
      description: 'sub',
      parameters: {},
      buildInput: (args) => (args as { q: string }).q,
    });

    const events: AgentEvent[] = [];
    const context: ToolContext = { onEvent: (e) => events.push(e) };

    const result = await tool.call({ q: 'hi' }, context);

    expect(result).toBe('Hello world');
    // No 'done' event should be forwarded.
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['thinking', 'text_delta', 'text_delta']);
  });

  it('threads context.signal into the child runner', async () => {
    const controller = new AbortController();
    controller.abort('test reason');

    const runner = new AgentRunner(streamingAdapter([{ type: 'text_delta', delta: 'x' }]));
    const tool = createAgentTool(runner, childAgent, {
      name: 'sub',
      description: 'sub',
      parameters: {},
      buildInput: () => 'input',
    });

    await expect(tool.call({}, { signal: controller.signal })).rejects.toBeInstanceOf(AgentError);
  });

  it('throws AgentError when the child stream ends without a done event', async () => {
    const runner = new AgentRunner(streamingAdapter([]));
    // Replace runBuilder to return a stream that ends with no events at all,
    // bypassing the runner's normal 'done' emission.
    const originalRunBuilder = runner.runBuilder.bind(runner);
    runner.runBuilder = (agent: AgentConfig) => {
      const builder = originalRunBuilder(agent);
      builder.runStream = () =>
        (async function* () {
          // intentionally yields nothing
        })();
      return builder;
    };

    const tool = createAgentTool(runner, childAgent, {
      name: 'sub',
      description: 'sub',
      parameters: {},
      buildInput: () => 'input',
    });

    await expect(tool.call({}, {})).rejects.toBeInstanceOf(AgentError);
  });

  describe('approvalHandler inheritance', () => {
    function childToolCallAdapter(toolName: string): LlmAdapter {
      let turn = 0;
      return {
        generate: vi.fn(),
        generateStream: (_request: AdapterRequest) =>
          (async function* () {
            if (turn++ === 0) {
              yield {
                type: 'tool_call' as const,
                toolCall: { id: '1', name: toolName, args: {} },
              };
            } else {
              yield { type: 'text_delta' as const, delta: 'done' };
            }
          })(),
      };
    }

    function approvalTool(name: string): Tool {
      return {
        definition: () => ({
          name,
          description: `${name} tool`,
          parameters: {},
          scope: 'write' as const,
          requiresApproval: true,
        }),
        call: vi.fn(async () => 'tool-ran'),
      };
    }

    function childRunnerWithTool(tool: Tool): AgentRunner {
      const registry = new ToolRegistry();
      registry.register(tool);
      return new AgentRunner(childToolCallAdapter(tool.definition().name), registry);
    }

    it('forwards ctx.approvalHandler to the child run when the child runner has no default', async () => {
      const inheritedHandler: ApprovalHandler = {
        requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.approve()),
      };
      const childTool = approvalTool('child_tool');
      const childRunner = childRunnerWithTool(childTool);

      const tool = createAgentTool(childRunner, childAgent, {
        name: 'sub',
        description: 'sub',
        parameters: {},
        buildInput: () => 'go',
      });

      await tool.call({}, { approvalHandler: inheritedHandler });

      expect(inheritedHandler.requestApproval).toHaveBeenCalledWith({
        name: 'child_tool',
        args: {},
      });
      expect(childTool.call).toHaveBeenCalledTimes(1);
    });

    it("uses the child runner's own approvalHandler instead of inheriting", async () => {
      const inheritedHandler: ApprovalHandler = {
        requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.reject()),
      };
      const childOwnHandler: ApprovalHandler = {
        requestApproval: vi.fn().mockResolvedValue(ApprovalResponse.approve()),
      };
      const childTool = approvalTool('child_tool');
      const childRunner = childRunnerWithTool(childTool);
      childRunner.approvalHandler = childOwnHandler;

      const tool = createAgentTool(childRunner, childAgent, {
        name: 'sub',
        description: 'sub',
        parameters: {},
        buildInput: () => 'go',
      });

      await tool.call({}, { approvalHandler: inheritedHandler });

      expect(childOwnHandler.requestApproval).toHaveBeenCalledTimes(1);
      expect(inheritedHandler.requestApproval).not.toHaveBeenCalled();
      expect(childTool.call).toHaveBeenCalledTimes(1);
    });

    it('runs the child ungated when neither ctx.approvalHandler nor a child runner default is set', async () => {
      const childTool = approvalTool('child_tool');
      const childRunner = childRunnerWithTool(childTool);

      const tool = createAgentTool(childRunner, childAgent, {
        name: 'sub',
        description: 'sub',
        parameters: {},
        buildInput: () => 'go',
      });

      await tool.call({}, {});

      expect(childTool.call).toHaveBeenCalledTimes(1);
    });
  });

  it('passes the result of buildInput as the child input', async () => {
    let capturedUserMessage: unknown;
    const generateStream = vi.fn((request: AdapterRequest) => {
      // Capture immediately — the runner mutates the messages array in place
      // by appending the assistant turn after the stream completes.
      capturedUserMessage = request.messages[request.messages.length - 1];
      return (async function* () {
        yield { type: 'text_delta', delta: 'ok' } as AdapterStreamChunk;
      })();
    });
    const runner = new AgentRunner({ generate: vi.fn(), generateStream });

    const tool = createAgentTool(runner, childAgent, {
      name: 'sub',
      description: 'sub',
      parameters: {},
      buildInput: (args) => `built:${(args as { q: string }).q}`,
    });

    await tool.call({ q: 'hi' }, {});

    expect(capturedUserMessage).toEqual({
      role: 'user',
      content: { type: 'text', text: 'built:hi' },
    });
  });
});
