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
import type { GetToolLabel } from './ToolLabelContext.js';

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
  /**
   * Forwarded to each {@link MessageItem} so consumers can override the
   * `<ToolCallBlock>` header label for the entire list. The resolver is read
   * via context inside `<ToolCallBlock>`, so it also applies to nested
   * sub-agent tool calls.
   *
   * Returning `undefined` or `null` for a given entry falls back to
   * `entry.name`, which is useful for selectively overriding only a subset of
   * tool names.
   */
  getToolLabel?: GetToolLabel;
}

/**
 * Estimated height (in pixels) used by the virtualizer before an item has been
 * measured. The real height is then captured via `measureElement` on first
 * render of each row, so any reasonable value works — this just keeps initial
 * scroll offsets sensible while the first paint resolves.
 */
const DEFAULT_ESTIMATED_ITEM_HEIGHT = 80;

/**
 * Pixel slack for re-engaging stickiness when the user manually scrolls back
 * to the bottom. Kept tight so a programmatic snap-to-bottom does not
 * accidentally re-capture a user who just scrolled away.
 */
const STICKY_REENGAGE_THRESHOLD_PX = 4;

/**
 * Minimum scrollTop decrease (between two consecutive scroll events) treated
 * as a user-initiated upward scroll. Programmatic scroll-to-bottom only ever
 * increases scrollTop within a stable measurement, so any non-trivial decrease
 * is the user (scrollbar drag, keyboard, etc.). The threshold absorbs
 * sub-pixel measurement noise.
 */
const STICKY_DIRECTION_THRESHOLD_PX = 4;

/**
 * Scrollable list of {@link ConversationEntry} items rendered with
 * `@tanstack/react-virtual`.
 *
 * Only the visible window of messages is mounted, so long-running conversations
 * stay performant. Item heights are dynamic: each rendered row is observed via
 * `virtualizer.measureElement`, so messages with long tool call results or
 * large markdown blocks expand the viewport correctly.
 *
 * Auto-scrolls to the bottom whenever the content grows (new entry, streaming
 * text deltas, thinking/tool blocks expanding) **only if** the user is already
 * at the bottom of the list. If the user has scrolled up to read an earlier
 * message, their scroll position is preserved until they scroll back down.
 *
 * Reads `messages` from `useAgent()`, so this component must be rendered
 * inside an `<AgentProvider>`.
 */
export function MessageList({
  className,
  renderToolCall,
  renderApproval,
  renderMessage,
  getToolLabel,
}: MessageListProps) {
  const { messages } = useAgent();
  const scrollRef = useRef<HTMLDivElement>(null);
  // True while the auto-scroll-to-bottom behaviour is active. Released by
  // user input that scrolls up (wheel, touch, scrollbar drag); re-engaged
  // when the user manually scrolls back to the bottom. Initialized to `true`
  // so the first render still pins to the latest entry.
  const isPinnedRef = useRef(true);
  // Last observed scrollTop, used by the scroll listener to detect
  // user-driven upward scrolls that produce a `scroll` event but no `wheel`
  // or `touchmove` (e.g. scrollbar drag).
  const lastScrollTopRef = useRef(0);
  // ScrollTop value left by the most recent auto-pin scrollToIndex. The next
  // auto-pin compares against this to detect any user-driven scroll-up since
  // the last pin, even if every event listener missed it. `null` until the
  // first auto-pin runs.
  const lastPinnedScrollTopRef = useRef<number | null>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DEFAULT_ESTIMATED_ITEM_HEIGHT,
    overscan: 4,
  });

  // Track scroll position and user input to drive the pin state machine.
  //
  // Release rules (true → false):
  //   - `wheel` with deltaY < 0           — synchronous user intent to scroll up
  //   - `touchmove` with finger down      — synchronous user intent to scroll up
  //   - `scroll` with scrollTop decrease  — user dragged the scrollbar / keyboard
  //
  // Re-engage rule (false → true):
  //   - `scroll` while NOT pinned with distance ≤ STICKY_REENGAGE_THRESHOLD_PX
  //
  // When already pinned, the `scroll` listener does NOT touch the flag. That
  // is the key fix for the rapid-streaming race: without it, every
  // programmatic `scrollToIndex` would fire a scroll event that re-set the
  // flag back to `true`, immediately overriding any wheel-up the user just
  // performed.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    lastScrollTopRef.current = el.scrollTop;

    const onScroll = () => {
      const current = el.scrollTop;
      const previous = lastScrollTopRef.current;
      lastScrollTopRef.current = current;
      const distance = el.scrollHeight - current - el.clientHeight;

      if (current < previous - STICKY_DIRECTION_THRESHOLD_PX) {
        isPinnedRef.current = false;
      } else if (!isPinnedRef.current && distance <= STICKY_REENGAGE_THRESHOLD_PX) {
        isPinnedRef.current = true;
      }
    };

    // Wheel and touchmove fire synchronously with user input, before the
    // browser commits the scroll. Releasing the pin here wins the race
    // against rapid streaming `scrollToIndex` calls that would otherwise
    // reset scrollTop before our `scroll` listener could observe the
    // user's upward movement.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && el.scrollHeight > el.clientHeight) {
        isPinnedRef.current = false;
      }
    };

    let touchStartY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (touchStartY === null) return;
      const dy = (e.touches[0]?.clientY ?? touchStartY) - touchStartY;
      // Finger moving down the screen reveals content above = user is
      // scrolling up.
      if (dy > 0 && el.scrollHeight > el.clientHeight) {
        isPinnedRef.current = false;
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  const lastEntry = messages.length > 0 ? messages[messages.length - 1] : undefined;
  const lastTextLength = lastEntry?.text.length ?? 0;
  const totalSize = virtualizer.getTotalSize();

  // Pin the scroll to the latest message whenever the content grows, but only
  // when the user is already at the bottom. `totalSize` is included as a
  // dependency so dynamic height changes (thinking/tool blocks expanding,
  // sub-agent text streaming, item remeasurement) also re-pin without
  // requiring a change in the message list itself.
  //
  // Before scrolling, this effect cross-checks `el.scrollTop` against the
  // value left by the previous auto-pin. If it has decreased, the user has
  // scrolled up since the last pin (programmatic scrollToIndex never lowers
  // scrollTop within a stable measurement). Release the pin and bail. This
  // is the authoritative safety net: even if a `wheel` handler missed an
  // event or a `scroll` event got coalesced with a programmatic scroll, the
  // user's actual scrollTop tells the truth.
  useEffect(() => {
    if (messages.length === 0) return;
    if (!isPinnedRef.current) return;

    const el = scrollRef.current;
    if (
      el &&
      lastPinnedScrollTopRef.current !== null &&
      el.scrollTop < lastPinnedScrollTopRef.current - STICKY_DIRECTION_THRESHOLD_PX
    ) {
      isPinnedRef.current = false;
      return;
    }

    virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    if (el) lastPinnedScrollTopRef.current = el.scrollTop;
  }, [messages.length, lastTextLength, totalSize, virtualizer]);

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
                getToolLabel={getToolLabel}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
