// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolContext, ToolDefinition, ToolProvider } from '@mast-ai/core';
import type { ToolCallStatus, ToolEventEntry } from './types.js';

/**
 * Sentinel value returned from {@link OnApprovalRequired} to defer the
 * decision to the inline approval queue. The proxy enqueues a
 * {@link PendingApproval} handle on `useAgent().pendingApprovals` and waits
 * for the consumer (or the built-in `<InlineApproval>` slot) to call
 * `approve()`, `reject()`, or `respondWith(...)`.
 *
 * @example
 * ```tsx
 * onApprovalRequired={async (toolCall) => {
 *   if (toolCall.name === 'set_page_title') return INLINE_APPROVAL;
 *   return window.confirm(`Allow ${toolCall.name}?`);
 * }}
 * ```
 */
export const INLINE_APPROVAL: unique symbol = Symbol.for('@mast-ai/react-ui.INLINE_APPROVAL');

/**
 * Callback invoked by {@link AgentProvider} before executing a tool whose
 * effective approval policy is `true`. Apps render their own confirmation UI
 * inside this callback and resolve with one of:
 *
 * - `true` — proceed with the tool call as normal
 * - `false` — cancel; the runner receives a synthetic "user cancelled" result
 * - `string` — skip execution and inject the string directly as the tool result
 * - {@link INLINE_APPROVAL} — defer to the inline approval queue
 */
export type OnApprovalRequired = (
  toolCall: ToolEventEntry,
) => Promise<boolean | string | typeof INLINE_APPROVAL>;

/** Synthetic tool result returned when an approval resolves to `false`. */
export const APPROVAL_CANCELLED_RESULT = 'User cancelled the tool call.';

/**
 * A live handle for a tool call that is waiting on the inline approval queue.
 * The library exposes the current set via `useAgent().pendingApprovals` and
 * passes the matching handle into the `renderApproval` slot.
 */
export interface PendingApproval {
  /** Name of the tool awaiting approval. */
  toolName: string;
  /** Arguments the model passed to the tool. */
  args: unknown;
  /** Approve the call — proceed with normal tool execution. */
  approve: () => void;
  /** Reject the call — runner receives the synthetic cancelled result. */
  reject: () => void;
  /** Skip execution and inject `result` as the tool result. */
  respondWith: (result: string) => void;
}

/**
 * Computes the effective approval requirement for a tool given a list of
 * runtime overrides. Implements the rule from SPEC §9.3:
 *
 * ```
 * needsApproval = (def.requiresApproval || overrideSet.has(name)) && !suppressSet.has(name)
 * ```
 *
 * Names prefixed with `!` in `approvalOverride` suppress approval; unprefixed
 * names add it.
 */
export function computeNeedsApproval(
  def: ToolDefinition,
  approvalOverride: readonly string[] | undefined,
): boolean {
  let added = false;
  let suppressed = false;
  if (approvalOverride) {
    for (const entry of approvalOverride) {
      if (entry.startsWith('!')) {
        if (entry.slice(1) === def.name) suppressed = true;
      } else if (entry === def.name) {
        added = true;
      }
    }
  }
  return (def.requiresApproval === true || added) && !suppressed;
}

/** Hooks the proxy uses to drive React state during an approval. */
export interface ApprovalProxyHooks {
  /** Called with `true` when waiting starts and `false` when a decision is reached. */
  notifyAwaiting?: (name: string, awaiting: boolean) => void;
  /** Called when a decision sets the final tool-call status (e.g. cancelled). */
  setStatus?: (name: string, status: ToolCallStatus) => void;
  /**
   * Pushes a pending approval onto the queue and returns a promise that
   * resolves once the consumer calls `approve`, `reject`, or `respondWith`.
   */
  enqueueInline?: (toolName: string, args: unknown) => Promise<boolean | string>;
}

class ApprovalProxyTool implements Tool {
  constructor(
    private readonly inner: Tool,
    private readonly onApprovalRequired: OnApprovalRequired,
    private readonly hooks: ApprovalProxyHooks,
  ) {}

  definition(): ToolDefinition {
    return this.inner.definition();
  }

  async call(args: unknown, context: ToolContext): Promise<unknown> {
    const def = this.inner.definition();
    this.hooks.notifyAwaiting?.(def.name, true);
    let decision: boolean | string;
    try {
      const initial = await this.onApprovalRequired({
        id: '',
        type: 'tool_call_started',
        name: def.name,
        args,
        isStreaming: true,
      });
      if (initial === INLINE_APPROVAL) {
        if (!this.hooks.enqueueInline) {
          // No queue wired; treat as approved so the run does not deadlock.
          decision = true;
        } else {
          decision = await this.hooks.enqueueInline(def.name, args);
        }
      } else {
        decision = initial;
      }
    } finally {
      this.hooks.notifyAwaiting?.(def.name, false);
    }
    if (decision === false) {
      this.hooks.setStatus?.(def.name, 'cancelled');
      return APPROVAL_CANCELLED_RESULT;
    }
    if (typeof decision === 'string') return decision;
    return this.inner.call(args, context);
  }
}

/**
 * Wraps a {@link ToolProvider} so that tools whose effective approval flag is
 * `true` are intercepted: the wrapper invokes {@link OnApprovalRequired} before
 * delegating to the underlying tool. Tools that do not require approval are
 * returned unchanged.
 *
 * The two `get*` parameters are read on every `getTool` call so that React
 * prop changes are picked up without rebuilding the wrapper.
 */
export function withApprovalProxy(
  provider: ToolProvider,
  getCallback: () => OnApprovalRequired | undefined,
  getApprovalOverride: () => readonly string[] | undefined,
  hooks: ApprovalProxyHooks = {},
): ToolProvider {
  return {
    getTools: () => provider.getTools(),
    getTool: (name) => {
      const tool = provider.getTool(name);
      if (!tool) return undefined;
      const def = tool.definition();
      if (!computeNeedsApproval(def, getApprovalOverride())) return tool;
      const callback = getCallback();
      if (!callback) return tool;
      return new ApprovalProxyTool(tool, callback, hooks);
    },
  };
}
