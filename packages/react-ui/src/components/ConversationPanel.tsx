// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react';

import type { PendingApproval } from '../approval.js';
import type { MentionsConfig } from '../mentions/types.js';
import type { ToolEventEntry } from '../types.js';
import type { RenderApproval } from './AssistantMessage.js';
import { ChatInput } from './ChatInput.js';
import { MessageList } from './MessageList.js';
import type { GetToolLabel } from './ToolLabelContext.js';

/**
 * Props accepted by {@link ConversationPanel}.
 */
export interface ConversationPanelProps {
  /**
   * Selects the panel's theme. Defaults to `'light'`. Pass `'dark'` to force
   * the dark palette regardless of OS preference, or `'auto'` to follow the
   * user's `prefers-color-scheme` setting.
   */
  theme?: 'light' | 'dark' | 'auto';
  /** Optional class added to the root `[data-mast-root]` element. */
  className?: string;
  /**
   * Replaces the default tool-call renderer for the entire list. Receives a
   * {@link PendingApproval} handle as the second argument when the call is
   * awaiting an inline approval decision.
   */
  renderToolCall?: (entry: ToolEventEntry, approval?: PendingApproval) => ReactNode;
  /**
   * Replaces only the inline approval card. Use this slot to customise the
   * approval prompt without rebuilding the rest of the tool-call rendering.
   * Takes precedence over `renderToolCall` for entries with a pending
   * approval handle when both are provided.
   */
  renderApproval?: RenderApproval;
  /** Replaces the default assistant text renderer for the entire list. */
  renderMessage?: (text: string) => ReactNode;
  /**
   * Overrides the `<ToolCallBlock>` header label for the entire list. The
   * resolver flows via context so it also applies to nested sub-agent tool
   * calls. Returning `undefined` or `null` for a given entry falls back to
   * `entry.name`.
   *
   * Common use case: relabelling delegation-style tools (e.g.
   * `delegate_to_skill` showing the target skill's name).
   */
  getToolLabel?: GetToolLabel;
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
 * resolve. The same div carries `mast-panel` so the bundled chrome (border,
 * padding, flex column, `height: 100%`) is applied; consumers composing
 * primitives manually opt into chrome by adding the class themselves (see
 * USAGE.md §8). `data-mast-theme` is set from the optional `theme` prop;
 * the default stylesheet uses it to select between light, dark, and an
 * OS-following auto mode.
 *
 * Must be rendered inside an `<AgentProvider>`.
 */
export function ConversationPanel({
  theme,
  className,
  renderToolCall,
  renderApproval,
  renderMessage,
  getToolLabel,
  inputPlaceholder,
  mentions,
}: ConversationPanelProps) {
  const rootClass = ['mast-panel', 'mast-conversation-panel', className].filter(Boolean).join(' ');

  return (
    <div data-mast-root data-mast-theme={theme} className={rootClass}>
      <MessageList
        renderToolCall={renderToolCall}
        renderApproval={renderApproval}
        renderMessage={renderMessage}
        getToolLabel={getToolLabel}
      />
      <ChatInput placeholder={inputPlaceholder} mentions={mentions} />
    </div>
  );
}
