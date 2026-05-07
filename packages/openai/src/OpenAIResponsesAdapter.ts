// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import OpenAI from 'openai';
import type {
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
  ResponseInputItem,
  ResponseOutputItem,
  FunctionTool,
  Tool as ResponseTool,
} from 'openai/resources/responses/responses';
import type {
  LlmAdapter,
  AdapterRequest,
  AdapterResponse,
  AdapterStreamChunk,
  Message,
  ToolDefinition,
} from '@mast-ai/core';
import type { ReasoningEffort, UsageMetadata } from './OpenAIChatCompletionsAdapter.js';

/** Reasoning-summary verbosity that gates what the model emits as `thinking` events. */
export type ReasoningSummary = 'auto' | 'concise' | 'detailed';

/** Per-request defaults applied to every call made by an {@link OpenAIResponsesAdapter}. */
export interface OpenAIResponsesAdapterDefaults {
  /** Forwarded as `reasoning.effort` on every request. Reasoning models honour this. */
  reasoningEffort?: ReasoningEffort;
  /**
   * Forwarded as `reasoning.summary` on every request. Required to receive
   * reasoning summary deltas as `thinking` events. Defaults to `"auto"` so
   * reasoning models surface thinking content without extra configuration.
   * Set to `false` to disable.
   */
  reasoningSummary?: ReasoningSummary | false;
}

/**
 * {@link LlmAdapter} implementation backed by the OpenAI Responses API
 * (`/v1/responses`).
 *
 * Unlike {@link OpenAIChatCompletionsAdapter}, this adapter surfaces reasoning
 * content from reasoning models — `gpt-5`, `o-series` — as `thinking` events.
 * The adapter runs statelessly (`store: false`); the caller's `Conversation`
 * history is replayed on every request.
 */
export class OpenAIResponsesAdapter implements LlmAdapter {
  private client: OpenAI;
  private modelName: string;
  private onUsageUpdate?: (usage: UsageMetadata) => void;
  private defaults: OpenAIResponsesAdapterDefaults;

  /**
   * @param apiKey - OpenAI API key.
   * @param modelName - Model identifier (defaults to `"gpt-4o-mini"`). Any
   *   Responses-API-compatible model works, including reasoning models.
   * @param onUsageUpdate - Optional callback invoked with token-usage data after each response.
   * @param defaults - Provider-specific defaults applied to every request.
   */
  constructor(
    apiKey: string,
    modelName: string = 'gpt-4o-mini',
    onUsageUpdate?: (usage: UsageMetadata) => void,
    defaults?: OpenAIResponsesAdapterDefaults,
  ) {
    this.client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
    this.modelName = modelName;
    this.onUsageUpdate = onUsageUpdate;
    this.defaults = defaults ?? {};
  }

