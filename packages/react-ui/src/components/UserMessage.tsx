// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { ConversationEntry } from '../types.js';

/**
 * Props accepted by {@link UserMessage}.
 */
export interface UserMessageProps {
  /** The conversation entry to render. Must have `role === 'user'`. */
  entry: ConversationEntry;
  /** Optional class added to the root element. */
  className?: string;
}

/**
 * Renders a user turn as a simple text bubble.
 *
 * Outputs the raw `entry.text` inside a `[data-mast-user-message]` wrapper so
 * the default stylesheet's `mast-user-*` classes can theme it as a chat
 * bubble. User input is intentionally rendered as plain text with no
 * markdown processing.
 */
export function UserMessage({ entry, className }: UserMessageProps) {
  const rootClass = ['mast-user-message', className].filter(Boolean).join(' ');
  return (
    <div data-mast-user-message className={rootClass}>
      <div className="mast-user-message-bubble">{entry.text}</div>
    </div>
  );
}
