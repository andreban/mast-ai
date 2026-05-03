// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

export type { MentionItem, MentionSegment, MentionsConfig } from './types';
export { buildInlineMentionPrompt, extractMentionQuery, removeMentionTrigger } from './utils';
export { useMentions } from './useMentions';
export type { UseMentionsReturn } from './useMentions';
export { MentionPicker } from './MentionPicker';
export type { MentionPickerProps } from './MentionPicker';
