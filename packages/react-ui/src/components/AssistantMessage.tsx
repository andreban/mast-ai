// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { Fragment, Suspense, lazy } from 'react';
import type { ReactNode } from 'react';

import { useAgent } from '../context.js';
import type { PendingApproval } from '../approval.js';
import type { ConversationEntry, ToolEventEntry } from '../types.js';
import { InlineApproval } from './InlineApproval.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { ToolCallBlock } from './ToolCallBlock.js';
import { ToolLabelContext, type GetToolLabel } from './ToolLabelContext.js';

/**
 * Slot for replacing only the inline approval card while keeping the default
 * `<ToolCallBlock>` rendering for non-approval tool events. Receives the
 * matching {@link ToolEventEntry} and the live {@link PendingApproval} handle
 * exposing `approve()`, `reject()`, and `respondWith()`.
 */
export type RenderApproval = (entry: ToolEventEntry, approval: PendingApproval) => ReactNode;

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
   * Replaces the default tool-call renderer. Called once per element of
   * `entry.toolEvents`.
   *
   * Receives the tool event and, when the call is awaiting an inline
   * approval decision, a {@link PendingApproval} handle exposing
   * `approve()`, `reject()`, and `respondWith()`. Consumers can dispatch on
   * tool name, and use the bundled `<InlineApproval>` or `<ToolCallBlock>`
   * components as building blocks.
   *
   * When this prop is omitted, the library defaults to rendering
   * `<InlineApproval>` for tool events with a pending approval handle and
   * `<ToolCallBlock>` otherwise.
   *
   * Takes a back seat to {@link AssistantMessageProps.renderApproval} when
   * both are provided and the entry has a pending approval handle.
   */
  renderToolCall?: (entry: ToolEventEntry, approval?: PendingApproval) => ReactNode;
  /**
   * Replaces only the inline approval card. Called once per tool event whose
   * call is awaiting an inline approval decision (i.e. has a matching
   * {@link PendingApproval} handle); non-approval tool events fall through to
   * `renderToolCall` or the default `<ToolCallBlock>`.
   *
   * Use this slot to customise the approval prompt without rebuilding the
   * tool-call rendering for every other event. Takes precedence over
   * `renderToolCall` for entries with a pending approval handle when both
   * are provided.
   */
  renderApproval?: RenderApproval;
  /**
   * Resolves the header label for each {@link ToolEventEntry} rendered inside
   * this message. Forwarded via context to every nested `<ToolCallBlock>`,
   * including those rendered for sub-agent tool calls.
   *
   * Use this for the common case of relabelling delegation-style tools (e.g.
   * `delegate_to_skill` showing the target skill's name) without needing to
   * write a custom `renderToolCall` purely to override `entry.name`.
   *
   * Resolution order inside `<ToolCallBlock>`: explicit `label` prop, then this
   * resolver, then `entry.name`. Returning `undefined` or `null` from the
   * resolver lets the block fall back to `entry.name` for that specific entry,
   * which is useful for selectively overriding only a subset of tool names.
   */
  getToolLabel?: GetToolLabel;
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
  renderApproval,
  getToolLabel,
}: AssistantMessageProps) {
  const rootClass = ['mast-assistant-message', className].filter(Boolean).join(' ');
  const { pendingApprovals } = useAgent();

  const renderToolEvent = (toolEvent: ToolEventEntry): ReactNode => {
    // Resolve the matching pending-approval handle when the call is awaiting
    // an inline decision. Without a handle (e.g. the consumer returned a
    // boolean directly from `onApprovalRequired`) the default and custom
    // renderers both see `undefined` and fall through to the standard tool
    // call rendering.
    const approval = toolEvent.awaitingApproval
      ? pendingApprovals.find((p) => p.toolName === toolEvent.name)
      : undefined;

    if (approval && renderApproval) return renderApproval(toolEvent, approval);
    if (renderToolCall) return renderToolCall(toolEvent, approval);

    if (approval) {
      return (
        <InlineApproval
          entry={toolEvent}
          approve={approval.approve}
          reject={approval.reject}
          respondWith={approval.respondWith}
        />
      );
    }
    return <ToolCallBlock entry={toolEvent} />;
  };

  return (
    <ToolLabelContext.Provider value={getToolLabel}>
      <div
        data-mast-assistant-message
        data-streaming={entry.isStreaming ? 'true' : undefined}
        className={rootClass}
      >
        {entry.contentBlocks.map((block, index) => {
          const isLastBlock = index === entry.contentBlocks.length - 1;
          if (block.type === 'thinking') {
            return (
              <ThinkingBlock
                key={block.id}
                content={block.content}
                isStreaming={entry.isStreaming && isLastBlock}
              />
            );
          }
          return <Fragment key={`${block.id}-${index}`}>{renderToolEvent(block)}</Fragment>;
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
    </ToolLabelContext.Provider>
  );
}
