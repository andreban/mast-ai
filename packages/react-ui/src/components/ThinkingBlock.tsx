// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useIcons } from '../icons';

/**
 * Props accepted by {@link ThinkingBlock}.
 */
export interface ThinkingBlockProps {
  /** The accumulated thinking/reasoning text to display when expanded. */
  content: string;
  /**
   * `true` while the assistant is still streaming thinking deltas.
   * Drives a pulsing indicator next to the label.
   */
  isStreaming?: boolean;
  /** Optional class added to the root `<details>` element. */
  className?: string;
  /** Header label. Default: `'Thinking Process'`. */
  label?: string;
  /**
   * When provided, controls the `open` attribute on the root `<details>`
   * element. Useful for auto-expanding the block while streaming and letting
   * it collapse afterwards (e.g. inside `<ToolCallBlock>`). When omitted, the
   * block defaults to collapsed and is toggled by the user.
   */
  open?: boolean;
}

/**
 * Collapsible section for the agent's thinking/reasoning trace.
 *
 * Rendered as a native `<details>/<summary>` element so it is keyboard
 * accessible and works without JavaScript. Collapsed by default; consumers
 * can override the appearance via the default stylesheet's `mast-thinking-*`
 * classes or by passing a custom `className`.
 */
export function ThinkingBlock({
  content,
  isStreaming = false,
  className,
  label = 'Thinking Process',
  open,
}: ThinkingBlockProps) {
  const icons = useIcons();
  const rootClass = ['mast-thinking-block', className].filter(Boolean).join(' ');

  return (
    <details
      data-mast-thinking-block
      data-streaming={isStreaming ? 'true' : undefined}
      className={rootClass}
      open={open}
    >
      <summary className="mast-thinking-block-summary">
        <span className="mast-thinking-block-icon" aria-hidden="true">
          {icons.brain}
        </span>
        <span className="mast-thinking-block-label">{label}</span>
        {isStreaming ? (
          <span
            className="mast-thinking-block-pulse"
            data-testid="mast-thinking-pulse"
            aria-hidden="true"
          />
        ) : null}
      </summary>
      <div className="mast-thinking-block-content">{content}</div>
    </details>
  );
}
