// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { MentionSegment } from './types.js';

const DEFAULT_TRIGGER = '@';

function escapeForRegex(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the query suffix at the end of `input` if the user is currently
 * typing an in-progress mention, or `null` otherwise.
 *
 * A mention is considered in-progress when the trigger character appears
 * after the last whitespace and is not followed by another whitespace
 * character. The query may be empty (just typed `@` and nothing after).
 *
 * @example
 *   extractMentionQuery('hello @doc') === 'doc'
 *   extractMentionQuery('hello @')    === ''
 *   extractMentionQuery('hello @doc ') === null   // space ends the mention
 *   extractMentionQuery('hello world') === null   // no trigger
 */
export function extractMentionQuery(
  input: string,
  trigger: string = DEFAULT_TRIGGER,
): string | null {
  const escaped = escapeForRegex(trigger);
  const re = new RegExp(`${escaped}([^\\s${escaped}]*)$`);
  const match = input.match(re);
  if (!match) return null;
  return match[1];
}

/**
 * Strips a trailing `@<query>` from `input`, preserving any whitespace
 * the user typed before the trigger. Used after the user commits a picker
 * selection — the preserved whitespace survives into the segment text so
 * the inline display form (`<text>@<label>`) keeps the natural space
 * between the preceding word and the chip.
 */
export function removeMentionTrigger(input: string, trigger: string = DEFAULT_TRIGGER): string {
  const escaped = escapeForRegex(trigger);
  const re = new RegExp(`${escaped}[^\\s${escaped}]*$`);
  return input.replace(re, '');
}

/**
 * Default `buildPrompt` implementation: returns the inline form
 * `<text1>@<label1><text2>@<label2>...<trailing>`.
 *
 * Apps that want to inject extra context (document IDs, file paths, …) can
 * call this and prepend / wrap the result, or build the string from scratch
 * using `segments` and `trailing`.
 */
export function buildInlineMentionPrompt<T>(
  segments: MentionSegment<T>[],
  trailing: string,
): string {
  return segments.map((s) => `${s.text}${DEFAULT_TRIGGER}${s.item.label}`).join('') + trailing;
}
