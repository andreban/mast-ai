// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react';

import type { PendingApproval } from '../approval';
import type { MentionsConfig } from '../mentions/types';
import type { ToolEventEntry } from '../types';
import { ChatInput } from './ChatInput';
import { MessageList } from './MessageList';

/**
 * Props accepted by {@link ConversationPanel}.
 */
export interface ConversationPanelProps {
  /**
   * Forces a theme regardless of the user's `prefers-color-scheme` setting.
   * When omitted, the panel follows the OS preference via the default
   * stylesheet's media query.
   */
  theme?: 'light' | 'dark';
  /** Optional class added to the root `[data-mast-root]` element. */
  className?: string;
  /**
   * Replaces the default tool-call renderer for the entire list. Receives a
   * {@link PendingApproval} handle as the second argument when the call is
   * awaiting an inline approval decision.
   */
  renderToolCall?: (entry: ToolEventEntry, approval?: PendingApproval) => ReactNode;
  /** Replaces the default assistant text renderer for the entire list. */
  renderMessage?: (text: string) => ReactNode;
  /** Placeholder text for the {@link ChatInput} field. */
  inputPlaceholder?: string;
  /**
   * Forwarded to the internal {@link ChatInput} when the optional `@`-mention
   * picker should be enabled. Omit to keep the plain textarea behaviour.
   */
  mentions?: MentionsConfig;
}

/**
 * Renders a complete chat UI as a single composable unit.
 *
 * Internally renders {@link MessageList} and {@link ChatInput} inside a
 * `[data-mast-root]` div so the default stylesheet's CSS custom properties
 * resolve. Sets `data-mast-theme` from the optional `theme` prop, which the
 * default stylesheet uses to override the OS-driven dark mode preference.
 *
 * Must be rendered inside an `<AgentProvider>`.
 */
export function ConversationPanel({
  theme,
  className,
  renderToolCall,
  renderMessage,
  inputPlaceholder,
  mentions,
}: ConversationPanelProps) {
  const rootClass = ['mast-conversation-panel', className].filter(Boolean).join(' ');

  return (
    <div data-mast-root data-mast-theme={theme} className={rootClass}>
      <MessageList renderToolCall={renderToolCall} renderMessage={renderMessage} />
      <ChatInput placeholder={inputPlaceholder} mentions={mentions} />
    </div>
  );
}
