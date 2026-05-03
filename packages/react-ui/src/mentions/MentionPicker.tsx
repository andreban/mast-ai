// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react';

import type { MentionItem } from './types';

/**
 * Props accepted by {@link MentionPicker}. Exported for consumers building
 * a bespoke compound input on top of {@link useMentions}.
 */
export interface MentionPickerProps<T = unknown> {
  /** Items to render. Empty list hides the picker entirely. */
  items: MentionItem<T>[];
  /** Index of the keyboard-active row. */
  activeIndex: number;
  /** Called when the user clicks a row. */
  onSelect: (item: MentionItem<T>) => void;
  /**
   * Stable id prefix used to build the per-option DOM id. Consumers that
   * wire `aria-activedescendant` on a textarea should pass the same prefix
   * and read the active id as `${idPrefix}-${activeIndex}`.
   */
  idPrefix: string;
  /** Renders a custom row body. Default: a `<div>` showing `item.label`. */
  renderItem?: (item: MentionItem<T>, isActive: boolean) => ReactNode;
}

/**
 * Floating popover rendered above {@link import('../components/ChatInput').ChatInput}
 * when an in-progress mention has at least one filtered item.
 *
 * Uses `role="listbox"` with `role="option"` rows so screen readers announce
 * the active row when the textarea's `aria-activedescendant` updates.
 */
export function MentionPicker<T = unknown>({
  items,
  activeIndex,
  onSelect,
  idPrefix,
  renderItem,
}: MentionPickerProps<T>) {
  if (items.length === 0) return null;
  return (
    <ul
      className="mast-mention-picker"
      id={`${idPrefix}-listbox`}
      role="listbox"
      aria-label="Mention picker"
    >
      {items.map((item, index) => {
        const isActive = index === activeIndex;
        const className = isActive
          ? 'mast-mention-picker-item mast-mention-picker-active'
          : 'mast-mention-picker-item';
        return (
          <li
            key={item.id}
            id={`${idPrefix}-${index}`}
            role="option"
            aria-selected={isActive}
            className={className}
            // `mousedown` rather than `click` so the textarea does not lose
            // focus before we commit the selection — `preventDefault` keeps
            // the caret in place.
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(item);
            }}
          >
            {renderItem ? (
              renderItem(item, isActive)
            ) : (
              <div>
                <div className="mast-mention-picker-item-label">{item.label}</div>
                {item.description && (
                  <div className="mast-mention-picker-item-description">{item.description}</div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
