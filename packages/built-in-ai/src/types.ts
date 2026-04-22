// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

export type LanguageModelAvailability =
  | "readily"
  | "after-download"
  | "downloading"
  | "unavailable";

export interface LanguageModelMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LanguageModelCreateOptions {
  signal?: AbortSignal;
  initialPrompts?: LanguageModelMessage[];
  // systemPrompt exists in the spec but is not used — system prompt is
  // injected as a { role: "system" } entry in initialPrompts instead.
  monitor?: (monitor: EventTarget) => void;
  // temperature and topK are only available in the Chrome extension version
  // of the Prompt API and have been removed from the browser version — omitted.
}

export interface LanguageModelPromptOptions {
  signal?: AbortSignal;
}

export interface LanguageModelSession {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
  promptStreaming(input: string, options?: LanguageModelPromptOptions): ReadableStream<string>;
  contextUsage: number;
  contextWindow: number;
  destroy(): void;
  addEventListener(type: "contextoverflow", listener: EventListener): void;
}

declare global {
  const LanguageModel: {
    availability(options?: Partial<LanguageModelCreateOptions>): Promise<LanguageModelAvailability>;
    create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
  };
}
