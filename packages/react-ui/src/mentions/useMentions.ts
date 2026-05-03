// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import type { MentionItem, MentionSegment, MentionsConfig } from './types.js';
import { buildInlineMentionPrompt, extractMentionQuery, removeMentionTrigger } from './utils.js';

/**
 * Return shape of {@link useMentions}.
 *
 * Consumers either pass the whole object to `<ChatInput mentions>` (via the
 * `mentions` config — `<ChatInput>` calls `useMentions` internally) or wire
 * the individual fields into a bespoke compound input.
 */
export interface UseMentionsReturn<T = unknown> {
  /** Committed segments preceding the trailing-text region. */
  segments: MentionSegment<T>[];
  /** Free-form text after the last chip (or the whole field when no chips). */
  trailingInput: string;
  /** Current `@<query>` if the cursor is inside an in-progress mention. */
  mentionQuery: string | null;
  /** Items the picker should render right now (filtered or async-resolved). */
  filteredItems: MentionItem<T>[];
  /** Index of the keyboard-highlighted picker row. */
  pickerIndex: number;

  /** Set the trailing-text region. Recomputes `mentionQuery` and resets picker focus. */
  setTrailingInput: (text: string) => void;
  /**
   * Wire to the textarea's `onKeyDown`. Returns `true` if the key was
   * consumed by the picker so the host can suppress its own handling. Up /
   * Down / Enter / Escape are only consumed when the picker has at least one
   * filtered item.
   */
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Append a chip and reset the in-progress mention. */
  selectItem: (item: MentionItem<T>) => void;
  /** Remove a chip by id, re-merging its preceding text into the next region. */
  removeChip: (id: string) => void;
  /** Build `{ prompt, displayText }` for `sendMessage`. */
  buildSubmission: () => { prompt: string; displayText: string };
  /** Clear all segments and trailing text. */
  clear: () => void;
}

/**
 * Owns the segment / trailing-text / picker-index state behind the optional
 * `<ChatInput mentions>` UI. Exported so consumers can build a bespoke input
 * (e.g. with their own picker component or virtualisation) without giving up
 * the segment management and async-search plumbing.
 *
 * - `config.items` filters by case-insensitive substring on `label`.
 * - `config.onSearch` is called every time the query changes; the latest
 *   resolution wins so out-of-order responses cannot replace newer matches.
 *   Already-selected items are filtered out of the picker so the same
 *   reference cannot be picked twice.
 */
export function useMentions<T = unknown>(config: MentionsConfig<T>): UseMentionsReturn<T> {
  const trigger = config.trigger ?? '@';

  const [segments, setSegments] = useState<MentionSegment<T>[]>([]);
  const [trailingInput, setTrailingInputState] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<MentionItem<T>[]>([]);

  // Refs mirror the latest committed state so event-handler callbacks
  // (`selectItem`, `removeChip`) can read it without nesting one state
  // setter inside another's updater function — that nesting double-runs in
  // React StrictMode and would duplicate appends.
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const trailingInputRef = useRef(trailingInput);
  trailingInputRef.current = trailingInput;

  // Tracks the most recent `onSearch` invocation so stale resolutions can be
  // discarded — out-of-order async results must not overwrite newer matches.
  const searchTokenRef = useRef(0);

  useEffect(() => {
    if (mentionQuery === null) {
      setSearchResults([]);
      return;
    }
    const token = ++searchTokenRef.current;
    if (config.onSearch) {
      const result = config.onSearch(mentionQuery);
      if (result instanceof Promise) {
        result.then((items) => {
          if (token === searchTokenRef.current) setSearchResults(items);
        });
      } else {
        setSearchResults(result);
      }
    }
    // `items` mode is handled by `filteredItems` below — no async work required.
  }, [mentionQuery, config.onSearch]);

  const selectedIds = new Set(segments.map((s) => s.item.id));

  const filteredItems: MentionItem<T>[] = (() => {
    if (mentionQuery === null) return [];
    if (config.onSearch) {
      return searchResults.filter((item) => !selectedIds.has(item.id));
    }
    const lowered = mentionQuery.toLowerCase();
    return (config.items ?? []).filter(
      (item) => !selectedIds.has(item.id) && item.label.toLowerCase().includes(lowered),
    );
  })();

  const setTrailingInput = useCallback(
    (text: string) => {
      setTrailingInputState(text);
      setMentionQuery(extractMentionQuery(text, trigger));
      setPickerIndex(0);
    },
    [trigger],
  );

  const selectItem = useCallback(
    (item: MentionItem<T>) => {
      const currentSegments = segmentsRef.current;
      if (currentSegments.some((s) => s.item.id === item.id)) return;
      const textBefore = removeMentionTrigger(trailingInputRef.current, trigger);
      setSegments([...currentSegments, { text: textBefore, item }]);
      setTrailingInputState('');
      setMentionQuery(null);
      setPickerIndex(0);
    },
    [trigger],
  );

  const removeChip = useCallback((id: string) => {
    const prev = segmentsRef.current;
    const idx = prev.findIndex((s) => s.item.id === id);
    if (idx === -1) return;
    const removedText = prev[idx].text;
    const without = [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    if (idx < without.length) {
      // Merge the removed chip's preceding text into the next segment so
      // the visible text reflows seamlessly.
      without[idx] = { ...without[idx], text: removedText + without[idx].text };
      setSegments(without);
      return;
    }
    // Removed the last chip: orphan text becomes part of the trailing region.
    setSegments(without);
    setTrailingInputState(removedText + trailingInputRef.current);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (mentionQuery === null || filteredItems.length === 0) return false;
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setPickerIndex((i) => (i + 1) % filteredItems.length);
          return true;
        case 'ArrowUp':
          event.preventDefault();
          setPickerIndex((i) => (i === 0 ? filteredItems.length - 1 : i - 1));
          return true;
        case 'Enter':
          event.preventDefault();
          selectItem(filteredItems[pickerIndex] ?? filteredItems[0]);
          return true;
        case 'Escape':
          event.preventDefault();
          setMentionQuery(null);
          return true;
        default:
          return false;
      }
    },
    [mentionQuery, filteredItems, pickerIndex, selectItem],
  );

  const buildSubmission = useCallback((): { prompt: string; displayText: string } => {
    const displayText = buildInlineMentionPrompt(segments, trailingInput);
    const prompt = config.buildPrompt ? config.buildPrompt(segments, trailingInput) : displayText;
    return { prompt, displayText };
  }, [segments, trailingInput, config.buildPrompt]);

  const clear = useCallback(() => {
    setSegments([]);
    setTrailingInputState('');
    setMentionQuery(null);
    setPickerIndex(0);
  }, []);

  return {
    segments,
    trailingInput,
    mentionQuery,
    filteredItems,
    pickerIndex,
    setTrailingInput,
    handleKeyDown,
    selectItem,
    removeChip,
    buildSubmission,
    clear,
  };
}
