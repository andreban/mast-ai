// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { AdapterError } from "@mast-ai/core";
import type { Tool, ToolDefinition, ToolContext, ToolRegistry } from "@mast-ai/core";
import type {
  LanguageDetectionResult,
  LanguageDetectorSession,
} from "../types.js";

/** Arguments passed by the model when invoking the `detectLanguage` tool. */
export interface DetectLanguageArgs {
  /** The text whose language should be detected. */
  text: string;
}

/** Options for {@link DetectLanguageTool}. */
export interface DetectLanguageToolOptions {
  /** Called during model download with bytes loaded and total bytes. */
  onDownloadProgress?: (progress: { loaded: number; total: number }) => void;
}

/**
 * {@link Tool} that identifies the language of a piece of text using the
 * browser's Language Detector API.
 *
 * Use {@link DetectLanguageTool.addToRegistry} to register the tool — direct
 * construction is not recommended because the session is created asynchronously.
 */
export class DetectLanguageTool implements Tool<DetectLanguageArgs, LanguageDetectionResult> {
  private session: LanguageDetectorSession | null = null;

  /**
   * Registers a `DetectLanguageTool` instance into `registry` once the
   * underlying Language Detector session is ready.
   *
   * Throws immediately if the Language Detector API is unsupported or unavailable.
   * The tool is silently skipped if background session creation fails.
   */
  static async addToRegistry(
    registry: ToolRegistry,
    options?: DetectLanguageToolOptions,
  ): Promise<void> {
    if (typeof LanguageDetector === "undefined") {
      throw new AdapterError("Language Detector API is not supported in this browser.");
    }

    const availability = await LanguageDetector.availability();

    if (availability === "unavailable") {
      throw new AdapterError("Language Detector API is unavailable on this device.");
    }

    const tool = new DetectLanguageTool();

    const monitor = options?.onDownloadProgress
      ? (m: EventTarget) => {
          m.addEventListener("downloadprogress", (e) => {
            const evt = e as ProgressEvent;
            options.onDownloadProgress!({ loaded: evt.loaded, total: evt.total });
          });
        }
      : undefined;

    LanguageDetector.create({ monitor }).then((session) => {
      tool.session = session;
      registry.register(tool);
    }).catch(() => {
      // Background creation failed — tool remains unregistered.
    });
  }

  /** {@inheritDoc Tool.definition} */
  definition(): ToolDefinition {
    return {
      name: "detectLanguage",
      description:
        "Detect the language of a piece of text. " +
        "Returns the most likely BCP 47 language tag (e.g. 'en', 'fr', 'ja') " +
        "and a confidence score between 0 and 1.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text whose language should be detected.",
          },
        },
        required: ["text"],
      },
      scope: 'read',
    };
  }

  /** {@inheritDoc Tool.call} */
  async call(args: DetectLanguageArgs, context: ToolContext): Promise<LanguageDetectionResult> {
    if (typeof LanguageDetector === "undefined") {
      throw new AdapterError("Language Detector API is not supported in this browser.");
    }

    const session = await this.acquireSession(context);
    const results = await session.detect(args.text, { signal: context.signal });
    return results[0] ?? { detectedLanguage: null, confidence: 0 };
  }

  private async acquireSession(context: ToolContext): Promise<LanguageDetectorSession> {
    if (this.session) {
      return this.session;
    }

    this.session = await LanguageDetector.create({ signal: context.signal });
    return this.session;
  }
}
