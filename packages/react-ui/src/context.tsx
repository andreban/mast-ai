// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AgentRunner } from '@mast-ai/core';
import type { AgentConfig, Conversation } from '@mast-ai/core';

import { useAgentStream } from './hooks/useAgentStream';
import { IconProvider } from './icons';
import {
  withApprovalProxy,
  type ApprovalProxyHooks,
  type OnApprovalRequired,
  type PendingApproval,
} from './approval';
import type { ConversationEntry, IconMap, ToolCallStatus } from './types';

/**
 * Props accepted by {@link AgentProvider}.
 */
export interface AgentProviderProps {
  /** The {@link AgentRunner} that will execute agent runs. */
  runner: AgentRunner;
  /** The agent configuration used for every turn. */
  agent: AgentConfig;
  /** The subtree that should have access to {@link useAgent}. */
  children: ReactNode;
  /**
   * Optional overrides for the bundled inline SVG icons. Any keys left
   * unspecified fall back to the defaults exported from `./icons`. Distributed
   * to descendants through a dedicated icon context so updates do not flow
   * through the agent state context.
   */
  icons?: IconMap;
  /**
   * Called before executing any tool call whose effective `needsApproval`
   * evaluates to `true`. Resolve with `true` to proceed, `false` to cancel
   * (the runner receives a synthetic "user cancelled" result), a string to
   * short-circuit execution with that string as the tool result, or
   * {@link import('./approval').INLINE_APPROVAL} to defer to the inline
   * approval queue exposed via `useAgent().pendingApprovals`.
   *
   * Not called when no tool requires approval, and not called when the prop
   * is omitted — in which case `requiresApproval: true` tools execute silently.
   */
  onApprovalRequired?: OnApprovalRequired;
  /**
   * Runtime override of the per-tool approval policy. Bare names add approval
   * even when the tool's own `requiresApproval` is `false`; names prefixed with
   * `!` suppress approval even when `requiresApproval` is `true`.
   *
   * @example ['third_party_tool', '!safe_tool']
   */
  approvalOverride?: string[];
}

/**
 * The value exposed by {@link useAgent}.
 */
export interface UseAgentReturn {
  /** Ordered conversation entries, suitable for rendering. */
  messages: ConversationEntry[];
  /** Sends a user message and starts a new agent run. */
  sendMessage: (text: string) => void;
  /** Aborts the current run, if any. */
  cancel: () => void;
  /** `true` while a run is in progress. */
  isRunning: boolean;
  /**
   * Aborts any in-flight run, clears the rendered conversation, and replaces
   * the underlying {@link Conversation} with a fresh instance so the next
   * `sendMessage` call starts with empty core history.
   */
  reset: () => void;
  /**
   * Tool calls awaiting an inline approval decision. Populated when
   * `onApprovalRequired` resolves to `INLINE_APPROVAL` for a call. Each entry
   * carries `approve()`, `reject()`, and `respondWith()` callbacks that
   * resolve the underlying tool execution; the runner is paused until one is
   * called.
   */
  pendingApprovals: PendingApproval[];
}

const AgentContext = createContext<UseAgentReturn | null>(null);

/**
 * Wraps a subtree with agent context.
 *
 * Internally creates a {@link Conversation} via `runner.conversation(agent)`
 * and drives it with {@link useAgentStream}. Children access the resulting
 * state through {@link useAgent}.
 */
export function AgentProvider({
  runner,
  agent,
  children,
  icons,
  onApprovalRequired,
  approvalOverride,
}: AgentProviderProps) {
  // Refs let the approval proxy read the latest callback and override on each
  // tool invocation without rebuilding the wrapped runner on every render.
  const onApprovalRef = useRef(onApprovalRequired);
  onApprovalRef.current = onApprovalRequired;
  const approvalOverrideRef = useRef(approvalOverride);
  approvalOverrideRef.current = approvalOverride;

  // The proxy's React-side hooks. Filled in below once the stream hook and
  // queue setter exist; the proxy reads through these refs so the wrapper can
  // be built before the rest of the React state.
  const notifyAwaitingRef = useRef<((name: string, awaiting: boolean) => void) | null>(null);
  const setStatusRef = useRef<((name: string, status: ToolCallStatus) => void) | null>(null);
  const enqueueInlineRef = useRef<
    ((toolName: string, args: unknown) => Promise<boolean | string>) | null
  >(null);

  const wrappedRunner = useMemo(() => {
    const hasApproval = onApprovalRequired !== undefined;
    const hasOverride = approvalOverride !== undefined && approvalOverride.length > 0;
    if (!hasApproval && !hasOverride) return runner;
    const hooks: ApprovalProxyHooks = {
      notifyAwaiting: (name, awaiting) => notifyAwaitingRef.current?.(name, awaiting),
      setStatus: (name, status) => setStatusRef.current?.(name, status),
      enqueueInline: (name, args) =>
        enqueueInlineRef.current?.(name, args) ?? Promise.resolve(true),
    };
    const provider = withApprovalProxy(
      runner.registry,
      () => onApprovalRef.current,
      () => approvalOverrideRef.current,
      hooks,
    );
    return new AgentRunner(runner.adapter, provider);
  }, [runner, onApprovalRequired, approvalOverride]);

  const [conversation, setConversation] = useState<Conversation>(() =>
    wrappedRunner.conversation(agent),
  );

  const {
    entries,
    sendMessage,
    cancel,
    isRunning,
    reset: resetStream,
    setToolAwaitingApproval,
    setToolStatus,
  } = useAgentStream(conversation);
  notifyAwaitingRef.current = setToolAwaitingApproval;
  setStatusRef.current = setToolStatus;

  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const pendingApprovalsRef = useRef<PendingApproval[]>(pendingApprovals);
  pendingApprovalsRef.current = pendingApprovals;

  const enqueueInline = useCallback((toolName: string, args: unknown) => {
    return new Promise<boolean | string>((resolve) => {
      const finish = (decision: boolean | string) => {
        setPendingApprovals((prev) => prev.filter((p) => p !== handle));
        resolve(decision);
      };
      const handle: PendingApproval = {
        toolName,
        args,
        approve: () => finish(true),
        reject: () => finish(false),
        respondWith: (result) => finish(result),
      };
      setPendingApprovals((prev) => [...prev, handle]);
    });
  }, []);
  enqueueInlineRef.current = enqueueInline;

  const reset = useCallback(() => {
    // Force-resolve any pending approvals so their proxies finish and the
    // run terminates cleanly. `reject()` resolves with `false`, which the
    // proxy translates into the synthetic cancelled result.
    pendingApprovalsRef.current.forEach((p) => p.reject());
    resetStream();
    setConversation(wrappedRunner.conversation(agent));
  }, [resetStream, wrappedRunner, agent]);

  const value = useMemo<UseAgentReturn>(
    () => ({ messages: entries, sendMessage, cancel, isRunning, reset, pendingApprovals }),
    [entries, sendMessage, cancel, isRunning, reset, pendingApprovals],
  );

  return (
    <AgentContext.Provider value={value}>
      <IconProvider icons={icons}>{children}</IconProvider>
    </AgentContext.Provider>
  );
}

/**
 * Reads the current agent state from {@link AgentProvider}.
 *
 * Throws when called outside an `<AgentProvider>` so misuse is caught at the
 * call site rather than producing silent runtime bugs.
 */
export function useAgent(): UseAgentReturn {
  const ctx = useContext(AgentContext);
  if (!ctx) {
    throw new Error('useAgent() must be called from a component rendered inside <AgentProvider>.');
  }
  return ctx;
}
