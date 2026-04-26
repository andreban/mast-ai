// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { AdapterError } from "@mast-ai/core";
import type { Tool, ToolDefinition, ToolContext, ToolRegistry } from "@mast-ai/core";
import type { TranslatorSession } from "../types.js";

/** Arguments passed by the model when invoking the `translate` tool. */
export interface TranslateArgs {
  /** The text to translate. */
  text: string;
  /** BCP 47 language tag of the source language (e.g. `"en"`). */
  sourceLanguage: string;
  /** BCP 47 language tag of the target language (e.g. `"fr"`). */
  targetLanguage: string;
}

/** Options for {@link TranslateTool}. */
export interface TranslateToolOptions {
  /** Called during model download for a new language pair with the pair and bytes loaded / total. */
  onDownloadProgress?: (progress: {
    loaded: number;
    total: number;
    sourceLanguage: string;
    targetLanguage: string;
  }) => void;
}

/**
 * {@link Tool} that translates text between languages using the browser's
 * Translator API.
 *
 * Use {@link TranslateTool.addToRegistry} to register the tool — direct
 * construction is not recommended. Sessions are created lazily per language
 * pair on first use and cached for subsequent calls.
 */
export class TranslateTool implements Tool<TranslateArgs, string> {
  private sessions = new Map<string, TranslatorSession>();

  constructor(private readonly options?: TranslateToolOptions) {}

  /**
   * Registers a `TranslateTool` instance into `registry`.
   *
   * Throws immediately if the Translator API global is absent. No session is
   * created at registration time — sessions are created lazily in `call()`.
   */
  static async addToRegistry(
    registry: ToolRegistry,
    options?: TranslateToolOptions,
  ): Promise<void> {
    if (typeof Translator === "undefined") {
      throw new AdapterError("Translator API is not supported in this browser.");
    }

    registry.register(new TranslateTool(options));
  }

  /** {@inheritDoc Tool.definition} */
  definition(): ToolDefinition {
    return {
      name: "translate",
      description:
        "Translate a piece of text from one language to another using an on-device AI model. " +
        "Languages are specified as BCP 47 tags (e.g. 'en', 'fr', 'ja').",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text to translate.",
          },
          sourceLanguage: {
            type: "string",
            description: 'BCP 47 language tag of the source language (e.g. "en").',
          },
          targetLanguage: {
            type: "string",
            description: 'BCP 47 language tag of the target language (e.g. "fr").',
          },
        },
        required: ["text", "sourceLanguage", "targetLanguage"],
      },
      scope: 'read',
    };
  }

  /** {@inheritDoc Tool.call} */
  async call(args: TranslateArgs, context: ToolContext): Promise<string> {
    if (typeof Translator === "undefined") {
      throw new AdapterError("Translator API is not supported in this browser.");
    }

    const session = await this.acquireSession(args.sourceLanguage, args.targetLanguage, context);
    return session.translate(args.text, { signal: context.signal });
  }

  private async acquireSession(
    sourceLanguage: string,
    targetLanguage: string,
    context: ToolContext,
  ): Promise<TranslatorSession> {
    const key = `${sourceLanguage}:${targetLanguage}`;
    const cached = this.sessions.get(key);
    if (cached) {
      return cached;
    }

    const availability = await Translator.availability({ sourceLanguage, targetLanguage });
    if (availability === "unavailable") {
      throw new AdapterError(
        `Translation from ${sourceLanguage} to ${targetLanguage} is not available on this device.`,
      );
    }

    const monitor = this.options?.onDownloadProgress
      ? (m: EventTarget) => {
          m.addEventListener("downloadprogress", (e) => {
            const evt = e as ProgressEvent;
            this.options!.onDownloadProgress!({
              loaded: evt.loaded,
              total: evt.total,
              sourceLanguage,
              targetLanguage,
            });
          });
        }
      : undefined;

    const session = await Translator.create({
      sourceLanguage,
      targetLanguage,
      signal: context.signal,
      monitor,
    });

    this.sessions.set(key, session);
    return session;
  }
}
