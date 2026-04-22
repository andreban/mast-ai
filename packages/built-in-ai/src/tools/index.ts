// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { SummarizeTool } from "./summarize.js";
import type { ToolRegistry } from "@mast-ai/core";

/** Options for {@link addAllBuiltInAITools}. */
export interface AddAllBuiltInAIToolsOptions {
  /** Called during model download with the tool name and bytes loaded / total bytes. */
  onDownloadProgress?: (tool: string, progress: { loaded: number; total: number }) => void;
}

/**
 * Convenience helper that registers all available built-in AI tools into `registry`.
 *
 * Uses `Promise.allSettled` internally so a single unavailable tool does not
 * prevent the others from being registered.
 */
export async function addAllBuiltInAITools(
  registry: ToolRegistry,
  options?: AddAllBuiltInAIToolsOptions,
): Promise<void> {
  await Promise.allSettled([
    SummarizeTool.addToRegistry(registry, {
      onDownloadProgress: options?.onDownloadProgress
        ? (p) => options.onDownloadProgress!("summarize", p)
        : undefined,
    }),
  ]);
}
