// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useIcons } from '../icons.js';
import type { ToolEventEntry } from '../types.js';
import { ThinkingBlock } from './ThinkingBlock.js';

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
 * click target and the body — sub-output, nested events, args, result —
 * collapses behind it. By default the block stays open while
 * `entry.isStreaming` is `true` and collapses on completion; pass
 * `defaultOpen={true}` or `defaultOpen={false}` to override.
 *
 * Three rendering modes:
 *
 * - **Streaming** (`entry.isStreaming === true`): spinner icon next to the
 *   tool name; if `subThinking` is present, it renders inside a `<ThinkingBlock>`
 *   that auto-expands while streaming; if `subText` is present, it renders as
 *   live text below.
 * - **Completed** (`entry.isStreaming === false`): check mark icon; sub-agent
 *   output (if any) remains visible but collapsed by default; `result` is
 *   accessible inside a `<details>` element as formatted JSON.
 * - **Plain tool** (no `subThinking` and no `subText`): the spinner-to-check
 *   transition plus collapsible `args` and `result`. No sub-agent slots are
 *   rendered.
 *
 * When `entry.nestedToolEvents` is non-empty, each nested tool call is rendered
 * recursively inside the parent block so a sub-agent's tool calls appear
 * indented beneath the sub-agent's narration.
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

export function ToolCallBlock({ entry, className, defaultOpen = 'streaming' }: ToolCallBlockProps) {
  const icons = useIcons();
  const rootClass = ['mast-tool-call-block', className].filter(Boolean).join(' ');
  const hasSubAgentOutput = entry.subThinking !== undefined || entry.subText !== undefined;
  const nestedToolEvents = entry.nestedToolEvents ?? [];
  const statusIcon = pickStatusIcon(entry, icons);
  const argsText = formatJson(entry.args);
  const resultText = formatJson(entry.result);
  const open = resolveOpen(defaultOpen, entry.isStreaming);

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
        <span className="mast-tool-call-block-name">{entry.name}</span>
      </summary>

      <div className="mast-tool-call-block-body">
        {hasSubAgentOutput ? (
          <div className="mast-tool-call-block-sub-output">
            {entry.subThinking !== undefined ? (
              <ThinkingBlock
                content={entry.subThinking}
                isStreaming={entry.isStreaming}
                className="mast-tool-call-block-sub-thinking"
                open={entry.isStreaming ? true : undefined}
              />
            ) : null}
            {entry.subText !== undefined ? (
              <div className="mast-tool-call-block-sub-text" data-testid="mast-tool-call-sub-text">
                {entry.subText}
              </div>
            ) : null}
          </div>
        ) : null}

        {nestedToolEvents.length > 0 ? (
          <div className="mast-tool-call-block-nested" data-testid="mast-tool-call-nested">
            {nestedToolEvents.map((nested) => (
              <ToolCallBlock key={nested.id} entry={nested} />
            ))}
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
