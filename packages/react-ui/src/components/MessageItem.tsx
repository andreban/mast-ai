// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react';

import type { PendingApproval } from '../approval.js';
import type { ConversationEntry, ToolEventEntry } from '../types.js';
import { AssistantMessage, type RenderApproval } from './AssistantMessage.js';
import { UserMessage } from './UserMessage.js';

/**
 * Props accepted by {@link MessageItem}.
 */
export interface MessageItemProps {
  /** The conversation entry to render. */
  entry: ConversationEntry;
  /** Optional class added to the inner message component. */
  className?: string;
  /**
   * Forwarded to {@link AssistantMessage}. Has no effect when `entry.role` is
   * `'user'`.
   */
  renderToolCall?: (entry: ToolEventEntry, approval?: PendingApproval) => ReactNode;
  /**
   * Forwarded to {@link AssistantMessage}. Has no effect when `entry.role` is
   * `'user'`.
   */
  renderApproval?: RenderApproval;
  /**
   * Forwarded to {@link AssistantMessage}. Has no effect when `entry.role` is
   * `'user'`.
   */
  renderMessage?: (text: string) => ReactNode;
}

/**
 * Renders a single {@link ConversationEntry} by dispatching to
 * {@link UserMessage} or {@link AssistantMessage} based on `entry.role`.
 *
 * Used by {@link MessageList} to render each virtualised row.
 */
export function MessageItem({
  entry,
  className,
  renderToolCall,
  renderApproval,
  renderMessage,
}: MessageItemProps) {
  if (entry.role === 'user') {
    return <UserMessage entry={entry} className={className} />;
  }
  return (
    <AssistantMessage
      entry={entry}
      className={className}
      renderToolCall={renderToolCall}
      renderApproval={renderApproval}
      renderMessage={renderMessage}
    />
  );
}
