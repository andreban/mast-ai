// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useIcons } from '../icons.js';
import type { ToolEventEntry } from '../types.js';

/**
 * Props passed to a custom `renderApproval` slot and accepted by the
 * built-in {@link InlineApproval} component.
 */
export interface InlineApprovalProps {
  /** The tool call awaiting approval. */
  entry: ToolEventEntry;
  /** Approve the call; the underlying tool will execute. */
  approve: () => void;
  /**
   * Reject the call. With no argument the runner receives the default
   * cancelled result; with a string the runner receives that string as the
   * tool result. The UI marks the call as `'cancelled'` in both cases.
   */
  reject: (result?: string) => void;
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
 * Default UI rendered for tool calls awaiting an inline approval decision.
 *
 * Displays the tool name, formatted args, and Approve/Reject buttons. Used by
 * {@link AssistantMessage} when neither `renderApproval` nor `renderToolCall`
 * is provided; consumers can also import it directly to compose alongside a
 * custom `renderApproval` slot.
 */
export function InlineApproval({ entry, approve, reject, className }: InlineApprovalProps) {
  const icons = useIcons();
  const rootClass = ['mast-inline-approval', className].filter(Boolean).join(' ');
  const argsText = formatJson(entry.args);

  return (
    <div data-mast-inline-approval data-tool-name={entry.name} className={rootClass}>
      <div className="mast-inline-approval-header">
        <span className="mast-inline-approval-icon" aria-hidden="true">
          {icons.wrench}
        </span>
        <span className="mast-inline-approval-name">{entry.name}</span>
        <span className="mast-inline-approval-label">requires approval</span>
      </div>
      {argsText ? (
        <pre className="mast-inline-approval-args">
          <code>{argsText}</code>
        </pre>
      ) : null}
      <div className="mast-inline-approval-actions">
        <button
          type="button"
          className="mast-inline-approval-button mast-inline-approval-approve"
          onClick={approve}
        >
          Approve
        </button>
        <button
          type="button"
          className="mast-inline-approval-button mast-inline-approval-reject"
          onClick={() => reject()}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
