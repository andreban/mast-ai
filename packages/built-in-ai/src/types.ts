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

export type SummarizerAvailability =
  | "readily"
  | "after-download"
  | "downloading"
  | "unavailable";

export type SummarizerType = "key-points" | "tldr" | "teaser" | "headline";
export type SummarizerFormat = "plain-text" | "markdown";
export type SummarizerLength = "short" | "medium" | "long";

export interface SummarizerCreateOptions {
  type?: SummarizerType;
  format?: SummarizerFormat;
  length?: SummarizerLength;
  sharedContext?: string;
  signal?: AbortSignal;
  monitor?: (monitor: EventTarget) => void;
}

export interface SummarizerCallOptions {
  context?: string;
  signal?: AbortSignal;
}

export interface SummarizerSession {
  summarize(text: string, options?: SummarizerCallOptions): Promise<string>;
  summarizeStreaming(text: string, options?: SummarizerCallOptions): ReadableStream<string>;
  destroy(): void;
}

declare global {
  const Summarizer: {
    availability(options?: Partial<SummarizerCreateOptions>): Promise<SummarizerAvailability>;
    create(options?: SummarizerCreateOptions): Promise<SummarizerSession>;
  };
}
