// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { Fragment, Suspense, lazy } from 'react';
import type { ReactNode } from 'react';

import type { ConversationEntry, ToolEventEntry } from '../types';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallBlock } from './ToolCallBlock';

/**
 * Props accepted by {@link AssistantMessage}.
 */
export interface AssistantMessageProps {
  /** The conversation entry to render. Must have `role === 'assistant'`. */
  entry: ConversationEntry;
  /** Optional class added to the root element. */
  className?: string;
  /**
   * Replaces the default text renderer. When provided, takes precedence over
   * the optional `react-markdown` integration and is invoked for every
   * non-empty `entry.text`.
   */
  renderMessage?: (text: string) => ReactNode;
  /**
   * Replaces the default {@link ToolCallBlock} renderer. Called once per
   * element of `entry.toolEvents`.
   */
  renderToolCall?: (entry: ToolEventEntry) => ReactNode;
}

interface MarkdownTextProps {
  children: string;
}

/**
 * Resolves to a markdown renderer when `react-markdown`, `remark-gfm` and
 * `rehype-sanitize` are installed in the consuming app. If any of the optional
 * peer dependencies are missing the lazy module falls back to a plain
 * `<p>` so the assistant text still renders.
 *
 * Sanitisation via `rehype-sanitize` is always applied — the library does not
 * expose a way to disable it. Apps that need unrestricted HTML should provide
 * a `renderMessage` override instead.
 */
const MarkdownText = lazy<(props: MarkdownTextProps) => ReactNode>(async () => {
  try {
    const [{ default: ReactMarkdown }, { default: remarkGfm }, { default: rehypeSanitize }] =
      await Promise.all([
        import('react-markdown'),
        import('remark-gfm'),
        import('rehype-sanitize'),
      ]);
    return {
      default: ({ children }: MarkdownTextProps) => (
        <div className="mast-assistant-message-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
            {children}
          </ReactMarkdown>
        </div>
      ),
    };
  } catch {
    return {
      default: ({ children }: MarkdownTextProps) => (
        <p className="mast-assistant-message-text">{children}</p>
      ),
    };
  }
});

/**
 * Renders an assistant turn: an optional {@link ThinkingBlock}, zero or more
 * {@link ToolCallBlock}s, then the final text.
 *
 * Final text is rendered with `react-markdown` (sanitised via
 * `rehype-sanitize`) when the optional peer dependencies are installed; it
 * falls back to a plain `<p>` otherwise. Apps may override either layer via
 * `renderMessage` (the entire text region) or `renderToolCall` (each tool
 * invocation) without losing the surrounding wiring.
 */
export function AssistantMessage({
  entry,
  className,
  renderMessage,
  renderToolCall,
}: AssistantMessageProps) {
  const rootClass = ['mast-assistant-message', className].filter(Boolean).join(' ');

  return (
    <div
      data-mast-assistant-message
      data-streaming={entry.isStreaming ? 'true' : undefined}
      className={rootClass}
    >
      {entry.thinking ? (
        <ThinkingBlock content={entry.thinking} isStreaming={entry.isStreaming} />
      ) : null}
      {entry.toolEvents.map((toolEvent, index) => {
        const key = `${toolEvent.name}-${index}`;
        if (renderToolCall) {
          return <Fragment key={key}>{renderToolCall(toolEvent)}</Fragment>;
        }
        return <ToolCallBlock key={key} entry={toolEvent} />;
      })}
      {entry.text ? (
        renderMessage ? (
          renderMessage(entry.text)
        ) : (
          <Suspense fallback={<p className="mast-assistant-message-text">{entry.text}</p>}>
            <MarkdownText>{entry.text}</MarkdownText>
          </Suspense>
        )
      ) : null}
    </div>
  );
}