  private buildBaseParams(
    request: AdapterRequest,
  ): Omit<ResponseCreateParamsNonStreaming, 'stream'> {
    const input = mapInput(request.messages);
    const tools = mapTools(request.tools);
    const config = (request.config ?? {}) as Record<string, unknown>;

    const reasoningEffort =
      (typeof config.reasoning_effort === 'string'
        ? (config.reasoning_effort as ReasoningEffort)
        : undefined) ?? this.defaults.reasoningEffort;

    const reasoningSummary =
      this.defaults.reasoningSummary === false
        ? undefined
        : (this.defaults.reasoningSummary ?? 'auto');

    const params: Omit<ResponseCreateParamsNonStreaming, 'stream'> = {
      model: this.modelName,
      input,
      ...(request.system ? { instructions: request.system } : {}),
      ...(tools ? { tools } : {}),
      store: false,
      ...(typeof config.temperature === 'number' ? { temperature: config.temperature } : {}),
      ...(typeof config.maxTokens === 'number' ? { max_output_tokens: config.maxTokens } : {}),
      ...(typeof config.topP === 'number' ? { top_p: config.topP } : {}),
      ...(reasoningEffort || reasoningSummary
        ? {
            reasoning: {
              ...(reasoningEffort ? { effort: reasoningEffort } : {}),
              ...(reasoningSummary ? { summary: reasoningSummary } : {}),
            },
          }
        : {}),
      ...(request.outputSchema
        ? {
            text: {
              format: {
                type: 'json_schema',
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
    const params: ResponseCreateParamsNonStreaming = {
      ...this.buildBaseParams(request),
      stream: false,
    };

    const response = await this.client.responses.create(params, { signal: request.signal });

    if (response.usage && this.onUsageUpdate) {
      this.onUsageUpdate({
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
      });
    }

    let text: string | undefined;
    const toolCalls: AdapterResponse['toolCalls'] = [];

    for (const item of response.output ?? []) {
      const parsed = parseOutputItem(item);
      if (parsed.text !== undefined) {
        text = (text ?? '') + parsed.text;
      }
      if (parsed.toolCall) {
        toolCalls.push(parsed.toolCall);
      }
    }

    return { text, toolCalls };
  }

  /** {@inheritDoc LlmAdapter.generateStream} */
  async *generateStream(request: AdapterRequest): AsyncIterable<AdapterStreamChunk> {
    const params: ResponseCreateParamsStreaming = {
      ...this.buildBaseParams(request),
      stream: true,
    };

    const stream = await this.client.responses.create(params, { signal: request.signal });

    for await (const event of stream) {
      switch (event.type) {
        case 'response.output_text.delta':
          if (event.delta) yield { type: 'text_delta', delta: event.delta };
          break;
        case 'response.reasoning_summary_text.delta':
        case 'response.reasoning_text.delta':
          if (event.delta) yield { type: 'thinking', delta: event.delta };
          break;
        case 'response.output_item.done':
          if (event.item.type === 'function_call') {
            yield {
              type: 'tool_call',
              toolCall: {
                id: event.item.call_id,
                name: event.item.name,
                args: parseArguments(event.item.arguments),
              },
            };
          }
          break;
        case 'response.completed':
          if (event.response.usage && this.onUsageUpdate) {
            this.onUsageUpdate({
              promptTokens: event.response.usage.input_tokens,
              completionTokens: event.response.usage.output_tokens,
              totalTokens: event.response.usage.total_tokens,
            });
          }
          break;
        default:
          break;
      }
    }
  }
}

function mapTools(tools: ToolDefinition[]): ResponseTool[] | undefined {
  if (tools.length === 0) return undefined;
  return tools.map(
    (t): FunctionTool => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      strict: false,
    }),
  );
}

function mapInput(messages: Message[]): ResponseInputItem[] {
  const items: ResponseInputItem[] = [];
  for (const message of messages) {
    if (message.content.type === 'text') {
      items.push({
        type: 'message',
        role: message.role,
        content: message.content.text,
      });
    } else if (message.content.type === 'tool_calls') {
      for (const call of message.content.calls) {
        items.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: typeof call.args === 'string' ? call.args : JSON.stringify(call.args ?? {}),
        });
      }
    } else {
      items.push({
        type: 'function_call_output',
        call_id: message.content.id,
        output:
          typeof message.content.result === 'string'
            ? message.content.result
            : JSON.stringify(message.content.result),
      });
    }
  }
  return items;
}

function parseOutputItem(item: ResponseOutputItem): {
  text?: string;
  toolCall?: AdapterResponse['toolCalls'][number];
} {
  if (item.type === 'message') {
    let text = '';
    for (const part of item.content) {
      if (part.type === 'output_text') text += part.text;
    }
    return text ? { text } : {};
  }
  if (item.type === 'function_call') {
    return {
      toolCall: {
        id: item.call_id,
        name: item.name,
        args: parseArguments(item.arguments),
      },
    };
  }
  return {};
}

function parseArguments(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
