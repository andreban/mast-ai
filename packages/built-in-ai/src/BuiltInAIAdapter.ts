// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { AdapterError } from "@mast-ai/core";
import type {
  LlmAdapter,
  AdapterRequest,
  AdapterResponse,
  AdapterStreamChunk,
  Message,
} from "@mast-ai/core";
import type { LanguageModelSession, LanguageModelMessage } from "./types.js";

export interface BuiltInAIAdapterOptions {
  onDownloadProgress?: (progress: { loaded: number; total: number }) => void;
}

/**
 * LlmAdapter backed by the browser's Prompt API (on-device model).
 *
 * Limitation: tool calling is not supported. The Prompt API has no native
 * mechanism for structured tool invocation — `toolCalls` will always be `[]`.
 */
export class BuiltInAIAdapter implements LlmAdapter {
  private readonly options: BuiltInAIAdapterOptions;
  private cachedSession: LanguageModelSession | null = null;
  private cachedHistory: Message[] = [];

  constructor(options: BuiltInAIAdapterOptions = {}) {
    this.options = options;
  }

  async generate(request: AdapterRequest): Promise<AdapterResponse> {
    if (request.tools.length > 0) {
      console.warn(
        "BuiltInAIAdapter: tool calling is not supported — tools will never be invoked.",
      );
    }

    const { session, lastMessage } = await this.acquireSession(request);
    try {
      const input = messageToString(lastMessage);
      const text = await session.prompt(input, { signal: request.signal });
      this.cachedHistory = [
        ...request.messages,
        { role: "assistant", content: { type: "text", text } },
      ];
      return { text, toolCalls: [] };
    } catch (err) {
      this.invalidateCache();
      throw err;
    }
  }

  async *generateStream(request: AdapterRequest): AsyncIterable<AdapterStreamChunk> {
    if (request.tools.length > 0) {
      console.warn(
        "BuiltInAIAdapter: tool calling is not supported — tools will never be invoked.",
      );
    }

    const { session, lastMessage } = await this.acquireSession(request);
    try {
      const input = messageToString(lastMessage);
      const stream = session.promptStreaming(input, { signal: request.signal });
      const reader = stream.getReader();
      let fullText = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += value;
          yield { type: "text_delta", delta: value };
        }
      } finally {
        reader.releaseLock();
      }
      this.cachedHistory = [
        ...request.messages,
        { role: "assistant", content: { type: "text", text: fullText } },
      ];
    } catch (err) {
      this.invalidateCache();
      throw err;
    }
  }

  private async acquireSession(
    request: AdapterRequest,
  ): Promise<{ session: LanguageModelSession; lastMessage: Message }> {
    if (request.messages.length === 0) {
      throw new AdapterError("Request must contain at least one message.");
    }

    const lastMessage = request.messages[request.messages.length - 1];
    const history = request.messages.slice(0, -1);

    if (this.isCacheHit(history)) {
      return { session: this.cachedSession!, lastMessage };
    }

    this.invalidateCache();

    const availability = await LanguageModel.availability();
    if (availability === "unavailable") {
      throw new AdapterError("Built-in AI model is unavailable on this device.");
    }
    if (availability === "after-download" || availability === "downloading") {
      throw new AdapterError(
        `Built-in AI model is not ready (status: "${availability}"). Wait for the model to finish downloading.`,
      );
    }

    const initialPrompts = buildInitialPrompts(request.system, history);
    const session = await LanguageModel.create({
      signal: request.signal,
      initialPrompts,
      monitor: this.options.onDownloadProgress
        ? (m) => {
            m.addEventListener("downloadprogress", (e) => {
              const evt = e as ProgressEvent;
              this.options.onDownloadProgress!({ loaded: evt.loaded, total: evt.total });
            });
          }
        : undefined,
    });

    if (session.contextUsage >= session.contextWindow) {
      session.destroy();
      throw new AdapterError(
        "Conversation history exceeds the model's context window.",
      );
    }

    this.cachedSession = session;
    this.cachedHistory = history;
    return { session, lastMessage };
  }

  private isCacheHit(history: Message[]): boolean {
    if (!this.cachedSession) return false;
    // cachedHistory = all prior messages + last assistant response.
    // history = all messages except the new user turn = cachedHistory when cache is warm.
    if (history.length !== this.cachedHistory.length) return false;
    if (history.length === 0) return true;
    const last = history[history.length - 1];
    const cachedLast = this.cachedHistory[this.cachedHistory.length - 1];
    return JSON.stringify(last) === JSON.stringify(cachedLast);
  }

  private invalidateCache(): void {
    this.cachedSession?.destroy();
    this.cachedSession = null;
    this.cachedHistory = [];
  }
}

function buildInitialPrompts(
  system: string | undefined,
  history: Message[],
): LanguageModelMessage[] {
  const prompts: LanguageModelMessage[] = [];
  if (system) {
    prompts.push({ role: "system", content: system });
  }
  for (const msg of history) {
    prompts.push({ role: msg.role, content: messageToString(msg) });
  }
  return prompts;
}

function messageToString(message: Message): string {
  if (message.content.type === "text") {
    return message.content.text;
  }
  // tool_calls and tool_result have no text representation for the Prompt API
  return "";
}

export async function checkAvailability() {
  return LanguageModel.availability();
}
