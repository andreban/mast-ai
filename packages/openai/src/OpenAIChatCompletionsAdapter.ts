// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import OpenAI from 'openai';
import type {
  ChatCompletionTool,
  ChatCompletionMessageParam,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import type {
  LlmAdapter,
  AdapterRequest,
  AdapterResponse,
  AdapterStreamChunk,
  Message,
  ToolDefinition,
} from '@mast-ai/core';

/** Token-usage statistics reported by the OpenAI Chat Completions API. */
export interface UsageMetadata {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** Reasoning-effort level for o-series and gpt-5 models. */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

/** Per-request defaults applied to every call made by an {@link OpenAIChatCompletionsAdapter}. */
export interface OpenAIChatCompletionsAdapterDefaults {
  /**
   * Forwarded as `reasoning_effort` on every request. Reasoning models honour
   * this; non-reasoning models reject the field, so set it only when the
   * configured `modelName` is a reasoning model.
   */
  reasoningEffort?: ReasoningEffort;
}

type ReasoningDelta = {
  reasoning_content?: string | null;
  reasoning?: string | null;
};

/**
 * {@link LlmAdapter} implementation backed by the OpenAI Chat Completions API.
 *
 * Supports tool calling, structured output via JSON Schema, and streaming.
 * Reasoning models (o-series, gpt-5, ...) work out of the box: pass
 * `reasoning_effort` through `ModelConfig` and any reasoning content the model
 * exposes via `delta.reasoning_content` (used by OpenAI-compatible providers
 * such as OpenRouter and DeepSeek) is forwarded as `thinking` events.
 *
 * To surface reasoning content from native OpenAI reasoning models, use
 * {@link OpenAIResponsesAdapter} instead — Chat Completions does not return
 * reasoning tokens for OpenAI's own models.
 */
export class OpenAIChatCompletionsAdapter implements LlmAdapter {
  private client: OpenAI;
  private modelName: string;
  private onUsageUpdate?: (usage: UsageMetadata) => void;
  private defaults: OpenAIChatCompletionsAdapterDefaults;

  /**
   * @param apiKey - OpenAI API key.
   * @param modelName - Model identifier (defaults to `"gpt-4o-mini"`). Any
   *   chat-completion-compatible model works, including reasoning models.
   * @param onUsageUpdate - Optional callback invoked with token-usage data after each response.
   * @param defaults - Provider-specific defaults applied to every request
   *   (e.g. `reasoningEffort` for o-series / gpt-5).
   */
  constructor(
    apiKey: string,
    modelName: string = 'gpt-4o-mini',
    onUsageUpdate?: (usage: UsageMetadata) => void,
    defaults?: OpenAIChatCompletionsAdapterDefaults,
  ) {
    this.client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
    this.modelName = modelName;
    this.onUsageUpdate = onUsageUpdate;
    this.defaults = defaults ?? {};
  }

  private buildTools(request: AdapterRequest): ChatCompletionTool[] | undefined {
    if (request.tools.length === 0) return undefined;
    return request.tools.map((t) => this.mapTool(t));
  }

  private buildBaseParams(
    request: AdapterRequest,
  ): Omit<ChatCompletionCreateParamsNonStreaming, 'stream'> {
    const messages = this.mapMessages(request);
    const tools = this.buildTools(request);
    const config = (request.config ?? {}) as Record<string, unknown>;

    const reasoningEffort =
      (typeof config.reasoning_effort === 'string'
        ? (config.reasoning_effort as ReasoningEffort)
        : undefined) ?? this.defaults.reasoningEffort;

    const params: Omit<ChatCompletionCreateParamsNonStreaming, 'stream'> = {
      model: this.modelName,
      messages,
      ...(tools ? { tools } : {}),
      ...(typeof config.temperature === 'number' ? { temperature: config.temperature } : {}),
      ...(typeof config.maxTokens === 'number' ? { max_completion_tokens: config.maxTokens } : {}),
      ...(typeof config.topP === 'number' ? { top_p: config.topP } : {}),
      ...(Array.isArray(config.stopSequences) ? { stop: config.stopSequences as string[] } : {}),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(request.outputSchema
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'output',
                schema: request.outputSchema,
                strict: true,
              },
            },
          }
        : {}),
    };

    return params;
  }

  /** {@inheritDoc LlmAdapter.generate} */
  async generate(request: AdapterRequest): Promise<AdapterResponse> {
    const params: ChatCompletionCreateParamsNonStreaming = {
      ...this.buildBaseParams(request),
      stream: false,
    };

    const response = await this.client.chat.completions.create(params, { signal: request.signal });

    if (response.usage && this.onUsageUpdate) {
      this.onUsageUpdate({
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      });
    }

    const choice = response.choices?.[0];
    if (!choice) {
      throw new Error('No choice returned from OpenAI');
    }

    const message = choice.message;
    return {
      text:
        typeof message.content === 'string' && message.content.length > 0
          ? message.content
          : undefined,
      toolCalls: (message.tool_calls ?? []).flatMap((tc) =>
        tc.type === 'function'
          ? [
              {
                id: tc.id,
                name: tc.function.name,
                args: parseArguments(tc.function.arguments),
              },
            ]
          : [],
      ),
    };
  }

  /** {@inheritDoc LlmAdapter.generateStream} */
  async *generateStream(request: AdapterRequest): AsyncIterable<AdapterStreamChunk> {
    const params: ChatCompletionCreateParamsStreaming = {
      ...this.buildBaseParams(request),
      stream: true,
      stream_options: { include_usage: true },
    };

    const stream = await this.client.chat.completions.create(params, { signal: request.signal });

    const accumulators = new Map<number, { id?: string; name?: string; args: string }>();

    for await (const chunk of stream) {
      if (chunk.usage && this.onUsageUpdate) {
        this.onUsageUpdate({
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        });
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta as typeof choice.delta & ReasoningDelta;

      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === 'string' && reasoning.length > 0) {
        yield { type: 'thinking', delta: reasoning };
      }

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        yield { type: 'text_delta', delta: delta.content };
      }

      if (delta.tool_calls) {
        for (const tcDelta of delta.tool_calls) {
          if (tcDelta.type !== undefined && tcDelta.type !== 'function') continue;
          const idx = tcDelta.index;
          let acc = accumulators.get(idx);
          if (!acc) {
            acc = { args: '' };
            accumulators.set(idx, acc);
          }
          if (tcDelta.id) acc.id = tcDelta.id;
          if (tcDelta.function?.name) acc.name = tcDelta.function.name;
          if (tcDelta.function?.arguments) acc.args += tcDelta.function.arguments;
        }
      }

      if (choice.finish_reason === 'tool_calls') {
        const indices = [...accumulators.keys()].sort((a, b) => a - b);
        for (const idx of indices) {
          const acc = accumulators.get(idx)!;
          if (!acc.name) continue;
          yield {
            type: 'tool_call',
            toolCall: {
              id: acc.id ?? crypto.randomUUID(),
              name: acc.name,
              args: parseArguments(acc.args),
            },
          };
        }
        accumulators.clear();
      }
    }
  }

  private mapMessages(request: AdapterRequest): ChatCompletionMessageParam[] {
    const result: ChatCompletionMessageParam[] = [];
    if (request.system) {
      result.push({ role: 'system', content: request.system });
    }
    for (const message of request.messages) {
      const mapped = mapMessage(message);
      if (mapped.length > 0) result.push(...mapped);
    }
    return result;
  }

  private mapTool(tool: ToolDefinition): ChatCompletionTool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }
}

function mapMessage(message: Message): ChatCompletionMessageParam[] {
  if (message.content.type === 'text') {
    return [{ role: message.role, content: message.content.text }];
  }
  if (message.content.type === 'tool_calls') {
    return [
      {
        role: 'assistant',
        content: null,
        tool_calls: message.content.calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: typeof call.args === 'string' ? call.args : JSON.stringify(call.args ?? {}),
          },
        })),
      },
    ];
  }
  // tool_result -> { role: 'tool', tool_call_id, content }
  return [
    {
      role: 'tool',
      tool_call_id: message.content.id,
      content:
        typeof message.content.result === 'string'
          ? message.content.result
          : JSON.stringify(message.content.result),
    },
  ];
}

function parseArguments(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
