// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIResponsesAdapter } from './OpenAIResponsesAdapter.js';

vi.mock('openai', () => {
  const create = vi.fn().mockResolvedValue({
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hello from Responses!' }],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });

  return {
    default: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.responses = { create };
    }),
  };
});

type MockClient = { responses: { create: ReturnType<typeof vi.fn> } };

async function getMockClient(): Promise<MockClient> {
  const OpenAI = (await import('openai')).default as unknown as new () => MockClient;
  return new OpenAI();
}

describe('OpenAIResponsesAdapter', () => {
  let adapter: OpenAIResponsesAdapter;
  const mockUsageUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIResponsesAdapter('fake-api-key', 'gpt-5', mockUsageUpdate);
  });

  it('should generate text response', async () => {
    const response = await adapter.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
    });

    expect(response.text).toBe('Hello from Responses!');
    expect(mockUsageUpdate).toHaveBeenCalledWith({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it('should map function_call output items to AdapterResponse.toolCalls', async () => {
    const mockClient = await getMockClient();
    mockClient.responses.create.mockResolvedValueOnce({
      output: [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'testTool',
          arguments: '{"arg1":"val1"}',
        },
      ],
      usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 },
    });

    const response = await adapter.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Call tool' } }],
      tools: [{ name: 'testTool', description: 'desc', parameters: {}, scope: 'read' as const }],
    });

    expect(response.toolCalls).toEqual([
      { id: 'call_1', name: 'testTool', args: { arg1: 'val1' } },
    ]);
    expect(response.text).toBeUndefined();
  });

  it('should forward request.system as instructions and use store: false', async () => {
    const mockClient = await getMockClient();

    await adapter.generate({
      system: 'You are terse.',
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
    });

    const call = mockClient.responses.create.mock.calls.at(-1)?.[0];
    expect(call.instructions).toBe('You are terse.');
    expect(call.store).toBe(false);
  });

  it('should map ToolDefinitions to flat FunctionTool entries', async () => {
    const mockClient = await getMockClient();

    await adapter.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [
        {
          name: 'lookup',
          description: 'Looks something up',
          parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
          scope: 'read' as const,
        },
      ],
    });

    const call = mockClient.responses.create.mock.calls.at(-1)?.[0];
    expect(call.tools).toEqual([
      {
        type: 'function',
        name: 'lookup',
        description: 'Looks something up',
        parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        strict: false,
      },
    ]);
  });

  it('should map tool_calls and tool_result history into the input array', async () => {
    const mockClient = await getMockClient();

    await adapter.generate({
      messages: [
        { role: 'user', content: { type: 'text', text: 'Compute 2+2' } },
        {
          role: 'assistant',
          content: {
            type: 'tool_calls',
            calls: [{ id: 'call_a', name: 'calc', args: { expr: '2+2' } }],
          },
        },
        {
          role: 'user',
          content: { type: 'tool_result', id: 'call_a', name: 'calc', result: { value: 4 } },
        },
      ],
      tools: [{ name: 'calc', description: 'd', parameters: {}, scope: 'read' as const }],
    });

    const call = mockClient.responses.create.mock.calls.at(-1)?.[0];
    expect(call.input).toEqual([
      { type: 'message', role: 'user', content: 'Compute 2+2' },
      {
        type: 'function_call',
        call_id: 'call_a',
        name: 'calc',
        arguments: '{"expr":"2+2"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_a',
        output: '{"value":4}',
      },
    ]);
  });

  it('should default reasoning.summary to "auto"', async () => {
    const mockClient = await getMockClient();

    await adapter.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
    });

    const call = mockClient.responses.create.mock.calls.at(-1)?.[0];
    expect(call.reasoning).toEqual({ summary: 'auto' });
  });

  it('should disable reasoning summary when defaults.reasoningSummary is false', async () => {
    const mockClient = await getMockClient();

    const off = new OpenAIResponsesAdapter('fake-api-key', 'gpt-5', undefined, {
      reasoningSummary: false,
    });
    await off.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
    });

    const call = mockClient.responses.create.mock.calls.at(-1)?.[0];
    expect(call.reasoning).toBeUndefined();
  });

  it('should forward defaults.reasoningEffort and override with config.reasoning_effort', async () => {
    const mockClient = await getMockClient();

    const adapterWithDefaults = new OpenAIResponsesAdapter('fake-api-key', 'gpt-5', undefined, {
      reasoningEffort: 'high',
    });
    await adapterWithDefaults.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
    });

    let call = mockClient.responses.create.mock.calls.at(-1)?.[0];
    expect(call.reasoning).toEqual({ effort: 'high', summary: 'auto' });

    await adapterWithDefaults.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
      config: { reasoning_effort: 'low' },
    });

    call = mockClient.responses.create.mock.calls.at(-1)?.[0];
    expect(call.reasoning).toEqual({ effort: 'low', summary: 'auto' });
  });

  it('should forward outputSchema as a json_schema text format', async () => {
    const mockClient = await getMockClient();

    await adapter.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
      outputSchema: { type: 'object', properties: { answer: { type: 'string' } } },
    });

    const call = mockClient.responses.create.mock.calls.at(-1)?.[0];
    expect(call.text).toEqual({
      format: {
        type: 'json_schema',
        name: 'output',
        schema: { type: 'object', properties: { answer: { type: 'string' } } },
        strict: true,
      },
    });
  });

  it('should map ModelConfig to OpenAI Responses request fields', async () => {
    const mockClient = await getMockClient();

    await adapter.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
      config: { temperature: 0.4, maxTokens: 1000, topP: 0.9 },
    });

    const call = mockClient.responses.create.mock.calls.at(-1)?.[0];
    expect(call.temperature).toBe(0.4);
    expect(call.max_output_tokens).toBe(1000);
    expect(call.top_p).toBe(0.9);
  });

  describe('generateStream', () => {
    async function collectChunks(request: Parameters<OpenAIResponsesAdapter['generateStream']>[0]) {
      const chunks: { type: string; delta?: string; toolCall?: unknown }[] = [];
      for await (const chunk of adapter.generateStream(request)) {
        chunks.push(chunk as never);
      }
      return chunks;
    }

    it('should yield thinking chunks for reasoning summary deltas', async () => {
      const mockClient = await getMockClient();
      mockClient.responses.create.mockResolvedValueOnce(
        (async function* () {
          yield {
            type: 'response.reasoning_summary_text.delta',
            delta: 'Considering the question...',
          };
          yield { type: 'response.output_text.delta', delta: 'Done.' };
          yield {
            type: 'response.completed',
            response: { usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } },
          };
        })(),
      );

      const chunks = await collectChunks({
        messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
        tools: [],
      });

      expect(chunks).toEqual([
        { type: 'thinking', delta: 'Considering the question...' },
        { type: 'text_delta', delta: 'Done.' },
      ]);
      expect(mockUsageUpdate).toHaveBeenCalledWith({
        promptTokens: 3,
        completionTokens: 2,
        totalTokens: 5,
      });
    });

    it('should also map response.reasoning_text.delta to thinking events', async () => {
      const mockClient = await getMockClient();
      mockClient.responses.create.mockResolvedValueOnce(
        (async function* () {
          yield { type: 'response.reasoning_text.delta', delta: 'inner monologue' };
        })(),
      );

      const chunks = await collectChunks({
        messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
        tools: [],
      });

      expect(chunks).toEqual([{ type: 'thinking', delta: 'inner monologue' }]);
    });

    it('should yield tool_call chunks when an output_item.done event carries a function_call', async () => {
      const mockClient = await getMockClient();
      mockClient.responses.create.mockResolvedValueOnce(
        (async function* () {
          yield {
            type: 'response.output_item.done',
            item: {
              type: 'function_call',
              call_id: 'call_1',
              name: 'lookup',
              arguments: '{"q":"mast"}',
            },
          };
        })(),
      );

      const chunks = await collectChunks({
        messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
        tools: [{ name: 'lookup', description: 'd', parameters: {}, scope: 'read' as const }],
      });

      expect(chunks).toEqual([
        {
          type: 'tool_call',
          toolCall: { id: 'call_1', name: 'lookup', args: { q: 'mast' } },
        },
      ]);
    });

    it('should ignore non-function_call output items', async () => {
      const mockClient = await getMockClient();
      mockClient.responses.create.mockResolvedValueOnce(
        (async function* () {
          yield {
            type: 'response.output_item.done',
            item: { type: 'reasoning', id: 'r1', summary: [] },
          };
          yield { type: 'response.output_text.delta', delta: 'ok' };
        })(),
      );

      const chunks = await collectChunks({
        messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
        tools: [],
      });

      expect(chunks).toEqual([{ type: 'text_delta', delta: 'ok' }]);
    });

    it('should request streaming mode in the SDK call', async () => {
      const mockClient = await getMockClient();
      mockClient.responses.create.mockResolvedValueOnce(
        (async function* () {
          yield { type: 'response.output_text.delta', delta: 'ok' };
        })(),
      );

      for await (const _chunk of adapter.generateStream({
        messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
        tools: [],
      })) {
        void _chunk;
      }

      const call = mockClient.responses.create.mock.calls.at(-1)?.[0];
      expect(call.stream).toBe(true);
    });
  });
});
