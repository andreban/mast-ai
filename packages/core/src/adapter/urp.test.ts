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
            id: 'call_1',
            name: 'search',
            result: 'ok',
            provider_metadata: sentinel,
          },
        },
      ],
    });

    const sent = captured!.messages[0];
    expect(sent.content.type).toBe('tool_result');
    expect((sent.content as { provider_metadata?: unknown }).provider_metadata).toBe(sentinel);
  });
});
