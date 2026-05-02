// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useIcons } from '../icons';
import type { ToolEventEntry } from '../types';
import { ThinkingBlock } from './ThinkingBlock';

/**
 * Props accepted by {@link ToolCallBlock}.
 */
export interface ToolCallBlockProps {
  /** The tool invocation to render. */
  entry: ToolEventEntry;
  /** Optional class added to the root element. */
  className?: string;
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
 * Args/result expand/collapse uses native `<details>/<summary>` so the
 * component is keyboard-accessible without JavaScript.
 */
export function ToolCallBlock({ entry, className }: ToolCallBlockProps) {
  const icons = useIcons();
  const rootClass = ['mast-tool-call-block', className].filter(Boolean).join(' ');
  const hasSubAgentOutput = entry.subThinking !== undefined || entry.subText !== undefined;
  const statusIcon = entry.isStreaming ? icons.loader : icons.check;
  const argsText = formatJson(entry.args);
  const resultText = formatJson(entry.result);

  return (
    <div
      data-mast-tool-call-block
      data-streaming={entry.isStreaming ? 'true' : undefined}
      data-tool-name={entry.name}
      className={rootClass}
    >
      <div className="mast-tool-call-block-header">
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
      </div>

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
  );
}
