// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { useAgent } from '../context';
import { useIcons } from '../icons';

/**
 * Props accepted by {@link ChatInput}.
 */
export interface ChatInputProps {
  /** Optional class added to the root element. */
  className?: string;
  /** Placeholder text shown in the empty textarea. */
  placeholder?: string;
  /** Overrides the default send button content (the `send` icon). */
  sendLabel?: ReactNode;
  /** Overrides the default cancel button content (the `stop` icon). */
  cancelLabel?: ReactNode;
}

const MIN_ROWS = 1;
const MAX_ROWS = 8;

/**
 * Counts the number of rows the textarea should display for the given text.
 *
 * Uses the line count of the input clamped between {@link MIN_ROWS} and
 * {@link MAX_ROWS} so the textarea grows with content but does not push the
 * conversation off-screen on very long drafts.
 */
function rowsForText(text: string): number {
  const lineCount = text.split('\n').length;
  return Math.min(MAX_ROWS, Math.max(MIN_ROWS, lineCount));
}

/**
 * Text input wired to {@link useAgent}.
 *
 * - Pressing Enter submits the message; Shift+Enter inserts a newline.
 * - The textarea grows vertically with content (via the `rows` attribute).
 * - While a run is in progress the send button is replaced by a cancel button
 *   that calls `cancel()`. The textarea itself is disabled during the run so
 *   the user cannot edit while the agent streams.
 * - Send and cancel slot their content from `useIcons().send` / `.stop` by
 *   default; consumers can override either via the `sendLabel` / `cancelLabel`
 *   props without giving up the surrounding accessibility wiring.
 */
export function ChatInput({
  className,
  placeholder = 'Type a message and press Enter.',
  sendLabel,
  cancelLabel,
}: ChatInputProps) {
  const { sendMessage, cancel, isRunning } = useAgent();
  const icons = useIcons();
  const [value, setValue] = useState('');

  const rootClass = ['mast-chat-input', className].filter(Boolean).join(' ');
  const trimmed = value.trim();
  const canSend = !isRunning && trimmed.length > 0;

  const submit = () => {
    if (!canSend) return;
    sendMessage(trimmed);
    setValue('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      data-mast-chat-input
      className={rootClass}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="mast-chat-input-label mast-visually-hidden" htmlFor="mast-chat-input-field">
        Message
      </label>
      <textarea
        id="mast-chat-input-field"
        className="mast-chat-input-textarea"
        value={value}
        placeholder={placeholder}
        rows={rowsForText(value)}
        disabled={isRunning}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {isRunning ? (
        <button
          type="button"
          className="mast-chat-input-cancel"
          aria-label="Cancel"
          onClick={cancel}
        >
          {cancelLabel ?? icons.stop}
        </button>
      ) : (
        <button
          type="submit"
          className="mast-chat-input-send"
          aria-label="Send"
          disabled={!canSend}
        >
          {sendLabel ?? icons.send}
        </button>
      )}
    </form>
  );
}
