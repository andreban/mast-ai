// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

export type { MentionItem, MentionSegment, MentionsConfig } from './types.js';
export { buildInlineMentionPrompt, extractMentionQuery, removeMentionTrigger } from './utils.js';
export { useMentions } from './useMentions.js';
export type { UseMentionsReturn } from './useMentions.js';
export { MentionPicker } from './MentionPicker.js';
export type { MentionPickerProps } from './MentionPicker.js';
