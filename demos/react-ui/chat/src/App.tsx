// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { AgentRunner, ToolRegistry, createAgent } from '@mast-ai/core';
import type { Message } from '@mast-ai/core';
import { GoogleGenAIAdapter } from '@mast-ai/google-genai';
import {
  AgentProvider,
  ConversationPanel,
  INLINE_APPROVAL,
  InlineApproval,
  useAgent,
  type ConversationEntry,
  type IconMap,
  type MentionsConfig,
  type OnApprovalRequired,
  type PendingApproval,
  type RenderApproval,
  type ToolEventEntry,
} from '@mast-ai/react-ui';
import {
  Brain,
  CircleCheck,
  CircleX,
  LoaderCircle,
  Send,
  Square,
  Trash2,
  Wrench,
} from 'lucide-react';

import {
  CopyToClipboardTool,
  GetCurrentTimeTool,
  GetPageTitleTool,
  ParseIntegerTool,
  ReadDocTool,
  SetPageTitleTool,
  createSummarizeDocumentsTool,
  demoDocs,
  type DemoDoc,
} from './tools';

/**
 * Builds a fresh `AgentRunner` for the given API key. The key is held by the
 * app in `localStorage` rather than baked in via a Vite env var, so the
 * built bundle can be deployed publicly without leaking credentials.
 */
function createRunner(apiKey: string): AgentRunner {
  const registry = new ToolRegistry()
    .register(new GetCurrentTimeTool())
    .register(new GetPageTitleTool())
    .register(new SetPageTitleTool())
    .register(new CopyToClipboardTool())
    .register(new ParseIntegerTool())
    .register(new ReadDocTool());
  const next = new AgentRunner(new GoogleGenAIAdapter(apiKey), registry);
  registry.register(createSummarizeDocumentsTool(next));
  return next;
}

