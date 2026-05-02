// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AgentConfig, AgentRunner, Conversation } from '@mast-ai/core';

import { useAgentStream } from './hooks/useAgentStream';
import type { ConversationEntry, IconMap } from './types';

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
   * Optional override for the bundled inline SVG icons. Wired up in a follow-up
   * issue; accepted here so the prop is part of the stable provider API.
   */
  icons?: IconMap;
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
}

const AgentContext = createContext<UseAgentReturn | null>(null);

/**
 * Wraps a subtree with agent context.
 *
 * Internally creates a {@link Conversation} via `runner.conversation(agent)`
 * and drives it with {@link useAgentStream}. Children access the resulting
 * state through {@link useAgent}.
 */
export function AgentProvider({ runner, agent, children }: AgentProviderProps) {
  const [conversation, setConversation] = useState<Conversation>(() => runner.conversation(agent));

  const {
    entries,
    sendMessage,
    cancel,
    isRunning,
    reset: resetStream,
  } = useAgentStream(conversation);

  const reset = useCallback(() => {
    resetStream();
    setConversation(runner.conversation(agent));
  }, [resetStream, runner, agent]);

  const value = useMemo<UseAgentReturn>(
    () => ({ messages: entries, sendMessage, cancel, isRunning, reset }),
    [entries, sendMessage, cancel, isRunning, reset],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
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
