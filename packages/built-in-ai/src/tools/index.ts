// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { SummarizeTool } from "./summarize.js";
import type { ToolRegistry } from "@mast-ai/core";

export interface AddAllBuiltInAIToolsOptions {
  onDownloadProgress?: (tool: string, progress: { loaded: number; total: number }) => void;
}

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