const agentConfig = createAgent({
  name: 'DemoAssistant',
  instructions:
    'You are a helpful assistant for a demo of the @mast-ai/react-ui package. ' +
    'Use the get_current_time tool when the user asks about the current time. ' +
    'Use the get_page_title tool when the user asks for the page title. ' +
    'Use the set_page_title tool when the user asks to change or set the page title. ' +
    'Use the copy_to_clipboard tool when the user asks to copy something to the clipboard. ' +
    'Use the parse_integer tool when the user asks to parse a string as an integer. ' +
    'When the user asks to summarise one or more referenced documents, call the ' +
    'summarize_documents tool with the relevant ids. The summarizer will fetch each ' +
    'document itself, so you do not need to call read_doc when delegating to it. ' +
    "For other questions about a referenced document's contents, call read_doc directly. " +
    'When a user message starts with "The user has referenced the following documents:", ' +
    'use the listed ids to drive your tool calls. ' +
    'Do not assume document contents from the title alone.',
  tools: [
    'get_current_time',
    'get_page_title',
    'set_page_title',
    'copy_to_clipboard',
    'parse_integer',
    'read_doc',
    'summarize_documents',
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

// ---------------------------------------------------------------------------
// Mention pipeline demo
// ---------------------------------------------------------------------------

/**
 * Builds an augmented prompt that lists referenced documents by id and
 * title only, leaving the bodies for the agent to fetch on demand via the
 * `read_doc` tool. This shrinks the per-turn prompt and exercises the
 * displayText/prompt split: the user bubble shows `@Roadmap` while the
 * LLM sees the id-only preamble.
 */
const mentionsConfig: MentionsConfig<DemoDoc> = {
  items: demoDocs,
  buildPrompt: (segments, trailing) => {
    const inline = segments.map((s) => `${s.text}@${s.item.label}`).join('') + trailing;
    if (segments.length === 0) return inline;
    const refs = segments.map((s) => `- "${s.item.label}" (id: ${s.item.id})`).join('\n');
    return `The user has referenced the following documents:\n${refs}\n\n${inline}`;
  },
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

// ---------------------------------------------------------------------------
// API key (browser-side only, kept in localStorage)
// ---------------------------------------------------------------------------

const API_KEY_STORAGE = 'demo-react-ui:api-key';

function loadApiKey(): string | null {
  try {
    return localStorage.getItem(API_KEY_STORAGE);
  } catch {
    return null;
  }
}

function saveApiKey(key: string) {
  try {
    localStorage.setItem(API_KEY_STORAGE, key);
  } catch (err) {
    console.warn('Failed to persist API key to localStorage', err);
  }
}

function clearApiKey() {
  try {
    localStorage.removeItem(API_KEY_STORAGE);
  } catch (err) {
    console.warn('Failed to clear API key from localStorage', err);
  }
}

interface ApiKeySetupProps {
  onSubmit: (key: string) => void;
  theme: 'light' | 'dark' | undefined;
}

function ApiKeySetup({ onSubmit, theme }: ApiKeySetupProps) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className="demo-shell" data-mast-root data-mast-theme={theme}>
      <header className="demo-header">
        <h1>MAST React UI Demo</h1>
      </header>
      <div className="demo-api-key-setup">
        <form className="demo-api-key-card" onSubmit={handleSubmit}>
          <h2 className="demo-api-key-title">Enter your Gemini API key</h2>
          <p>
            The demo runs entirely in your browser. Your key is saved to this device's{' '}
            <code>localStorage</code> and is sent only to Google's API, never to any other server.
          </p>
          <p>
            Get a free key at{' '}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
            >
              aistudio.google.com/app/apikey
            </a>
            .
          </p>
          <label className="demo-api-key-label">
            <span>API key</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="AIzaSy..."
              autoFocus
            />
          </label>
          <button type="submit" className="demo-header-button" disabled={!trimmed}>
            Save and continue
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversation persistence
// ---------------------------------------------------------------------------

interface StoredConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  history: Message[];
  entries: ConversationEntry[];
}

type ConversationMap = Record<string, StoredConversation>;

const STORAGE_KEY = 'demo-react-ui:conversations';

function loadConversations(): ConversationMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ConversationMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persistConversations(map: ConversationMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn('Failed to persist conversations to localStorage', err);
  }
}

function deriveTitle(entries: ConversationEntry[]): string {
  const firstUser = entries.find((e) => e.role === 'user');
  const text = firstUser?.text.trim() ?? '';
  if (!text) return 'Untitled conversation';
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function pickMostRecent(map: ConversationMap): string | null {
  const ids = Object.keys(map);
  if (ids.length === 0) return null;
  return ids.sort((a, b) => map[b].updatedAt - map[a].updatedAt)[0];
}

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
 * title instead of dumping the raw arg JSON. Wired through the
 * `renderApproval` slot, which only fires for tool events with a pending
 * approval handle and leaves the rest of the tool-call rendering to the
 * default `<ToolCallBlock>`.
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
 * Dispatches the inline approval card by tool name. `set_page_title` gets a
 * bespoke preview; every other approval-required tool falls back to the
 * bundled `<InlineApproval>`. Non-approval tool events are not handled here
 * at all — they fall through to the default `<ToolCallBlock>` rendering.
 */
const renderApproval: RenderApproval = (entry, approval) => {
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
};

/** Header indicator that demonstrates reading `pendingApprovals` via `useAgent`. */
function PendingApprovalsBadge() {
  const { pendingApprovals } = useAgent();
  if (pendingApprovals.length === 0) return null;
  return <span className="demo-pending-badge">{pendingApprovals.length} pending</span>;
}

interface ConversationListProps {
  conversations: ConversationMap;
  activeId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function ConversationList({ conversations, activeId, onSelect, onDelete }: ConversationListProps) {
  const sorted = Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <aside className="demo-sidebar">
      <h2 className="demo-sidebar-title">Conversations</h2>
      {sorted.length === 0 ? (
        <p className="demo-sidebar-empty">
          No saved conversations yet. Send a message to start one.
        </p>
      ) : (
        <ul className="demo-conversation-list">
          {sorted.map((conv) => {
            const isActive = conv.id === activeId;
            return (
              <li
                key={conv.id}
                className={
                  isActive
                    ? 'demo-conversation-item demo-conversation-item-active'
                    : 'demo-conversation-item'
                }
              >
                <button
                  type="button"
                  className="demo-conversation-select"
                  onClick={() => onSelect(conv.id)}
                  aria-current={isActive ? 'true' : undefined}
                >
                  <span className="demo-conversation-title">{conv.title}</span>
                  <span className="demo-conversation-date">
                    {new Date(conv.updatedAt).toLocaleString(undefined, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </button>
                <button
                  type="button"
                  className="demo-conversation-delete"
                  aria-label={`Delete conversation "${conv.title}"`}
                  onClick={() => {
                    if (window.confirm(`Delete "${conv.title}"?`)) onDelete(conv.id);
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

/**
 * Right-hand "How to try it" panel. Static content, kept in the demo so a
 * fresh visitor knows which example prompts exercise each tool, the mention
 * picker, the approval flow, and the persistence layer.
 */
function InstructionsPanel() {
  return (
    <aside className="demo-instructions" aria-labelledby="demo-instructions-title">
      <h2 id="demo-instructions-title" className="demo-sidebar-title">
        How to try it
      </h2>
      <section className="demo-instructions-section">
        <h3>Tools</h3>
        <ul>
          <li>
            <strong>“What time is it?”</strong> — runs <code>get_current_time</code> with no
            approval.
          </li>
          <li>
            <strong>“What is the page title?”</strong> — pauses for an inline approval card.
          </li>
          <li>
            <strong>
              “Set the page title to <em>Hello</em>.”
            </strong>{' '}
            — opens a custom Apply / Discard preview.
          </li>
          <li>
            <strong>
              “Copy <em>foo</em> to the clipboard.”
            </strong>{' '}
            — pauses for a <code>window.confirm</code> dialog.
          </li>
          <li>
            <strong>
              “Parse <em>abc</em> as an integer.”
            </strong>{' '}
            — surfaces the <code>error</code> status on the bubble.
          </li>
        </ul>
      </section>
      <section className="demo-instructions-section">
        <h3>@-mentions</h3>
        <p>
          Type <code>@</code> in the input to pick a demo doc. Try{' '}
          <em>“Summarise @Roadmap and @Style Guide”</em> to see a sub-agent fan out calls to{' '}
          <code>read_doc</code> nested under <code>summarize_documents</code>.
        </p>
      </section>
      <section className="demo-instructions-section">
        <h3>UI tips</h3>
        <ul>
          <li>Click any tool bubble to expand its arguments and result.</li>
          <li>Use the theme button to cycle System / Light / Dark.</li>
          <li>
            Conversations save to <code>localStorage</code> and reload on refresh.
          </li>
          <li>Use “Reset API key” to wipe the saved Gemini key.</li>
        </ul>
      </section>
    </aside>
  );
}

export default function App() {
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const panelTheme = theme === 'system' ? undefined : theme;

  const [apiKey, setApiKey] = useState<string | null>(() => loadApiKey());

  const [conversations, setConversations] = useState<ConversationMap>(() => loadConversations());
  const [activeId, setActiveId] = useState<string>(() => {
    const stored = loadConversations();
    return pickMostRecent(stored) ?? crypto.randomUUID();
  });

  const active: StoredConversation | undefined = conversations[activeId];

  const runner = useMemo(() => (apiKey ? createRunner(apiKey) : null), [apiKey]);

  const handleApiKey = useCallback((key: string) => {
    saveApiKey(key);
    setApiKey(key);
  }, []);

  const handleResetApiKey = useCallback(() => {
    if (!window.confirm('Forget the saved API key? You will need to re-enter it.')) return;
    clearApiKey();
    setApiKey(null);
  }, []);

  const handleConversationChange = useCallback(
    (history: Message[], entries: ConversationEntry[]) => {
      setConversations((prev) => {
        const existing = prev[activeId];
        const now = Date.now();
        const updated: StoredConversation = {
          id: activeId,
          title: deriveTitle(entries),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          history,
          entries,
        };
        const next = { ...prev, [activeId]: updated };
        persistConversations(next);
        return next;
      });
    },
    [activeId],
  );

  const handleNew = useCallback(() => {
    setActiveId(crypto.randomUUID());
  }, []);

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      setConversations((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        persistConversations(next);
        if (id === activeId) {
          const fallback = pickMostRecent(next);
          setActiveId(fallback ?? crypto.randomUUID());
        }
        return next;
      });
    },
    [activeId],
  );

  const isUnsavedNew = !active;

  if (!apiKey || !runner) {
    return <ApiKeySetup onSubmit={handleApiKey} theme={panelTheme} />;
  }

  return (
    <div className="demo-shell" data-mast-root data-mast-theme={panelTheme}>
      <header className="demo-header">
        <h1>MAST React UI Demo</h1>
        <div className="demo-header-controls">
          <button
            type="button"
            className="demo-header-button"
            onClick={handleNew}
            disabled={isUnsavedNew}
          >
            New conversation
          </button>
          <button
            type="button"
            className="demo-header-button"
            onClick={() => setTheme((current) => NEXT_THEME[current])}
          >
            {THEME_LABEL[theme]}
          </button>
          <button type="button" className="demo-header-button" onClick={handleResetApiKey}>
            Reset API key
          </button>
        </div>
      </header>
      <div className="demo-body">
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onSelect={handleSelect}
          onDelete={handleDelete}
        />
        <main className="demo-main">
          {/*
            Re-key the provider on activeId so switching conversations remounts
            it with the freshly seeded initialHistory and initialEntries — the
            simplest way to swap the underlying Conversation instance.
          */}
          <AgentProvider
            key={activeId}
            runner={runner}
            agent={agentConfig}
            icons={icons}
            onApprovalRequired={onApprovalRequired}
            initialHistory={active?.history}
            initialEntries={active?.entries}
            onConversationChange={handleConversationChange}
          >
            <div className="demo-main-header">
              <PendingApprovalsBadge />
            </div>
            <ConversationPanel
              theme={panelTheme}
              renderApproval={renderApproval}
              mentions={mentionsConfig as MentionsConfig}
              inputPlaceholder="Type @ to reference a doc, then press Enter."
            />
          </AgentProvider>
        </main>
        <InstructionsPanel />
      </div>
    </div>
  );
}
