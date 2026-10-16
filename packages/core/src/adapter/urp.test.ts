// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { UrpAdapter } from './urp.js';
import type { UrpRequest, UrpResponse, UrpStreamChunk, UrpTransport } from './urp.js';
import type { AdapterRequest } from './index.js';

const baseRequest: AdapterRequest = {
  messages: [],
  tools: [],
};

describe('UrpAdapter provider_metadata round-trip', () => {
  it('exposes provider_metadata on tool calls returned by generate()', async () => {
    const sentinel = { thought_signature: 'abc' };
    const transport: UrpTransport = {
      send: async (): Promise<UrpResponse> => ({
        tool_calls: [
          {
            id: 'call_1',
            name: 'search',
            arguments: { q: 'hi' },
            provider_metadata: sentinel,
          },
        ],
      }),
    };

    const adapter = new UrpAdapter(transport);
    const response = await adapter.generate(baseRequest);

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].provider_metadata).toBe(sentinel);
  });

  it('exposes provider_metadata on tool calls returned by generateStream()', async () => {
    const sentinel = { thought_signature: 'xyz' };
    const transport: UrpTransport = {
      send: async () => ({ tool_calls: [] }),
      sendStream: (): AsyncIterable<UrpStreamChunk> =>
        (async function* () {
          yield {
            type: 'tool_call',
            tool_call: {
              id: 'call_1',
              name: 'search',
              arguments: { q: 'hi' },
              provider_metadata: sentinel,
            },
          };
        })(),
    };

    const adapter = new UrpAdapter(transport);
    const chunks = [];
    for await (const chunk of adapter.generateStream(baseRequest)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: 'tool_call',
      toolCall: { provider_metadata: sentinel },
    });
  });

  it('serialises outgoing tool_calls messages as UrpToolCall (arguments) over the wire', async () => {
    let captured: UrpRequest | undefined;
    const transport: UrpTransport = {
      send: async (req): Promise<UrpResponse> => {
        captured = req;
        return { tool_calls: [] };
      },
    };

    const sentinel = { thought_signature: 'replay' };
    const args = { q: 'hi' };
    const adapter = new UrpAdapter(transport);
    await adapter.generate({
      ...baseRequest,
      messages: [
        { role: 'user', content: { type: 'text', content: 'search for hi' } },
        {
          role: 'assistant',
          content: {
            type: 'tool_calls',
            content: [
              { id: 'call_1', name: 'search', args, provider_metadata: sentinel },
              { id: 'call_2', name: 'search', args: { q: 'bye' } },
            ],
          },
        },
      ],
    });

    expect(captured!.messages[0]).toEqual({
      role: 'user',
      content: { type: 'text', content: 'search for hi' },
    });
    expect(captured!.messages[1]).toEqual({
      role: 'assistant',
      content: {
        type: 'tool_calls',
        content: [
          { id: 'call_1', name: 'search', arguments: args, provider_metadata: sentinel },
          { id: 'call_2', name: 'search', arguments: { q: 'bye' } },
        ],
      },
    });
    expect(JSON.stringify(captured)).not.toContain('"args"');
  });

  it('emits an empty object for tool calls whose args are undefined', async () => {
    let captured: UrpRequest | undefined;
    const transport: UrpTransport = {
      send: async (req): Promise<UrpResponse> => {
        captured = req;
        return { tool_calls: [] };
      },
    };

    const adapter = new UrpAdapter(transport);
    await adapter.generate({
      ...baseRequest,
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'tool_calls',
            content: [{ id: 'call_1', name: 'get_time', args: undefined }],
          },
        },
      ],
    });

    expect(captured!.messages[0].content).toEqual({
      type: 'tool_calls',
      content: [{ id: 'call_1', name: 'get_time', arguments: {} }],
    });
    expect(JSON.stringify(captured)).toContain('"arguments":{}');
  });

  it('keeps tool_calls mapping when a system prompt is injected', async () => {
    let captured: UrpRequest | undefined;
    const transport: UrpTransport = {
      send: async (req): Promise<UrpResponse> => {
        captured = req;
        return { tool_calls: [] };
      },
    };

    const adapter = new UrpAdapter(transport);
    await adapter.generate({
      ...baseRequest,
      system: 'be helpful',
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'tool_calls',
            content: [{ id: 'call_1', name: 'search', args: { q: 'hi' } }],
          },
        },
      ],
    });

    expect(captured!.messages).toHaveLength(2);
    expect(captured!.messages[0]).toEqual({
      role: 'user',
      content: { type: 'text', content: 'be helpful' },
    });
    expect(captured!.messages[1].content).toEqual({
      type: 'tool_calls',
      content: [{ id: 'call_1', name: 'search', arguments: { q: 'hi' } }],
    });
  });

  it('forwards provider_metadata from outgoing tool_result messages over the wire', async () => {
    let captured: UrpRequest | undefined;
    const transport: UrpTransport = {
      send: async (req): Promise<UrpResponse> => {
        captured = req;
        return { tool_calls: [] };
      },
    };

    const sentinel = { thought_signature: 'replay' };
    const adapter = new UrpAdapter(transport);
    await adapter.generate({
      ...baseRequest,
      messages: [
        {
          role: 'user',
          content: {
            type: 'tool_result',
            content: {
              tool_call: {
                id: 'call_1',
                name: 'search',
                args: { q: 'hi' },
                provider_metadata: sentinel,
              },
              result: 'ok',
            },
          },
        },
      ],
    });

    expect(captured!.messages[0].content).toEqual({
      type: 'tool_result',
      content: {
        tool_call: {
          id: 'call_1',
          name: 'search',
          arguments: { q: 'hi' },
          provider_metadata: sentinel,
        },
        result: 'ok',
      },
    });
    expect(JSON.stringify(captured)).not.toContain('"args"');
  });

  it('forwards message-level provider_metadata over the wire', async () => {
    let captured: UrpRequest | undefined;
    const transport: UrpTransport = {
      send: async (req): Promise<UrpResponse> => {
        captured = req;
        return { tool_calls: [] };
      },
    };

    const sentinel = { deepseek: { reasoning_content: 'because' } };
    const adapter = new UrpAdapter(transport);
    await adapter.generate({
      ...baseRequest,
      messages: [
        { role: 'user', content: { type: 'text', content: 'hi' } },
        {
          role: 'assistant',
          content: { type: 'text', content: 'hello' },
          provider_metadata: sentinel,
        },
      ],
    });

    expect(captured!.messages[0]).not.toHaveProperty('provider_metadata');
    expect(captured!.messages[1]).toEqual({
      role: 'assistant',
      content: { type: 'text', content: 'hello' },
      provider_metadata: sentinel,
    });
  });
});
