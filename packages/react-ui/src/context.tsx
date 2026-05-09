// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type {
  AgentConfig,
  AgentRunner,
  ApprovalHandler,
  Conversation,
  Message,
} from '@mast-ai/core';

import { useAgentStream } from './hooks/useAgentStream.js';
import { IconProvider } from './icons.js';
import {
  createApprovalHandler,
  type ApprovalHandlerHooks,
  type OnApprovalRequired,
  type PendingApproval,
} from './approval.js';
import type { ConversationEntry, IconMap, ToolCallStatus } from './types.js';

/**
 * Props accepted by {@link AgentProvider}.
 */
export interface AgentProviderProps {
  /**
   * The {@link AgentRunner} that will execute agent runs. Pass `null` for the
   * "agent not yet configured" state (e.g. before the user has supplied an
   * API key, signed in, or selected a provider): the provider mounts cleanly,
   * `useAgent()` returns disabled-state defaults, and `<ChatInput>` greys out
   * automatically. Switching from `null` to a real runner does not require
   * remounting; the conversation starts fresh on the next `sendMessage`.
   */
  runner: AgentRunner | null;
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
   * {@link import('./approval.js').INLINE_APPROVAL} to defer to the inline
   * approval queue exposed via `useAgent().pendingApprovals`.
   *
   * Defaults to a callback that returns `INLINE_APPROVAL` for every call when
   * omitted, so tools marked `requiresApproval: true` always pause for user
   * confirmation by default. Apps that already render `<InlineApproval>` (or
   * read `useAgent().pendingApprovals`) get a working approval flow with no
   * additional wiring. Provide a custom callback to plug in a different
   * confirmation UI, auto-approve specific tools, inject canned results, or
   * short-circuit cancellations.
   */
  onApprovalRequired?: OnApprovalRequired;
  /**
   * Runtime override of the per-tool approval policy. Names prefixed with `!`
   * suppress approval even when the tool's own `requiresApproval` is `true`.
   *
   * @example ['!safe_tool']
   */
  approvalOverride?: string[];
  /**
   * Seed `Conversation.history` with previously-saved messages so the LLM
   * continues from where it left off. Read once when the provider mounts;
   * later changes have no effect until `reset()` is called.
   */
  initialHistory?: Message[];
  /**
   * Seed the rendered entry list with previously-saved entries so existing
   * turns render immediately on mount. Read once when the provider mounts.
   */
  initialEntries?: ConversationEntry[];
  /**
   * Called after each completed turn (i.e. after a `done` event) with the
   * latest core message history and UI entry list. Use this to persist the
   * conversation to localStorage, IndexedDB, a server, etc. Not invoked when
   * a run is cancelled or errors before completion.
   */
  onConversationChange?: (history: Message[], entries: ConversationEntry[]) => void;
  /**
   * Selects the theme on the auto-rendered `[data-mast-root]` wrapper.
   * Defaults to `'light'`. Pass `'dark'` to force the dark palette or
   * `'auto'` to follow the OS `prefers-color-scheme` preference. Only
   * meaningful when `disableRoot` is explicitly `false` (so the provider
   * actually renders the wrapper); when omitted or `true`, this prop has no
   * effect and consumers should set `data-mast-theme` themselves on whatever
   * element carries `data-mast-root`.
   */
  theme?: 'light' | 'dark' | 'auto';
  /**
   * Controls whether the provider renders an auto wrapper `<div data-mast-root>`
   * around `children`.
   *
   * Default: `true` — the provider is transparent in the DOM and consumers
   * are responsible for placing `data-mast-root` themselves (typically on the
   * outermost container, or implicitly via `<ConversationPanel>` which carries
   * its own `data-mast-root`). This avoids the auto wrapper's panel chrome
   * (border, padding, `height: 100%`) leaking onto whatever subtree the
   * provider wraps, including app-root mounts.
   *
   * Set to `false` to opt back into the auto wrapper for zero-config setups
   * that compose primitives directly without their own root container.
   */
  disableRoot?: boolean;
}

/**
 * The value exposed by {@link useAgent}.
 */
export interface UseAgentReturn {
  /** Ordered conversation entries, suitable for rendering. */
  messages: ConversationEntry[];
  /**
   * Live mirror of the underlying `Conversation.history` — the raw core
   * `Message[]` sent to the LLM. Updated after every completed turn. Read
   * this to imperatively persist conversation state.
   */
  history: Message[];
  /**
   * Sends a user message and starts a new agent run. The first argument is
   * the prompt delivered to the LLM. The optional second argument overrides
   * what is rendered in the user bubble; when omitted, the prompt is shown.
   */
  sendMessage: (text: string, displayText?: string) => void;
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
   * carries `approve()` and `reject()` callbacks that resolve the underlying
   * tool execution; the runner is paused until one is called.
   */
  pendingApprovals: PendingApproval[];
  /**
   * `true` when an `AgentRunner` is configured. `false` when `<AgentProvider>`
   * was mounted with `runner={null}` (the "agent not yet configured" state).
   * `<ChatInput>` reads this to disable its textarea and Send button; custom
   * inputs built via `useAgent()` should do the same.
   *
   * When `false`, `sendMessage` is a no-op (it logs a development warning).
   */
  isReady: boolean;
}

const AgentContext = createContext<UseAgentReturn | null>(null);

/**
 * Wraps a subtree with agent context.
 *
 * Internally creates a {@link Conversation} via
 * `runner.conversation(agent, { approvalHandler })` and drives it with
 * {@link useAgentStream}. Children access the resulting state through
 * {@link useAgent}.
 */
