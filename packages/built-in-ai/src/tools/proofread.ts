// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { AdapterError } from "@mast-ai/core";
import type { Tool, ToolDefinition, ToolContext, ToolRegistry } from "@mast-ai/core";
import type { ProofreadCorrection, ProofreadResult, ProofreaderSession } from "../types.js";

export type { ProofreadCorrection, ProofreadResult };

/** Arguments passed by the model when invoking the `proofread` tool. */
export interface ProofreadArgs {
  /** The text to proofread. */
  text: string;
}

/** Options for {@link ProofreadTool}. */
export interface ProofreadToolOptions {
  /** Called during model download with bytes loaded / total. */
  onDownloadProgress?: (progress: { loaded: number; total: number }) => void;
}

/**
 * {@link Tool} that checks text for spelling and grammar errors using the
 * browser's Proofreader API.
 *
 * Use {@link ProofreadTool.addToRegistry} to register the tool — direct
 * construction is not recommended.
 *
 * Session creation strategy:
 * - `"available"` — session is created eagerly in `addToRegistry` and reused.
 * - `"downloadable"` / `"downloading"` — session is created lazily on the first
 *   `call()`, which must occur within a user-gesture context (browser requirement
 *   for triggering a model download).
 */
export class ProofreadTool implements Tool<ProofreadArgs, ProofreadResult> {
  private session: ProofreaderSession | null = null;

  constructor(private readonly options?: ProofreadToolOptions) {}

  /**
   * Registers a `ProofreadTool` instance into `registry`.
   *
   * Throws if the Proofreader API global is absent or reports `"unavailable"`.
   * When the model is already available, the session is created immediately.
   * When a download is required, session creation is deferred to the first `call()`.
   */
  static async addToRegistry(
    registry: ToolRegistry,
    options?: ProofreadToolOptions,
  ): Promise<void> {
    if (typeof Proofreader === "undefined") {
      throw new AdapterError("Proofreader API is not supported in this browser.");
    }

    const availability = await Proofreader.availability();
    if (availability === "unavailable") {
      throw new AdapterError("Proofreader API is not available on this device.");
    }

    const tool = new ProofreadTool(options);

    if (availability === "available") {
      tool.session = await Proofreader.create();
    }
    // For "downloadable"/"downloading", session creation is deferred to call().

    registry.register(tool);
  }

  /** {@inheritDoc Tool.definition} */
  definition(): ToolDefinition {
    return {
      name: "proofread",
      description:
        "Check a piece of text for spelling and grammar errors using an on-device AI model. " +
        "Returns a list of corrections, each with the problematic span and the corrected replacement.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text to proofread.",
          },
        },
        required: ["text"],
      },
      scope: 'read',
    };
  }

  /** {@inheritDoc Tool.call} */
  async call(args: ProofreadArgs, context: ToolContext): Promise<ProofreadResult> {
    if (typeof Proofreader === "undefined") {
      throw new AdapterError("Proofreader API is not supported in this browser.");
    }

    if (!this.session) {
      this.session = await Proofreader.create({ monitor: this.buildMonitor() });
    }

    return this.session.proofread(args.text, { signal: context.signal });
  }

  private buildMonitor(): ((m: EventTarget) => void) | undefined {
    if (!this.options?.onDownloadProgress) return undefined;
    const cb = this.options.onDownloadProgress;
    return (m: EventTarget) => {
      m.addEventListener("downloadprogress", (e) => {
        const evt = e as ProgressEvent;
        cb({ loaded: evt.loaded, total: evt.total });
      });
    };
  }
}
