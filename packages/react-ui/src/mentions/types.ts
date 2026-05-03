// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react';

/**
 * A single picker entry. Generic over `T` so consumers can attach arbitrary
 * payloads (document records, file paths, skill descriptors, …) without the
 * library knowing the domain shape.
 */
export interface MentionItem<T = unknown> {
  /** Stable key. Used as the React key in the picker and the chip identifier. */
  id: string;
  /** Shown in the picker row and rendered as the chip text after the trigger. */
  label: string;
  /** Optional secondary text rendered alongside `label` in the picker. */
  description?: string;
  /** Arbitrary payload accessible from `buildPrompt`, `renderItem`, `renderChip`. */
  data?: T;
}

/**
 * The committed compound input is `MentionSegment<T>[]` followed by a free-form
 * trailing string. Each segment is the plain text immediately preceding a chip
 * plus the mentioned item itself; selecting a new item from the picker
 * appends a segment and starts a fresh trailing region.
 */
export interface MentionSegment<T = unknown> {
  /** Plain text preceding the chip. */
  text: string;
  /** The mentioned item that terminates this segment. */
  item: MentionItem<T>;
}

/**
 * Configuration object accepted by `<ChatInput mentions={...}>`,
 * `<ConversationPanel mentions={...}>`, and `useMentions`. Every field except
 * one of `items` / `onSearch` is optional.
 */
export interface MentionsConfig<T = unknown> {
  /** Trigger character. Default: `'@'`. Must be a single character. */
  trigger?: string;
  /**
   * Static item list. The picker filters by case-insensitive substring on
   * `label`. Mutually exclusive with `onSearch`; if both are provided
   * `onSearch` wins.
   */
  items?: MentionItem<T>[];
  /**
   * Async or sync search function. Called with the current query each time it
   * changes. The latest result wins — stale resolutions are discarded so
   * out-of-order responses cannot replace newer matches.
   */
  onSearch?: (query: string) => MentionItem<T>[] | Promise<MentionItem<T>[]>;
  /** Renders a custom row in the picker. Default: `<div>{item.label}</div>`. */
  renderItem?: (item: MentionItem<T>, isActive: boolean) => ReactNode;
  /**
   * Renders the chip that replaces the in-progress `@<query>` once selected.
   * Default: the library renders `@<label>` followed by an `x` remove button.
   */
  renderChip?: (item: MentionItem<T>, onRemove: () => void) => ReactNode;
  /**
   * Builds the prompt sent to the LLM from the segment list and trailing
   * text. Default: returns the inline display form (segments joined as
   * `<text>@<label>...<trailing>`). Override this to inject context
   * (document IDs, file paths, …) around or before the inline text.
   */
  buildPrompt?: (segments: MentionSegment<T>[], trailing: string) => string;
}
