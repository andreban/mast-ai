// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { useAgent } from '../context.js';
import type { PendingApproval } from '../approval.js';
import type { ToolEventEntry } from '../types.js';
import type { RenderApproval } from './AssistantMessage.js';
import { MessageItem } from './MessageItem.js';

/**
 * Props accepted by {@link MessageList}.
 */
export interface MessageListProps {
  /** Optional class added to the scrollable root element. */
  className?: string;
  /**
   * Forwarded to each {@link MessageItem} so consumers can replace the default
   * tool call renderer for the entire list. Receives a {@link PendingApproval}
   * handle as the second argument when the call is awaiting an inline approval
   * decision.
   */
  renderToolCall?: (entry: ToolEventEntry, approval?: PendingApproval) => ReactNode;
  /**
   * Forwarded to each {@link MessageItem} so consumers can replace only the
   * inline approval card without overriding the rest of the tool-call
   * rendering. Takes precedence over `renderToolCall` for entries with a
   * pending approval handle when both are provided.
   */
  renderApproval?: RenderApproval;
  /**
   * Forwarded to each {@link MessageItem} so consumers can replace the default
   * assistant text renderer for the entire list.
   */
  renderMessage?: (text: string) => ReactNode;
}

/**
 * Estimated height (in pixels) used by the virtualizer before an item has been
 * measured. The real height is then captured via `measureElement` on first
 * render of each row, so any reasonable value works — this just keeps initial
 * scroll offsets sensible while the first paint resolves.
 */
const DEFAULT_ESTIMATED_ITEM_HEIGHT = 80;

/**
 * Scrollable list of {@link ConversationEntry} items rendered with
 * `@tanstack/react-virtual`.
 *
 * Only the visible window of messages is mounted, so long-running conversations
 * stay performant. Item heights are dynamic: each rendered row is observed via
 * `virtualizer.measureElement`, so messages with long tool call results or
 * large markdown blocks expand the viewport correctly.
 *
 * Auto-scrolls to the bottom whenever a new entry is appended or the last
 * entry's `text` grows during streaming.
 *
 * Reads `messages` from `useAgent()`, so this component must be rendered
 * inside an `<AgentProvider>`.
 */
export function MessageList({
  className,
  renderToolCall,
  renderApproval,
  renderMessage,
}: MessageListProps) {
  const { messages } = useAgent();
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DEFAULT_ESTIMATED_ITEM_HEIGHT,
    overscan: 4,
  });

  const lastEntry = messages.length > 0 ? messages[messages.length - 1] : undefined;
  const lastTextLength = lastEntry?.text.length ?? 0;

  // Scroll to the end whenever a new entry is added or the last (currently
  // streaming) entry's text grows. We always pin the scroll to the latest
  // message; consumers that need scroll-position preservation should compose
  // their own list using `useAgent()` directly.
  useEffect(() => {
    if (messages.length === 0) return;
    virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
  }, [messages.length, lastTextLength, virtualizer]);

  const totalSize = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();
  const rootClass = ['mast-message-list', className].filter(Boolean).join(' ');

  return (
    <div ref={scrollRef} data-mast-message-list className={rootClass} role="log" aria-live="polite">
      <div style={{ height: `${totalSize}px`, position: 'relative', width: '100%' }}>
        {virtualItems.map((item) => {
          const entry = messages[item.index];
          return (
            <div
              key={entry.id}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              }}
            >
              <MessageItem
                entry={entry}
                renderToolCall={renderToolCall}
                renderApproval={renderApproval}
                renderMessage={renderMessage}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