export function AgentProvider({
  runner,
  agent,
  children,
  icons,
  onApprovalRequired,
  approvalOverride,
  initialHistory,
  initialEntries,
  onConversationChange,
  theme,
  disableRoot,
}: AgentProviderProps) {
  const onConversationChangeRef = useRef(onConversationChange);
  onConversationChangeRef.current = onConversationChange;
  // Captured once; later changes to initialHistory/initialEntries don't reseed
  // an in-progress conversation. Callers who need to swap conversations should
  // call `reset()` and remount the provider with new initial values.
  const initialHistoryRef = useRef(initialHistory);
  const initialEntriesRef = useRef(initialEntries);
  // Refs let the approval handler read the latest callback and override on
  // each tool invocation without rebuilding the handler on every render.
  const onApprovalRef = useRef(onApprovalRequired);
  onApprovalRef.current = onApprovalRequired;
  const approvalOverrideRef = useRef(approvalOverride);
  approvalOverrideRef.current = approvalOverride;

  // The handler's React-side hooks. Filled in below once the stream hook and
  // queue setter exist; the handler reads through these refs so it can be
  // built before the rest of the React state.
  const notifyAwaitingRef = useRef<((name: string, awaiting: boolean) => void) | null>(null);
  const setStatusRef = useRef<((name: string, status: ToolCallStatus) => void) | null>(null);
  const enqueueInlineRef = useRef<
    ((toolName: string, args: unknown, signal?: AbortSignal) => Promise<boolean | string>) | null
  >(null);

  const approvalHandler = useMemo<ApprovalHandler>(() => {
    const hooks: ApprovalHandlerHooks = {
      notifyAwaiting: (name, awaiting) => notifyAwaitingRef.current?.(name, awaiting),
      setStatus: (name, status) => setStatusRef.current?.(name, status),
      enqueueInline: (name, args, signal) =>
        enqueueInlineRef.current?.(name, args, signal) ?? Promise.resolve(true),
    };
    return createApprovalHandler(
      () => onApprovalRef.current,
      () => approvalOverrideRef.current,
      hooks,
    );
  }, []);

  const [conversation, setConversation] = useState<Conversation | null>(() => {
    if (runner === null) return null;
    const conv = runner.conversation(agent, { approvalHandler });
    if (initialHistoryRef.current && initialHistoryRef.current.length > 0) {
      conv.history = [...initialHistoryRef.current];
    }
    return conv;
  });

  // Materialise a Conversation when the runner transitions from null to a
  // real value, so consumers can swap in a runner after the app finishes
  // configuring it (sign-in, API key entry, etc.) without remounting the
  // provider. We deliberately do not tear down or replace an existing
  // conversation when the runner reference changes — that case is out of
  // scope and consumers should call `reset()` to start a fresh conversation.
  useEffect(() => {
    if (runner !== null && conversation === null) {
      const conv = runner.conversation(agent, { approvalHandler });
      if (initialHistoryRef.current && initialHistoryRef.current.length > 0) {
        conv.history = [...initialHistoryRef.current];
      }
      setConversation(conv);
    }
  }, [runner, conversation, agent, approvalHandler]);

  const onTurnComplete = useCallback(
    (committedEntries: ConversationEntry[], committedHistory: Message[]) => {
      onConversationChangeRef.current?.(committedHistory, committedEntries);
    },
    [],
  );

  const {
    entries,
    history,
    sendMessage,
    cancel,
    isRunning,
    reset: resetStream,
    setToolAwaitingApproval,
    setToolStatus,
  } = useAgentStream(conversation, {
    initialEntries: initialEntriesRef.current,
    onTurnComplete,
  });
  notifyAwaitingRef.current = setToolAwaitingApproval;
  setStatusRef.current = setToolStatus;

  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const pendingApprovalsRef = useRef<PendingApproval[]>(pendingApprovals);
  pendingApprovalsRef.current = pendingApprovals;

  const enqueueInline = useCallback((toolName: string, args: unknown, signal?: AbortSignal) => {
    return new Promise<boolean | string>((resolve) => {
      // If the run has already been cancelled before we even enqueue, settle
      // immediately so the runner's next loop iteration sees the abort and
      // throws — without ever showing an approval card.
      if (signal?.aborted) {
        resolve(false);
        return;
      }
      let settled = false;
      const onAbort = () => finish(false);
      const finish = (decision: boolean | string) => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        setPendingApprovals((prev) => prev.filter((p) => p !== handle));
        resolve(decision);
      };
      if (signal) signal.addEventListener('abort', onAbort);
      const handle: PendingApproval = {
        toolName,
        args,
        approve: () => finish(true),
        reject: (result) => finish(result ?? false),
      };
      setPendingApprovals((prev) => [...prev, handle]);
    });
  }, []);
  enqueueInlineRef.current = enqueueInline;

  const reset = useCallback(() => {
    // Force-resolve any pending approvals so their handler invocations finish
    // and the run terminates cleanly. `reject()` resolves with `false`, which
    // the handler translates into the synthetic cancelled result.
    pendingApprovalsRef.current.forEach((p) => p.reject());
    resetStream();
    setConversation(runner === null ? null : runner.conversation(agent, { approvalHandler }));
  }, [resetStream, runner, agent, approvalHandler]);

  const isReady = runner !== null;
  const value = useMemo<UseAgentReturn>(
    () => ({
      messages: entries,
      history,
      sendMessage,
      cancel,
      isRunning,
      reset,
      pendingApprovals,
      isReady,
    }),
    [entries, history, sendMessage, cancel, isRunning, reset, pendingApprovals, isReady],
  );

  const wrappedChildren =
    disableRoot === false ? (
      <div data-mast-root data-mast-theme={theme}>
        {children}
      </div>
    ) : (
      children
    );

  return (
    <AgentContext.Provider value={value}>
      <IconProvider icons={icons}>{wrappedChildren}</IconProvider>
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
