// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StrictMode, type KeyboardEvent } from 'react';

import { useMentions } from './useMentions.js';
import type { MentionItem } from './types.js';

interface DocPayload {
  path: string;
}

const items: MentionItem<DocPayload>[] = [
  { id: '1', label: 'README', data: { path: 'README.md' } },
  { id: '2', label: 'README-extra', data: { path: 'README-extra.md' } },
  { id: '3', label: 'CHANGELOG', data: { path: 'CHANGELOG.md' } },
];

/**
 * Builds a fake KeyboardEvent good enough for `handleKeyDown` to consume —
 * `key` and a spy `preventDefault` are all the hook touches.
 */
function fakeKey(key: string): KeyboardEvent<HTMLTextAreaElement> {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

describe('useMentions', () => {
  describe('synchronous items', () => {
    it('filters by case-insensitive substring on label', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items }));
      act(() => result.current.setTrailingInput('hello @read'));
      expect(result.current.mentionQuery).toBe('read');
      expect(result.current.filteredItems.map((i) => i.id)).toEqual(['1', '2']);
    });

    it('returns no items when no trigger is active', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items }));
      act(() => result.current.setTrailingInput('hello world'));
      expect(result.current.mentionQuery).toBeNull();
      expect(result.current.filteredItems).toEqual([]);
    });

    it('omits already-selected items from the filtered list', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items }));
      act(() => result.current.setTrailingInput('hello @'));
      act(() => result.current.selectItem(items[0]));
      act(() => result.current.setTrailingInput('next @r'));
      expect(result.current.filteredItems.map((i) => i.id)).toEqual(['2']);
    });
  });

  describe('segment management', () => {
    it('appends a segment with the preceding text (whitespace preserved) and resets the trailing input', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items }));
      act(() => result.current.setTrailingInput('hello @read'));
      act(() => result.current.selectItem(items[0]));
      expect(result.current.segments).toHaveLength(1);
      // Trailing whitespace before `@` is preserved so the inline display
      // form (`hello @README`) reads naturally.
      expect(result.current.segments[0].text).toBe('hello ');
      expect(result.current.segments[0].item.id).toBe('1');
      expect(result.current.trailingInput).toBe('');
      expect(result.current.mentionQuery).toBeNull();
    });

    it('removeChip merges the chip text into the next segment', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items }));
      act(() => result.current.setTrailingInput('a @'));
      act(() => result.current.selectItem(items[0]));
      act(() => result.current.setTrailingInput(' b @'));
      act(() => result.current.selectItem(items[1]));
      expect(result.current.segments).toHaveLength(2);
      act(() => result.current.removeChip('1'));
      expect(result.current.segments).toHaveLength(1);
      // Both segment texts kept their trailing space; concatenated they
      // produce "a  b " (two spaces at the join — the user's typed input
      // verbatim, minus the now-removed chip).
      expect(result.current.segments[0].text).toBe('a  b ');
      expect(result.current.segments[0].item.id).toBe('2');
    });

    it('removeChip pushes orphan text into the trailing region when removing the last chip', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items }));
      act(() => result.current.setTrailingInput('hello @'));
      act(() => result.current.selectItem(items[0]));
      act(() => result.current.setTrailingInput(' world'));
      act(() => result.current.removeChip('1'));
      expect(result.current.segments).toHaveLength(0);
      // The segment text "hello " plus the trailing input " world" become
      // "hello  world" — the user's typed input verbatim minus the chip.
      expect(result.current.trailingInput).toBe('hello  world');
    });

    it('selectItem is a no-op when the item is already selected', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items }));
      act(() => result.current.setTrailingInput('@'));
      act(() => result.current.selectItem(items[0]));
      act(() => result.current.setTrailingInput('@'));
      act(() => result.current.selectItem(items[0]));
      expect(result.current.segments).toHaveLength(1);
    });

    it('clear() resets segments, trailing text, and the picker', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items }));
      act(() => result.current.setTrailingInput('hi @'));
      act(() => result.current.selectItem(items[0]));
      act(() => result.current.setTrailingInput('more text @r'));
      act(() => result.current.clear());
      expect(result.current.segments).toEqual([]);
      expect(result.current.trailingInput).toBe('');
      expect(result.current.mentionQuery).toBeNull();
      expect(result.current.pickerIndex).toBe(0);
    });
  });

  describe('keyboard navigation', () => {
    it('ArrowDown / ArrowUp wrap around the filtered list', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items }));
      act(() => result.current.setTrailingInput('@'));
      // 3 items visible — start at 0
      expect(result.current.pickerIndex).toBe(0);
      act(() => {
        result.current.handleKeyDown(fakeKey('ArrowDown'));
      });
      expect(result.current.pickerIndex).toBe(1);
      act(() => {
        result.current.handleKeyDown(fakeKey('ArrowDown'));
      });
      act(() => {
        result.current.handleKeyDown(fakeKey('ArrowDown'));
      });
      expect(result.current.pickerIndex).toBe(0);
      act(() => {
        result.current.handleKeyDown(fakeKey('ArrowUp'));
      });
      expect(result.current.pickerIndex).toBe(2);
    });

    it('Enter selects the active item', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items }));
      act(() => result.current.setTrailingInput('@'));
      act(() => {
        result.current.handleKeyDown(fakeKey('ArrowDown'));
      });
      act(() => {
        result.current.handleKeyDown(fakeKey('Enter'));
      });
      expect(result.current.segments).toHaveLength(1);
      expect(result.current.segments[0].item.id).toBe('2');
    });

    it('Escape closes the picker without selecting', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items }));
      act(() => result.current.setTrailingInput('@r'));
      expect(result.current.mentionQuery).toBe('r');
      act(() => {
        result.current.handleKeyDown(fakeKey('Escape'));
      });
      expect(result.current.mentionQuery).toBeNull();
      expect(result.current.segments).toHaveLength(0);
    });

    it('handleKeyDown returns false (does not consume) when the picker is closed', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items }));
      let consumed = true;
      act(() => {
        consumed = result.current.handleKeyDown(fakeKey('Enter'));
      });
      expect(consumed).toBe(false);
    });

    it('handleKeyDown returns false when filteredItems is empty', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items }));
      act(() => result.current.setTrailingInput('@nomatch'));
      expect(result.current.mentionQuery).toBe('nomatch');
      expect(result.current.filteredItems).toHaveLength(0);
      let consumed = true;
      act(() => {
        consumed = result.current.handleKeyDown(fakeKey('Enter'));
      });
      expect(consumed).toBe(false);
    });
  });

  describe('async onSearch', () => {
    it('uses async results once the promise resolves', async () => {
      const onSearch = vi.fn(async (query: string) => {
        return items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()));
      });
      const { result } = renderHook(() => useMentions<DocPayload>({ onSearch }));
      act(() => result.current.setTrailingInput('@change'));
      await waitFor(() => {
        expect(result.current.filteredItems.map((i) => i.id)).toEqual(['3']);
      });
    });

    it('discards stale resolutions when newer queries supersede them', async () => {
      const resolvers: Array<(items: MentionItem<DocPayload>[]) => void> = [];
      const onSearch = vi.fn(
        () =>
          new Promise<MentionItem<DocPayload>[]>((resolve) => {
            resolvers.push(resolve);
          }),
      );
      const { result } = renderHook(() => useMentions<DocPayload>({ onSearch }));

      act(() => result.current.setTrailingInput('@a'));
      await waitFor(() => expect(resolvers.length).toBe(1));
      act(() => result.current.setTrailingInput('@b'));
      await waitFor(() => expect(resolvers.length).toBe(2));

      // Resolve the *newer* request first, then the older one. The older
      // resolution must not overwrite the newer items.
      act(() => resolvers[1]([items[2]]));
      await waitFor(() => {
        expect(result.current.filteredItems.map((i) => i.id)).toEqual(['3']);
      });
      act(() => resolvers[0]([items[0]]));
      // Stale promise resolved — `filteredItems` must still reflect the
      // newer query's result.
      expect(result.current.filteredItems.map((i) => i.id)).toEqual(['3']);
    });
  });

  describe('buildSubmission', () => {
    it('returns the inline form for both prompt and displayText by default', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items }));
      act(() => result.current.setTrailingInput('hello @'));
      act(() => result.current.selectItem(items[0]));
      act(() => result.current.setTrailingInput(' world'));
      const submission = result.current.buildSubmission();
      expect(submission.prompt).toBe('hello @README world');
      expect(submission.displayText).toBe('hello @README world');
    });

    it('runs buildPrompt when supplied while preserving the inline displayText', () => {
      const buildPrompt = vi.fn(
        (segments: typeof items extends Array<infer _U> ? unknown[] : never, trailing: string) => {
          const segs = segments as Array<{ text: string; item: MentionItem<DocPayload> }>;
          const ids = segs.map((s) => s.item.id).join(',');
          return `[refs:${ids}] ${trailing}`;
        },
      );
      const { result } = renderHook(() =>
        useMentions<DocPayload>({ items, buildPrompt: buildPrompt as never }),
      );
      act(() => result.current.setTrailingInput('@'));
      act(() => result.current.selectItem(items[0]));
      act(() => result.current.setTrailingInput('do thing'));
      const submission = result.current.buildSubmission();
      expect(submission.prompt).toBe('[refs:1] do thing');
      expect(submission.displayText).toBe('@READMEdo thing');
    });
  });

  describe('StrictMode safety', () => {
    it('does not double-append a segment when selectItem runs under StrictMode', () => {
      // StrictMode intentionally double-invokes state-updater functions so
      // impure updaters surface in dev. selectItem must remain idempotent —
      // a previous version nested setSegments inside setTrailingInputState's
      // updater, which caused the chip to be added twice.
      const { result } = renderHook(() => useMentions<DocPayload>({ items }), {
        wrapper: StrictMode,
      });
      act(() => result.current.setTrailingInput('hello @'));
      act(() => result.current.selectItem(items[0]));
      expect(result.current.segments).toHaveLength(1);
      expect(result.current.segments[0].item.id).toBe('1');
    });

    it('does not double-merge text when removeChip runs under StrictMode', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items }), {
        wrapper: StrictMode,
      });
      act(() => result.current.setTrailingInput('hi @'));
      act(() => result.current.selectItem(items[0]));
      act(() => result.current.setTrailingInput(' world'));
      act(() => result.current.removeChip('1'));
      expect(result.current.segments).toHaveLength(0);
      // The segment text "hi " plus trailing input " world" → "hi  world".
      expect(result.current.trailingInput).toBe('hi  world');
    });
  });

  describe('custom trigger', () => {
    it('respects a custom trigger character', () => {
      const { result } = renderHook(() => useMentions<DocPayload>({ items, trigger: '#' }));
      act(() => result.current.setTrailingInput('hi #read'));
      expect(result.current.mentionQuery).toBe('read');
      expect(result.current.filteredItems.map((i) => i.id)).toEqual(['1', '2']);
    });
  });
});
