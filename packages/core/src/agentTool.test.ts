// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { createAgentTool } from './agentTool';
import { AgentRunner } from './runner';
import { AgentError } from './error';
import type { LlmAdapter, AdapterRequest, AdapterStreamChunk } from './adapter/index';
import type { AgentConfig, AgentEvent } from './types';
import type { ToolContext } from './tool';

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
