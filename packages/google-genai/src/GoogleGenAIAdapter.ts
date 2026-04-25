// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { Content, FunctionDeclaration, Part, FunctionCall, Schema } from "@google/genai";
import type {
  LlmAdapter,
  AdapterRequest,
  AdapterResponse,
  AdapterStreamChunk,
  Message,
  ToolDefinition,
  ToolCall,
} from "@mast-ai/core";

/** Token-usage statistics reported by the Gemini API. */
export interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

/**
 * {@link LlmAdapter} implementation backed by the Google Gemini API via `@google/genai`.
 *
 * Supports tool calling, structured output, and streaming. Thinking mode is
 * enabled by default (`ThinkingLevel.HIGH`).
 */
export class GoogleGenAIAdapter implements LlmAdapter {
  private client: GoogleGenAI;
  private modelName: string;
  private onUsageUpdate?: (usage: UsageMetadata) => void;

  /**
   * @param apiKey - Google AI API key.
   * @param modelName - Gemini model identifier (defaults to `"gemini-3.1-flash-lite-preview"`).
   * @param onUsageUpdate - Optional callback invoked with token-usage data after each response.
   */
  constructor(
    apiKey: string,
    modelName: string = "gemini-3.1-flash-lite-preview",
    onUsageUpdate?: (usage: UsageMetadata) => void,
  ) {
    this.client = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
    this.onUsageUpdate = onUsageUpdate;
  }

  /** {@inheritDoc LlmAdapter.generate} */
  async generate(request: AdapterRequest): Promise<AdapterResponse> {
    const contents = this.mapMessages(request.messages);
    const systemInstruction = this.mapSystemInstruction(request.system);
    const tools =
      request.tools.length > 0
        ? [{ functionDeclarations: request.tools.map((t) => this.mapTool(t)) }]
        : undefined;

    const outputSchema = request.outputSchema;
    const response = await this.client.models.generateContent({
      model: this.modelName,
      contents,
      config: {
        systemInstruction,
        tools,
        temperature: request.config?.temperature,
        maxOutputTokens: request.config?.maxTokens,
        topP: request.config?.topP,
        stopSequences: request.config?.stopSequences,
        ...(outputSchema
          ? {
              responseMimeType: "application/json",
              responseSchema: outputSchema as Schema,
              thinkingConfig: { thinkingBudget: 0 },
            }
          : {
              thinkingConfig: {
                includeThoughts: true,
                thinkingLevel: ThinkingLevel.HIGH,
              },
            }),
      },
    });

    if (response.usageMetadata && this.onUsageUpdate) {
      this.onUsageUpdate({
        promptTokenCount: response.usageMetadata.promptTokenCount,
        candidatesTokenCount: response.usageMetadata.candidatesTokenCount,
        totalTokenCount:
          (response.usageMetadata.promptTokenCount ?? 0) +
          (response.usageMetadata.candidatesTokenCount ?? 0),
      });
    }

    const candidate = response.candidates?.[0];
    if (!candidate) {
      throw new Error("No candidate returned from Gemini");
    }

    const textPart = candidate.content?.parts?.find(
      (p) => "text" in p && typeof p.text === "string",
    );
    const toolCallParts =
      candidate.content?.parts?.filter(
        (p) => "functionCall" in p && p.functionCall,
      ) || [];

    return {
      text:
        textPart && "text" in textPart ? (textPart.text as string) : undefined,
      toolCalls: toolCallParts.map((p) => {
        const fc = p.functionCall as FunctionCall;
        return {
          id: fc.id || crypto.randomUUID(),
          name: fc.name!,
          args: fc.args,
          thoughtSignature: p.thoughtSignature,
        };
      }),
    };
  }

  /** {@inheritDoc LlmAdapter.generateStream} */
  async *generateStream(
    request: AdapterRequest,
  ): AsyncIterable<AdapterStreamChunk> {
    const contents = this.mapMessages(request.messages);
    const systemInstruction = this.mapSystemInstruction(request.system);
    const tools =
      request.tools.length > 0
        ? [{ functionDeclarations: request.tools.map((t) => this.mapTool(t)) }]
        : undefined;

    const responseStream = await this.client.models.generateContentStream({
      model: this.modelName,
      contents,
      config: {
        systemInstruction,
        tools,
        temperature: request.config?.temperature,
        maxOutputTokens: request.config?.maxTokens,
        topP: request.config?.topP,
        stopSequences: request.config?.stopSequences,
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: ThinkingLevel.HIGH,
        },
      },
    });

    for await (const chunk of responseStream) {
      if (chunk.usageMetadata && this.onUsageUpdate) {
        this.onUsageUpdate({
          promptTokenCount: chunk.usageMetadata.promptTokenCount,
          candidatesTokenCount: chunk.usageMetadata.candidatesTokenCount,
          totalTokenCount:
            (chunk.usageMetadata.promptTokenCount ?? 0) +
            (chunk.usageMetadata.candidatesTokenCount ?? 0),
        });
      }

      const candidate = chunk.candidates?.[0];
      if (!candidate) continue;

      for (const part of candidate.content?.parts || []) {
        if (part.thought && typeof part.text === "string") {
          yield { type: "thinking", delta: part.text };
        } else if ("text" in part && typeof part.text === "string") {
          yield { type: "text_delta", delta: part.text };
        } else if ("functionCall" in part && part.functionCall) {
          const fc = part.functionCall as FunctionCall;
          yield {
            type: "tool_call",
            toolCall: {
              id: fc.id || crypto.randomUUID(),
              name: fc.name!,
              args: fc.args,
              thoughtSignature: part.thoughtSignature,
            } as ToolCall & { thoughtSignature?: string },
          };
        }
      }
    }
  }

  private mapSystemInstruction(system?: string): Content | undefined {
    if (!system) return undefined;
    return { parts: [{ text: system }] };
  }

  private mapMessages(messages: Message[]): Content[] {
    return messages.map((m) => {
      const role = m.role === "assistant" ? "model" : "user";
      const parts: Part[] = [];

      if (m.content.type === "text") {
        parts.push({ text: m.content.text });
      } else if (m.content.type === "tool_calls") {
        m.content.calls.forEach((call) => {
          const callWithSignature = call as ToolCall & {
            thoughtSignature?: string;
          };
          const thoughtSignature = callWithSignature.thoughtSignature;
          parts.push({
            functionCall: {
              id: call.id,
              name: call.name,
              args: call.args as Record<string, unknown>,
            },
            ...(thoughtSignature ? { thoughtSignature } : {}),
          });
        });
      } else if (m.content.type === "tool_result") {
        parts.push({
          functionResponse: {
            id: m.content.id,
            name: m.content.name,
            response: { result: m.content.result },
          },
        });
      }

      return { role, parts };
    });
  }

  private mapTool(tool: ToolDefinition): FunctionDeclaration {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Schema,
    };
  }
}
