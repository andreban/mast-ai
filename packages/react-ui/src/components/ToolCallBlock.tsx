// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { Fragment, useContext } from 'react';
import type { ReactNode } from 'react';

import { useIcons } from '../icons.js';
import type { ToolEventEntry } from '../types.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { NestedToolRenderContext, ToolLabelContext } from './ToolLabelContext.js';

/**
 * Props accepted by {@link ToolCallBlock}.
 */
export interface ToolCallBlockProps {
  /** The tool invocation to render. */
  entry: ToolEventEntry;
  /** Optional class added to the root element. */
  className?: string;
  /**
   * Controls whether the block body (sub-output, nested events, args, result)
   * is open by default. The header (status icon + tool name) is always
   * visible.
   *
   * - `'streaming'` (default): open while `entry.isStreaming` is `true`, then
   *   collapses on completion.
   * - `true`: open by default, regardless of streaming state.
   * - `false`: closed by default, regardless of streaming state.
   */
  defaultOpen?: boolean | 'streaming';
  /**
   * Overrides `entry.name` in the header. Useful for delegation-style tools
   * whose interesting label lives in the args (e.g. `delegate_to_skill` should
   * display the target skill's name, not the wrapper tool's name).
   *
   * Takes precedence over the `getToolLabel` resolver supplied via
   * `<AssistantMessage>` / `<MessageList>` / `<ConversationPanel>`. When
   * omitted, falls back to the resolver, then to `entry.name`.
   */
  label?: ReactNode;
}

function formatJson(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Displays a single tool invocation with live streaming of sub-agent output.
 *
 * The block itself is collapsible: the header (status icon + tool name) is the
 * click target and the body — sub-agent content blocks, sub-text, args, result
 * — collapses behind it. By default the block stays open while
 * `entry.isStreaming` is `true` and collapses on completion; pass
 * `defaultOpen={true}` or `defaultOpen={false}` to override.
 *
 * Rendering modes:
 *
 * - **Streaming** (`entry.isStreaming === true`): spinner icon next to the tool
 *   name; `nestedContentBlocks` (if any) render in source order — thinking
 *   blocks expand while streaming and nested tool calls appear at their
 *   original position relative to the thinking; if `subText` is present, it
 *   renders as live text below the nested content.
 * - **Completed** (`entry.isStreaming === false`): check mark icon; the
 *   sub-agent's content blocks remain visible but thinking blocks collapse by
 *   default; `result` is accessible inside a `<details>` element as formatted
 *   JSON.
 * - **Plain tool** (no `nestedContentBlocks` and no `subText`): the spinner-to-
 *   check transition plus collapsible `args` and `result`. No sub-agent slots
 *   are rendered.
 *
 * Each `ToolEventEntry` inside `nestedContentBlocks` is rendered through the
 * `NestedToolRenderContext` when the block is mounted under an
 * `<AssistantMessage>`, so an inline approval card surfaces on sub-agent tool
 * calls at any nesting depth. Standalone usage (no provider in scope) falls
 * back to a bare recursive `<ToolCallBlock>`.
 *
 * The outer block, args, and result expand/collapse all use native
 * `<details>/<summary>` so the component is keyboard-accessible without
 * JavaScript.
 */
function pickStatusIcon(entry: ToolCallBlockProps['entry'], icons: ReturnType<typeof useIcons>) {
  if (entry.isStreaming) return icons.loader;
  switch (entry.status) {
    case 'error':
      return icons.error;
    case 'cancelled':
      return icons.cancelled;
    default:
      return icons.check;
  }
}

function resolveOpen(
  defaultOpen: boolean | 'streaming',
  isStreaming: boolean,
): boolean | undefined {
  if (defaultOpen === 'streaming') return isStreaming ? true : undefined;
  return defaultOpen;
}

export function ToolCallBlock({
  entry,
  className,
  defaultOpen = 'streaming',
  label,
}: ToolCallBlockProps) {
  const icons = useIcons();
  const getToolLabel = useContext(ToolLabelContext);
  const renderNested = useContext(NestedToolRenderContext);
  const rootClass = ['mast-tool-call-block', className].filter(Boolean).join(' ');
  const nestedContentBlocks = entry.nestedContentBlocks ?? [];
  const lastBlockIndex = nestedContentBlocks.length - 1;
  const statusIcon = pickStatusIcon(entry, icons);
  const argsText = formatJson(entry.args);
  const resultText = formatJson(entry.result);
  const open = resolveOpen(defaultOpen, entry.isStreaming);
  const resolvedLabel = label ?? getToolLabel?.(entry) ?? entry.name;

  return (
    <details
      data-mast-tool-call-block
      data-streaming={entry.isStreaming ? 'true' : undefined}
      data-status={entry.status}
      data-tool-name={entry.name}
      className={rootClass}
      open={open}
    >
      <summary className="mast-tool-call-block-header">
        <span className="mast-tool-call-block-chevron" aria-hidden="true">
          ▸
        </span>
        <span
          className="mast-tool-call-block-status"
          data-testid="mast-tool-call-status"
          aria-hidden="true"
        >
          {statusIcon}
        </span>
        <span className="mast-tool-call-block-wrench" aria-hidden="true">
          {icons.wrench}
        </span>
        <span className="mast-tool-call-block-name">{resolvedLabel}</span>
      </summary>

      <div className="mast-tool-call-block-body">
        {nestedContentBlocks.length > 0 ? (
          <div className="mast-tool-call-block-nested" data-testid="mast-tool-call-nested">
            {nestedContentBlocks.map((block, i) => {
              if (block.type === 'thinking') {
                // Only the trailing thinking block of a still-streaming parent
                // is actively growing — earlier ones are fixed.
                const isLast = i === lastBlockIndex;
                return (
                  <ThinkingBlock
                    key={block.id}
                    content={block.content}
                    isStreaming={entry.isStreaming && isLast}
                    className="mast-tool-call-block-sub-thinking"
                    open={entry.isStreaming && isLast ? true : undefined}
                  />
                );
              }
              return renderNested ? (
                <Fragment key={block.id}>{renderNested(block)}</Fragment>
              ) : (
                <ToolCallBlock key={block.id} entry={block} />
              );
            })}
          </div>
        ) : null}

        {entry.subText !== undefined ? (
          <div className="mast-tool-call-block-sub-text" data-testid="mast-tool-call-sub-text">
            {entry.subText}
          </div>
        ) : null}

        {argsText ? (
          <details className="mast-tool-call-block-args">
            <summary>Arguments</summary>
            <pre className="mast-tool-call-block-pre">
              <code>{argsText}</code>
            </pre>
          </details>
        ) : null}

        {!entry.isStreaming && resultText ? (
          <details className="mast-tool-call-block-result">
            <summary>Result</summary>
            <pre className="mast-tool-call-block-pre">
              <code>{resultText}</code>
            </pre>
          </details>
        ) : null}
      </div>
    </details>
  );
}
