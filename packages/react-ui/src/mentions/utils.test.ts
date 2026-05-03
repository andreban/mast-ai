// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';

import { buildInlineMentionPrompt, extractMentionQuery, removeMentionTrigger } from './utils';
import type { MentionSegment } from './types';

describe('extractMentionQuery', () => {
  it('returns the query when the input ends with `@<chars>`', () => {
    expect(extractMentionQuery('hello @doc')).toBe('doc');
    expect(extractMentionQuery('hi @abc.txt')).toBe('abc.txt');
  });

  it('returns an empty string when the input ends with a bare trigger', () => {
    expect(extractMentionQuery('hello @')).toBe('');
    expect(extractMentionQuery('@')).toBe('');
  });

  it('returns null after a whitespace ends the mention', () => {
    expect(extractMentionQuery('hello @doc ')).toBeNull();
    expect(extractMentionQuery('hello @doc world')).toBeNull();
    expect(extractMentionQuery('hello @doc\n')).toBeNull();
  });

  it('returns null when there is no trigger', () => {
    expect(extractMentionQuery('hello world')).toBeNull();
    expect(extractMentionQuery('')).toBeNull();
  });

  it('only considers the last trigger when more than one is typed', () => {
    expect(extractMentionQuery('@first @sec')).toBe('sec');
  });

  it('treats consecutive triggers as starting a new in-progress mention', () => {
    // The token after the most recent `@` cannot itself contain `@`, so the
    // trailing region after `@@` is the empty string belonging to the last
    // trigger.
    expect(extractMentionQuery('hi @@')).toBe('');
  });

  it('respects a custom trigger character', () => {
    expect(extractMentionQuery('hello #doc', '#')).toBe('doc');
    expect(extractMentionQuery('hello @doc', '#')).toBeNull();
    expect(extractMentionQuery('hello #', '#')).toBe('');
  });

  it('escapes regex-meta trigger characters', () => {
    expect(extractMentionQuery('hello .doc', '.')).toBe('doc');
    expect(extractMentionQuery('hello $doc', '$')).toBe('doc');
  });
});

describe('removeMentionTrigger', () => {
  it('strips a trailing `@<query>` while preserving whitespace before the trigger', () => {
    expect(removeMentionTrigger('hello @doc')).toBe('hello ');
    expect(removeMentionTrigger('hello @')).toBe('hello ');
  });

  it('leaves text without a trailing trigger untouched', () => {
    expect(removeMentionTrigger('hello world')).toBe('hello world');
    expect(removeMentionTrigger('')).toBe('');
  });

  it('returns an empty string when the input is just the trigger', () => {
    expect(removeMentionTrigger('@')).toBe('');
    expect(removeMentionTrigger('@doc')).toBe('');
  });

  it('only strips the most recent trigger', () => {
    expect(removeMentionTrigger('@first text @sec')).toBe('@first text ');
  });

  it('respects a custom trigger character', () => {
    expect(removeMentionTrigger('hello #doc', '#')).toBe('hello ');
    expect(removeMentionTrigger('hello @doc', '#')).toBe('hello @doc');
  });
});

describe('buildInlineMentionPrompt', () => {
  it('returns just the trailing text when there are no segments', () => {
    expect(buildInlineMentionPrompt([], 'just text')).toBe('just text');
    expect(buildInlineMentionPrompt([], '')).toBe('');
  });

  it('joins segments inline with the trigger character followed by the label', () => {
    const segments: MentionSegment<unknown>[] = [
      { text: 'hello ', item: { id: '1', label: 'one' } },
      { text: ' and ', item: { id: '2', label: 'two' } },
    ];
    expect(buildInlineMentionPrompt(segments, ' here')).toBe('hello @one and @two here');
  });

  it('preserves an empty inter-segment text', () => {
    const segments: MentionSegment<unknown>[] = [
      { text: '', item: { id: '1', label: 'one' } },
      { text: '', item: { id: '2', label: 'two' } },
    ];
    expect(buildInlineMentionPrompt(segments, '')).toBe('@one@two');
  });
});
