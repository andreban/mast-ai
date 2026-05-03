// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from './runner.js';
import { AgentError } from './error.js';
import type { LlmAdapter, AdapterRequest, AdapterStreamChunk } from './adapter/index.js';
import type { AgentConfig, AgentEvent } from './types.js';
import type { ToolContext } from './tool.js';

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
