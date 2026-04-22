// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

export { BuiltInAIAdapter, checkAvailability } from './BuiltInAIAdapter.js';
export type { BuiltInAIAdapterOptions } from './BuiltInAIAdapter.js';
export type { LanguageModelAvailability } from './types.js';

export { SummarizeTool } from './tools/summarize.js';
export type { SummarizeToolOptions, SummarizeArgs } from './tools/summarize.js';
export { DetectLanguageTool } from './tools/detectLanguage.js';
export type { DetectLanguageToolOptions, DetectLanguageArgs } from './tools/detectLanguage.js';
export { TranslateTool } from './tools/translate.js';
export type { TranslateToolOptions, TranslateArgs } from './tools/translate.js';
export { addAllBuiltInAITools } from './tools/index.js';
export type { AddAllBuiltInAIToolsOptions } from './tools/index.js';
