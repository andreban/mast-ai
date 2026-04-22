// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

/**
 * Availability status of the on-device language model returned by `LanguageModel.availability()`.
 *
 * - `"readily"` — model is ready to use immediately.
 * - `"after-download"` — model must be downloaded before use.
 * - `"downloading"` — download is in progress.
 * - `"unavailable"` — not supported on this device or browser.
 */
export type LanguageModelAvailability =
  | "readily"
  | "after-download"
  | "downloading"
  | "unavailable";

/** A single message passed to `LanguageModel.create` as part of `initialPrompts`. */
export interface LanguageModelMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Options accepted by `LanguageModel.create`. */
export interface LanguageModelCreateOptions {
  signal?: AbortSignal;
  initialPrompts?: LanguageModelMessage[];
  // systemPrompt exists in the spec but is not used — system prompt is
  // injected as a { role: "system" } entry in initialPrompts instead.
  /** Callback invoked with a download progress monitor target. */
  monitor?: (monitor: EventTarget) => void;
  // temperature and topK are only available in the Chrome extension version
  // of the Prompt API and have been removed from the browser version — omitted.
}

/** Options accepted by `LanguageModelSession.prompt` and `promptStreaming`. */
export interface LanguageModelPromptOptions {
  signal?: AbortSignal;
}

/** A live session obtained from `LanguageModel.create`. */
export interface LanguageModelSession {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
  promptStreaming(input: string, options?: LanguageModelPromptOptions): ReadableStream<string>;
  /** Number of tokens currently consumed in the session context. */
  contextUsage: number;
  /** Maximum number of tokens the session context can hold. */
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

/**
 * Availability status of the on-device Summarizer API returned by `Summarizer.availability()`.
 *
 * - `"readily"` — ready to use immediately.
 * - `"after-download"` — must be downloaded before use.
 * - `"downloading"` — download is in progress.
 * - `"unavailable"` — not supported on this device or browser.
 */
export type SummarizerAvailability =
  | "readily"
  | "after-download"
  | "downloading"
  | "unavailable";

/** Shape of the summary output. */
export type SummarizerType = "key-points" | "tldr" | "teaser" | "headline";
/** Output format of the summary. */
export type SummarizerFormat = "plain-text" | "markdown";
/** Target length of the summary relative to the source text. */
export type SummarizerLength = "short" | "medium" | "long";

/** Options accepted by `Summarizer.create`. */
export interface SummarizerCreateOptions {
  type?: SummarizerType;
  format?: SummarizerFormat;
  length?: SummarizerLength;
  /** Shared context prepended to every summarization call made on this session. */
  sharedContext?: string;
  signal?: AbortSignal;
  /** Callback invoked with a download progress monitor target. */
  monitor?: (monitor: EventTarget) => void;
}

/** Per-call options passed to `SummarizerSession.summarize` / `summarizeStreaming`. */
export interface SummarizerCallOptions {
  /** Optional hint providing additional context for this specific call. */
  context?: string;
  signal?: AbortSignal;
}

/** A live session obtained from `Summarizer.create`. */
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

/**
 * Availability status of the on-device Language Detector API.
 *
 * - `"readily"` — ready to use immediately.
 * - `"after-download"` — must be downloaded before use.
 * - `"downloading"` — download is in progress.
 * - `"unavailable"` — not supported on this device or browser.
 */
export type LanguageDetectorAvailability =
  | "readily"
  | "after-download"
  | "downloading"
  | "unavailable";

/** Options accepted by `LanguageDetector.create`. */
export interface LanguageDetectorCreateOptions {
  signal?: AbortSignal;
  /** Callback invoked with a download progress monitor target. */
  monitor?: (monitor: EventTarget) => void;
}

/** A single language detection result. */
export interface LanguageDetectionResult {
  /** BCP 47 language tag (e.g. `"en"`, `"fr"`), or `null` if undetermined. */
  detectedLanguage: string | null;
  /** Confidence score in the range [0, 1]. */
  confidence: number;
}

/** Per-call options passed to `LanguageDetectorSession.detect`. */
export interface LanguageDetectorCallOptions {
  signal?: AbortSignal;
}

/** A live session obtained from `LanguageDetector.create`. */
export interface LanguageDetectorSession {
  detect(text: string, options?: LanguageDetectorCallOptions): Promise<LanguageDetectionResult[]>;
  destroy(): void;
}

declare global {
  const LanguageDetector: {
    availability(options?: Partial<LanguageDetectorCreateOptions>): Promise<LanguageDetectorAvailability>;
    create(options?: LanguageDetectorCreateOptions): Promise<LanguageDetectorSession>;
  };
}
