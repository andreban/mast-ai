// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIChatCompletionsAdapter } from './OpenAIChatCompletionsAdapter.js';

vi.mock('openai', () => {
  const create = vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'Hello from OpenAI!',
          tool_calls: [],
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
  });

  return {
    default: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.chat = { completions: { create } };
    }),
  };
});

type MockClient = { chat: { completions: { create: ReturnType<typeof vi.fn> } } };

async function getMockClient(): Promise<MockClient> {
  const OpenAI = (await import('openai')).default as unknown as new () => MockClient;
  return new OpenAI();
}

describe('OpenAIChatCompletionsAdapter', () => {
  let adapter: OpenAIChatCompletionsAdapter;
  const mockUsageUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIChatCompletionsAdapter('fake-api-key', 'gpt-4o-mini', mockUsageUpdate);
  });

  it('should generate text response', async () => {
    const response = await adapter.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
    });

    expect(response.text).toBe('Hello from OpenAI!');
    expect(mockUsageUpdate).toHaveBeenCalledWith({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it('should handle tool calls', async () => {
    const mockClient = await getMockClient();
    mockClient.chat.completions.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'testTool', arguments: '{"arg1":"val1"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    });

    const response = await adapter.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Call tool' } }],
      tools: [{ name: 'testTool', description: 'desc', parameters: {}, scope: 'read' as const }],
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]).toEqual({
      id: 'call_1',
      name: 'testTool',
      args: { arg1: 'val1' },
    });
    expect(response.text).toBeUndefined();
  });

  it('should forward a system instruction when provided', async () => {
    const mockClient = await getMockClient();

    await adapter.generate({
      system: 'You are terse.',
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
    });

    const call = mockClient.chat.completions.create.mock.calls.at(-1)?.[0];
    expect(call.messages[0]).toEqual({ role: 'system', content: 'You are terse.' });
    expect(call.messages[1]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('should omit the system instruction when not provided', async () => {
    const mockClient = await getMockClient();

    await adapter.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
    });

    const call = mockClient.chat.completions.create.mock.calls.at(-1)?.[0];
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('should map tool_calls and tool_result messages back to OpenAI format', async () => {
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

    const call = mockClient.chat.completions.create.mock.calls.at(-1)?.[0];
    expect(call.messages[1]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_a',
          type: 'function',
          function: { name: 'calc', arguments: '{"expr":"2+2"}' },
        },
      ],
    });
    expect(call.messages[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call_a',
      content: '{"value":4}',
    });
  });

  it('should map ToolDefinitions to OpenAI function tools', async () => {
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

    const call = mockClient.chat.completions.create.mock.calls.at(-1)?.[0];
    expect(call.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Looks something up',
          parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        },
      },
    ]);
  });

  it('should leave tools undefined when no tools are provided', async () => {
    const mockClient = await getMockClient();

    await adapter.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
    });

    const call = mockClient.chat.completions.create.mock.calls.at(-1)?.[0];
    expect(call.tools).toBeUndefined();
  });

  it('should forward outputSchema as a json_schema response_format', async () => {
    const mockClient = await getMockClient();

    await adapter.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
      outputSchema: {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
      },
    });

    const call = mockClient.chat.completions.create.mock.calls.at(-1)?.[0];
    expect(call.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'output',
        schema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
        },
        strict: true,
      },
    });
  });

  it('should forward reasoning_effort from ModelConfig', async () => {
    const mockClient = await getMockClient();

    await adapter.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
      config: { reasoning_effort: 'medium' },
    });

    const call = mockClient.chat.completions.create.mock.calls.at(-1)?.[0];
    expect(call.reasoning_effort).toBe('medium');
  });

  it('should apply defaults.reasoningEffort to every request', async () => {
    const mockClient = await getMockClient();

    const reasoningAdapter = new OpenAIChatCompletionsAdapter('fake-api-key', 'gpt-5', undefined, {
      reasoningEffort: 'high',
    });
    await reasoningAdapter.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
    });

    const call = mockClient.chat.completions.create.mock.calls.at(-1)?.[0];
    expect(call.reasoning_effort).toBe('high');
  });

  it('should let request.config.reasoning_effort override defaults.reasoningEffort', async () => {
    const mockClient = await getMockClient();

    const reasoningAdapter = new OpenAIChatCompletionsAdapter('fake-api-key', 'gpt-5', undefined, {
      reasoningEffort: 'high',
    });
    await reasoningAdapter.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
      config: { reasoning_effort: 'low' },
    });

    const call = mockClient.chat.completions.create.mock.calls.at(-1)?.[0];
    expect(call.reasoning_effort).toBe('low');
  });

  it('should map ModelConfig to OpenAI request fields', async () => {
    const mockClient = await getMockClient();

    await adapter.generate({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      tools: [],
      config: {
        temperature: 0.4,
        maxTokens: 1000,
        topP: 0.9,
        stopSequences: ['STOP'],
      },
    });

    const call = mockClient.chat.completions.create.mock.calls.at(-1)?.[0];
    expect(call.temperature).toBe(0.4);
    expect(call.max_completion_tokens).toBe(1000);
    expect(call.top_p).toBe(0.9);
    expect(call.stop).toEqual(['STOP']);
  });

  it('should throw when no choice is returned from generate', async () => {
    const mockClient = await getMockClient();
    mockClient.chat.completions.create.mockResolvedValueOnce({
      choices: [],
      usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
    });

    await expect(
      adapter.generate({
        messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
        tools: [],
      }),
    ).rejects.toThrow('No choice returned from OpenAI');
  });

  describe('generateStream', () => {
    async function collectChunks(
      request: Parameters<OpenAIChatCompletionsAdapter['generateStream']>[0],
    ) {
      const chunks: { type: string; delta?: string; toolCall?: unknown }[] = [];
      for await (const chunk of adapter.generateStream(request)) {
        chunks.push(chunk as never);
      }
      return chunks;
    }

    it('should yield text_delta chunks for streamed content', async () => {
      const mockClient = await getMockClient();
      mockClient.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield {
            choices: [{ delta: { content: 'Hello ' }, finish_reason: null, index: 0 }],
          };
          yield {
            choices: [{ delta: { content: 'world' }, finish_reason: null, index: 0 }],
          };
          yield {
            choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
            usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
          };
        })(),
      );

      const chunks = await collectChunks({
        messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
        tools: [],
      });

      expect(chunks).toEqual([
        { type: 'text_delta', delta: 'Hello ' },
        { type: 'text_delta', delta: 'world' },
      ]);
      expect(mockUsageUpdate).toHaveBeenCalledWith({
        promptTokens: 3,
        completionTokens: 2,
        totalTokens: 5,
      });
    });

    it('should yield thinking chunks for delta.reasoning_content', async () => {
      const mockClient = await getMockClient();
      mockClient.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield {
            choices: [
              { delta: { reasoning_content: 'Considering...' }, finish_reason: null, index: 0 },
            ],
          };
          yield {
            choices: [{ delta: { content: 'Done.' }, finish_reason: null, index: 0 }],
          };
          yield {
            choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
          };
        })(),
      );

      const chunks = await collectChunks({
        messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
        tools: [],
      });

      expect(chunks).toEqual([
        { type: 'thinking', delta: 'Considering...' },
        { type: 'text_delta', delta: 'Done.' },
      ]);
    });

    it('should also map delta.reasoning to thinking events', async () => {
      const mockClient = await getMockClient();
      mockClient.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield {
            choices: [{ delta: { reasoning: 'hmm...' }, finish_reason: null, index: 0 }],
          };
          yield {
            choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
          };
        })(),
      );

      const chunks = await collectChunks({
        messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
        tools: [],
      });

      expect(chunks).toEqual([{ type: 'thinking', delta: 'hmm...' }]);
    });

    it('should accumulate streamed tool call fragments and emit one tool_call chunk', async () => {
      const mockClient = await getMockClient();
      mockClient.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'lookup', arguments: '{"q":"' },
                    },
                  ],
                },
                finish_reason: null,
                index: 0,
              },
            ],
          };
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: 'mast' } }],
                },
                finish_reason: null,
                index: 0,
              },
            ],
          };
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: '"}' } }],
                },
                finish_reason: null,
                index: 0,
              },
            ],
          };
          yield {
            choices: [{ delta: {}, finish_reason: 'tool_calls', index: 0 }],
          };
        })(),
      );

      const chunks = await collectChunks({
        messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
        tools: [{ name: 'lookup', description: 'd', parameters: {}, scope: 'read' as const }],
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({
        type: 'tool_call',
        toolCall: { id: 'call_1', name: 'lookup', args: { q: 'mast' } },
      });
    });

    it('should emit multiple tool calls in index order', async () => {
      const mockClient = await getMockClient();
      mockClient.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 1,
                      id: 'call_b',
                      type: 'function',
                      function: { name: 'second', arguments: '{}' },
                    },
                    {
                      index: 0,
                      id: 'call_a',
                      type: 'function',
                      function: { name: 'first', arguments: '{}' },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
                index: 0,
              },
            ],
          };
        })(),
      );

      const chunks = await collectChunks({
        messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
        tools: [
          { name: 'first', description: 'd', parameters: {}, scope: 'read' as const },
          { name: 'second', description: 'd', parameters: {}, scope: 'read' as const },
        ],
      });

      expect(chunks).toHaveLength(2);
      expect((chunks[0] as { toolCall: { name: string } }).toolCall.name).toBe('first');
      expect((chunks[1] as { toolCall: { name: string } }).toolCall.name).toBe('second');
    });

    it('should request usage in the streaming request', async () => {
      const mockClient = await getMockClient();
      mockClient.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop', index: 0 }] };
        })(),
      );

      for await (const _chunk of adapter.generateStream({
        messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
        tools: [],
      })) {
        void _chunk;
      }

      const call = mockClient.chat.completions.create.mock.calls.at(-1)?.[0];
      expect(call.stream).toBe(true);
      expect(call.stream_options).toEqual({ include_usage: true });
    });

    it('should skip chunks with no choices', async () => {
      const mockClient = await getMockClient();
      mockClient.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [] };
          yield {
            choices: [{ delta: { content: 'hello' }, finish_reason: 'stop', index: 0 }],
          };
        })(),
      );

      const chunks = await collectChunks({
        messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
        tools: [],
      });

      expect(chunks).toEqual([{ type: 'text_delta', delta: 'hello' }]);
    });
  });
});
