// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { ApprovalResponse, type ApprovalHandler, type ToolDefinition } from '@mast-ai/core';
import type { ToolCallStatus } from './types.js';

/**
 * Sentinel value returned from {@link OnApprovalRequired} to defer the
 * decision to the inline approval queue. The approval handler enqueues a
 * {@link PendingApproval} handle on `useAgent().pendingApprovals` and waits
 * for the consumer (or the built-in `<InlineApproval>` slot) to call
 * `approve()` or `reject()`.
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
 *   and the UI marks the call as `'cancelled'`
 * - `string` — skip execution and inject the string as the tool result; the
 *   UI marks the call as `'cancelled'`
 * - {@link INLINE_APPROVAL} — defer to the inline approval queue
 */
export type OnApprovalRequired = (
  toolCall: import('./types.js').ToolEventEntry,
) => Promise<boolean | string | typeof INLINE_APPROVAL>;

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
  /**
   * Reject the call. With no argument the runner receives the default
   * cancelled result; with a string the runner receives that string as the
   * tool result. In both cases the UI marks the call as `'cancelled'`.
   */
  reject: (result?: string) => void;
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

/**
 * Default `OnApprovalRequired` used when the host app omits the prop.
 * Returning `INLINE_APPROVAL` for every call honours `requiresApproval: true`
 * by default: the call is enqueued on `useAgent().pendingApprovals` (and
 * rendered inline by the bundled `<InlineApproval>` slot) instead of executing
 * silently.
 */
export const DEFAULT_ON_APPROVAL_REQUIRED: OnApprovalRequired = async () => INLINE_APPROVAL;

/** React-side hooks the {@link createApprovalHandler} factory uses to drive UI state. */
export interface ApprovalHandlerHooks {
  /** Called with `true` when waiting starts and `false` when a decision is reached. */
  notifyAwaiting?: (name: string, awaiting: boolean) => void;
  /** Called when a decision sets the final tool-call status (e.g. cancelled). */
  setStatus?: (name: string, status: ToolCallStatus) => void;
  /**
   * Pushes a pending approval onto the queue and returns a promise that
   * resolves once the consumer calls `approve()` (with `true`), `reject()`
   * (with `false`), or `reject(result)` (with the result string).
   *
   * When `signal` is provided, the queue resolver also resolves with `false`
   * if the signal aborts before a decision is reached, so cancelling the run
   * unblocks the awaiter.
   */
  enqueueInline?: (
    toolName: string,
    args: unknown,
    signal?: AbortSignal,
  ) => Promise<boolean | string>;
}

/**
 * Builds an {@link ApprovalHandler} that bridges the runner's per-run gating
 * contract with the React-side approval UI surface (callback prop, override
 * prop, inline queue resolver, awaiting/status setters).
 *
 * The handler is consulted by the runner only for tools whose
 * `requiresApproval` flag is `true`. For those tools the handler:
 *
 * 1. Honours the `approvalOverride` `!`-prefix suppression by approving
 *    immediately without consulting the consumer callback. The handler does
 *    not enforce the unprefixed `add` form because the runner does not call
 *    the handler for tools whose definition has `requiresApproval: false` —
 *    so there is no opportunity for the handler to opt in.
 * 2. Invokes the consumer callback (or the default), translating its
 *    `boolean | string | INLINE_APPROVAL` return into an
 *    {@link ApprovalResponse} the runner understands.
 * 3. Routes `INLINE_APPROVAL` returns through the queue resolver so consumers
 *    can render an inline confirmation card.
 *
 * All inputs are read through getters so the same handler instance can stay
 * attached to the conversation across React renders without rebuilding.
 *
 * The handler is intentionally registry-agnostic: it does not look up tool
 * definitions, so it works uniformly for parent-agent tool calls and for
 * sub-agent tool calls (which live in a different registry). The runner has
 * already applied the `requiresApproval` gate by the time `requestApproval`
 * is called.
 */
export function createApprovalHandler(
  getCallback: () => OnApprovalRequired | undefined,
  getApprovalOverride: () => readonly string[] | undefined,
  hooks: ApprovalHandlerHooks = {},
): ApprovalHandler {
  return {
    async requestApproval({ name, args, signal }) {
      const override = getApprovalOverride();
      // `!name` in the override list short-circuits to approve, matching the
      // suppression rule in `computeNeedsApproval`.
      if (override?.includes(`!${name}`)) {
        return ApprovalResponse.approve();
      }

      hooks.notifyAwaiting?.(name, true);
      try {
        const callback = getCallback() ?? DEFAULT_ON_APPROVAL_REQUIRED;
        const initial = await callback({
          id: '',
          type: 'tool_call_started',
          name,
          args,
          isStreaming: true,
        });
        let resolved: boolean | string;
        if (initial === INLINE_APPROVAL) {
          // No queue wired — fall through to approve so the run does not deadlock.
          resolved = hooks.enqueueInline ? await hooks.enqueueInline(name, args, signal) : true;
        } else {
          resolved = initial;
        }
        if (resolved === true) return ApprovalResponse.approve();
        // false or string both reject; the UI status is uniformly 'cancelled'.
        hooks.setStatus?.(name, 'cancelled');
        return ApprovalResponse.reject(resolved === false ? undefined : resolved);
      } finally {
        hooks.notifyAwaiting?.(name, false);
      }
    },
  };
}
