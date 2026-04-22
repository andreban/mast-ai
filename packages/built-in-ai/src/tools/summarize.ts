// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { AdapterError } from "@mast-ai/core";
import type { Tool, ToolDefinition, ToolContext, ToolRegistry } from "@mast-ai/core";
import type {
  SummarizerSession,
  SummarizerType,
  SummarizerFormat,
  SummarizerLength,
} from "../types.js";

export interface SummarizeArgs {
  text: string;
  type?: SummarizerType;
  format?: SummarizerFormat;
  length?: SummarizerLength;
  context?: string;
}

export interface SummarizeToolOptions {
  onDownloadProgress?: (progress: { loaded: number; total: number }) => void;
}

interface CachedInstance {
  session: SummarizerSession;
  type: SummarizerType | undefined;
  format: SummarizerFormat | undefined;
  length: SummarizerLength | undefined;
}

export class SummarizeTool implements Tool<SummarizeArgs, string> {
  private cached: CachedInstance | null = null;

  static async addToRegistry(
    registry: ToolRegistry,
    options?: SummarizeToolOptions,
  ): Promise<void> {
    if (typeof Summarizer === "undefined") {
      throw new AdapterError("Summarizer API is not supported in this browser.");
    }

    const availability = await Summarizer.availability();

    if (availability === "unavailable") {
      throw new AdapterError("Summarizer API is unavailable on this device.");
    }

    const tool = new SummarizeTool();

    const monitor = options?.onDownloadProgress
      ? (m: EventTarget) => {
          m.addEventListener("downloadprogress", (e) => {
            const evt = e as ProgressEvent;
            options.onDownloadProgress!({ loaded: evt.loaded, total: evt.total });
          });
        }
      : undefined;

    // Return immediately — session creation (including any download) happens in the background.
    // The tool is registered once the session is ready.
    Summarizer.create({ monitor }).then((session) => {
      tool.cached = { session, type: undefined, format: undefined, length: undefined };
      registry.register(tool);
    }).catch(() => {
      // Background creation failed — tool remains unregistered.
    });
  }

  definition(): ToolDefinition {
    return {
      name: "summarize",
      description:
        "Condense a long piece of text into a shorter form. " +
        "Use when the user asks to summarize, shorten, or extract the key points of a document, " +
        "article, or any other lengthy content.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The full text to summarize.",
          },
          type: {
            type: "string",
            enum: ["key-points", "tldr", "teaser", "headline"],
            description:
              "Shape of the summary. " +
              "'key-points' returns a bullet-point list of the main ideas (default). " +
              "'tldr' returns a short paragraph capturing the essence. " +
              "'teaser' returns an engaging excerpt meant to entice reading the full text. " +
              "'headline' returns a single-sentence title.",
          },
          format: {
            type: "string",
            enum: ["plain-text", "markdown"],
            description:
              "Output format. Use 'markdown' when the result will be rendered; " +
              "'plain-text' otherwise. Defaults to 'plain-text'.",
          },
          length: {
            type: "string",
            enum: ["short", "medium", "long"],
            description:
              "Target length of the summary relative to the input. " +
              "Defaults to 'medium'.",
          },
          context: {
            type: "string",
            description:
              "Optional hint to guide the summarization, e.g. 'scientific paper', " +
              "'meeting transcript', or 'news article for a general audience'.",
          },
        },
        required: ["text"],
      },
    };
  }

  async call(args: SummarizeArgs, context: ToolContext): Promise<string> {
    if (typeof Summarizer === "undefined") {
      throw new AdapterError("Summarizer API is not supported in this browser.");
    }

    const session = await this.acquireSession(args, context);
    return session.summarize(args.text, {
      context: args.context,
      signal: context.signal,
    });
  }

  private async acquireSession(args: SummarizeArgs, context: ToolContext): Promise<SummarizerSession> {
    if (
      this.cached &&
      this.cached.type === args.type &&
      this.cached.format === args.format &&
      this.cached.length === args.length
    ) {
      return this.cached.session;
    }

    const old = this.cached;
    this.cached = null;

    let session: SummarizerSession;
    try {
      session = await Summarizer.create({
        type: args.type,
        format: args.format,
        length: args.length,
        signal: context.signal,
      });
    } finally {
      old?.session.destroy();
    }

    this.cached = {
      session,
      type: args.type,
      format: args.format,
      length: args.length,
    };
    return session;
  }
}
