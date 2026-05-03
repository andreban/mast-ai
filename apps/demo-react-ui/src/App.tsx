// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { AgentRunner, ToolRegistry, createAgent } from '@mast-ai/core';
import { GoogleGenAIAdapter } from '@mast-ai/google-genai';
import {
  AgentProvider,
  ConversationPanel,
  INLINE_APPROVAL,
  InlineApproval,
  ToolCallBlock,
  useAgent,
  type IconMap,
  type OnApprovalRequired,
  type PendingApproval,
  type ToolEventEntry,
} from '@mast-ai/react-ui';
import { Brain, CircleCheck, CircleX, LoaderCircle, Send, Square, Wrench } from 'lucide-react';

import {
  CopyToClipboardTool,
  GetCurrentTimeTool,
  GetPageTitleTool,
  ParseIntegerTool,
  SetPageTitleTool,
} from './tools';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
if (!apiKey) {
  console.warn('VITE_GEMINI_API_KEY is not set. Copy .env.example to .env and set your key.');
}

const registry = new ToolRegistry()
  .register(new GetCurrentTimeTool())
  .register(new GetPageTitleTool())
  .register(new SetPageTitleTool())
  .register(new CopyToClipboardTool())
  .register(new ParseIntegerTool());
const runner = new AgentRunner(new GoogleGenAIAdapter(apiKey ?? ''), registry);

const agentConfig = createAgent({
  name: 'DemoAssistant',
  instructions:
    'You are a helpful assistant for a demo of the @mast-ai/react-ui package. ' +
    'Use the get_current_time tool when the user asks about the current time. ' +
    'Use the get_page_title tool when the user asks for the page title. ' +
    'Use the set_page_title tool when the user asks to change or set the page title. ' +
    'Use the copy_to_clipboard tool when the user asks to copy something to the clipboard. ' +
    'Use the parse_integer tool when the user asks to parse a string as an integer.',
  tools: [
    'get_current_time',
    'get_page_title',
    'set_page_title',
    'copy_to_clipboard',
    'parse_integer',
  ],
});

const icons: IconMap = {
  brain: <Brain size={16} />,
  wrench: <Wrench size={16} />,
  check: <CircleCheck size={16} />,
  error: <CircleX size={16} />,
  cancelled: <CircleX size={16} />,
  loader: <LoaderCircle size={16} className="mast-spin" />,
  send: <Send size={16} />,
  stop: <Square size={16} />,
};

type ThemeChoice = 'system' | 'light' | 'dark';

const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

const THEME_LABEL: Record<ThemeChoice, string> = {
  system: 'Theme: System',
  light: 'Theme: Light',
  dark: 'Theme: Dark',
};

/**
 * Single approval callback that dispatches by tool name across two flows:
 *
 * - Approval-required tools (`get_page_title`, `set_page_title`) return
 *   `INLINE_APPROVAL`, which puts the call on `useAgent().pendingApprovals`
 *   and pauses the runner until the consumer resolves it inline.
 * - Anything else falls back to `window.confirm` outside the chat.
 */
const onApprovalRequired: OnApprovalRequired = async (toolCall) => {
  if (toolCall.name === 'get_page_title' || toolCall.name === 'set_page_title') {
    return INLINE_APPROVAL;
  }
  return window.confirm(`Allow tool "${toolCall.name}" to run?`);
};

/**
 * Custom Apply/Discard card for `set_page_title` that previews the proposed
 * title. Demonstrates option (a): full layout control via `renderToolCall`,
 * with `approve()` / `reject()` plumbed through the second arg.
 */
function SetPageTitleApproval({
  entry,
  approval,
}: {
  entry: ToolEventEntry;
  approval: PendingApproval;
}) {
  const args = entry.args as { title?: string } | undefined;
  return (
    <div className="demo-set-title-approval">
      <div className="demo-set-title-approval-header">Change page title?</div>
      <div className="demo-set-title-approval-preview">
        <span className="demo-set-title-approval-label">New title:</span>
        <code>{args?.title ?? '(missing)'}</code>
      </div>
      <div className="demo-set-title-approval-actions">
        <button
          type="button"
          className="demo-approval-button demo-approval-approve"
          onClick={approval.approve}
        >
          Apply
        </button>
        <button
          type="button"
          className="demo-approval-button demo-approval-reject"
          onClick={approval.reject}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

/**
 * Single render function dispatches across all states:
 *
 * - `set_page_title` awaiting approval → custom card (option a).
 * - any other tool awaiting approval → bundled `<InlineApproval>` (option b).
 * - everything else → bundled `<ToolCallBlock>` with success/error/cancelled
 *   status indicators.
 */
const renderToolCall = (entry: ToolEventEntry, approval?: PendingApproval) => {
  if (approval) {
    if (entry.name === 'set_page_title') {
      return <SetPageTitleApproval entry={entry} approval={approval} />;
    }
    return (
      <InlineApproval
        entry={entry}
        approve={approval.approve}
        reject={approval.reject}
        respondWith={approval.respondWith}
      />
    );
  }
  return <ToolCallBlock entry={entry} />;
};

/** Header indicator that demonstrates reading `pendingApprovals` via `useAgent`. */
function PendingApprovalsBadge() {
  const { pendingApprovals } = useAgent();
  if (pendingApprovals.length === 0) return null;
  return <span className="demo-pending-badge">{pendingApprovals.length} pending</span>;
}

export default function App() {
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const panelTheme = theme === 'system' ? undefined : theme;

  return (
    <AgentProvider
      runner={runner}
      agent={agentConfig}
      icons={icons}
      onApprovalRequired={onApprovalRequired}
    >
      <div className="demo-shell">
        <header className="demo-header">
          <h1>MAST React UI Demo</h1>
          <div className="demo-header-controls">
            <PendingApprovalsBadge />
            <button
              type="button"
              className="demo-theme-toggle"
              onClick={() => setTheme((current) => NEXT_THEME[current])}
            >
              {THEME_LABEL[theme]}
            </button>
          </div>
        </header>
        <ConversationPanel theme={panelTheme} renderToolCall={renderToolCall} />
      </div>
    </AgentProvider>
  );
}
