// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { Fragment, useId, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { useAgent } from '../context.js';
import { useIcons } from '../icons.js';
import { MentionPicker } from '../mentions/MentionPicker.js';
import { useMentions } from '../mentions/useMentions.js';
import type { MentionsConfig } from '../mentions/types.js';

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
  /**
   * Opt-in `@`-mention picker. When supplied, the textarea is wrapped in a
   * compound input that renders inline chips for committed selections and
   * shows a keyboard-navigable picker while the user types `@<query>`. On
   * submit, the input calls `sendMessage(prompt, displayText)` so the user
   * bubble shows the chip form while the LLM receives the augmented prompt
   * (from `mentions.buildPrompt` if provided, otherwise the inline text).
   *
   * Omit to keep the plain textarea behaviour unchanged.
   */
  mentions?: MentionsConfig;
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
 * - Pass `mentions` to enable the optional `@`-mention picker; see the
 *   `mentions` package directory for the full API.
 */
export function ChatInput({
  className,
  placeholder = 'Type a message and press Enter.',
  sendLabel,
  cancelLabel,
  mentions,
}: ChatInputProps) {
  if (mentions) {
    return (
      <MentionsChatInput
        className={className}
        placeholder={placeholder}
        sendLabel={sendLabel}
        cancelLabel={cancelLabel}
        mentions={mentions}
      />
    );
  }
  return (
    <PlainChatInput
      className={className}
      placeholder={placeholder}
      sendLabel={sendLabel}
      cancelLabel={cancelLabel}
    />
  );
}

interface PlainChatInputProps {
  className?: string;
  placeholder: string;
  sendLabel?: ReactNode;
  cancelLabel?: ReactNode;
}

function PlainChatInput({ className, placeholder, sendLabel, cancelLabel }: PlainChatInputProps) {
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

interface MentionsChatInputProps extends PlainChatInputProps {
  mentions: MentionsConfig;
}

/**
 * Compound input variant rendered when `<ChatInput mentions>` is set.
 *
 * Layout: chips and the textarea share a single bordered surface so the
 * inline form reads as one continuous field; the picker floats above on
 * `position: absolute` while a query is in progress.
 *
 * Submit calls `sendMessage(prompt, displayText)` — the LLM sees `prompt`
 * (from `buildPrompt` if provided, otherwise the inline form) while the
 * user bubble renders `displayText` (always the inline form).
 */
function MentionsChatInput({
  className,
  placeholder,
  sendLabel,
  cancelLabel,
  mentions,
}: MentionsChatInputProps) {
  const { sendMessage, cancel, isRunning } = useAgent();
  const icons = useIcons();
  const pickerIdPrefix = useId();
  const {
    segments,
    trailingInput,
    mentionQuery,
    filteredItems,
    pickerIndex,
    setTrailingInput,
    handleKeyDown: handleMentionKeyDown,
    selectItem,
    removeChip,
    buildSubmission,
    clear,
  } = useMentions(mentions);

  const rootClass = ['mast-chat-input', 'mast-mention-input', className].filter(Boolean).join(' ');
  const hasContent = segments.length > 0 || trailingInput.trim().length > 0;
  const canSend = !isRunning && hasContent;
  const pickerOpen = mentionQuery !== null && filteredItems.length > 0;
  const activeId = pickerOpen ? `${pickerIdPrefix}-${pickerIndex}` : undefined;

  const submit = () => {
    if (!canSend) return;
    const { prompt, displayText } = buildSubmission();
    if (!displayText.trim()) return;
    sendMessage(prompt, displayText);
    clear();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (handleMentionKeyDown(event)) return;
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
      <div className="mast-mention-input-field">
        {pickerOpen && (
          <MentionPicker
            items={filteredItems}
            activeIndex={pickerIndex}
            onSelect={selectItem}
            idPrefix={pickerIdPrefix}
            renderItem={mentions.renderItem}
          />
        )}
        <div className="mast-mention-input-content">
          {segments.map((segment) => (
            <Fragment key={segment.item.id}>
              {segment.text && <span className="mast-mention-segment-text">{segment.text}</span>}
              {mentions.renderChip ? (
                mentions.renderChip(segment.item, () => removeChip(segment.item.id))
              ) : (
                <span className="mast-mention-chip">
                  @{segment.item.label}
                  <button
                    type="button"
                    className="mast-mention-chip-remove"
                    aria-label={`Remove reference to ${segment.item.label}`}
                    onClick={() => removeChip(segment.item.id)}
                  >
                    ×
                  </button>
                </span>
              )}
            </Fragment>
          ))}
          <textarea
            id="mast-chat-input-field"
            className="mast-chat-input-textarea mast-mention-input-textarea"
            value={trailingInput}
            placeholder={segments.length === 0 ? placeholder : ''}
            rows={rowsForText(trailingInput)}
            disabled={isRunning}
            onChange={(event) => setTrailingInput(event.target.value)}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-expanded={pickerOpen}
            aria-controls={pickerOpen ? `${pickerIdPrefix}-listbox` : undefined}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
          />
        </div>
      </div>
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
