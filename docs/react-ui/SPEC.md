# Technical Specification: @mast-ai/react-ui

## 1. Package

| Field      | Value               |
| ---------- | ------------------- |
| Name       | `@mast-ai/react-ui` |
| Location   | `packages/react-ui` |
| Build tool | Vite (library mode) |
| Language   | TypeScript (strict) |

### Peer Dependencies

```json
{
  "react": ">=19.0.0",
  "react-dom": ">=19.0.0",
  "@mast-ai/core": "workspace:*",
  "@tanstack/react-virtual": ">=3.0.0"
}
```

`@tanstack/react-virtual` is a required peer dependency. `<MessageList>` uses virtual
scrolling by default because agent conversations grow unboundedly during long sessions.

### Optional Dependencies

| Package                                             | Used for                            | How to activate                                                |
| --------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `react-markdown` + `remark-gfm` + `rehype-sanitize` | Markdown rendering in `MessageItem` | Installed automatically when present; falls back to plain text |

When `react-markdown` is detected, `rehype-sanitize` is **always applied** — the library
does not expose a way to disable sanitisation. Apps that need unrestricted HTML rendering
should supply a `renderMessage` prop instead.

Icons are **bundled inline** — see [Section 6: Icons](#6-icons).

---

## 2. Styling Architecture

### 2.1 Two-tier approach

**Tier 1 — Headless (behaviour only)**
Every component renders semantic HTML with `data-mast-*` attributes and no inline styles.
Components accept `className` and `style` props for consumer control.

**Tier 2 — Default stylesheet**
An optional CSS file provides a complete default theme. Consumers opt in with:

```ts
import '@mast-ai/react-ui/styles.css';
```

This file is plain CSS with no build-tool dependencies. It uses CSS custom properties
scoped under `[data-mast-root]` so it does not pollute the global namespace.

### 2.2 CSS Custom Properties

The default stylesheet defines a light theme and an automatic dark theme. Both are
expressed as CSS custom property blocks so consuming apps can override individual tokens
at any scope without `!important`.

```css
/* Light theme (default) */
[data-mast-root] {
  /* Color */
  --mast-bg: #ffffff;
  --mast-bg-subtle: #f9fafb;
  --mast-fg: #111827;
  --mast-fg-muted: #6b7280;
  --mast-border: #e5e7eb;
  --mast-accent: #2563eb;
  --mast-accent-fg: #ffffff;
  --mast-thinking-bg: #fefce8;
  --mast-thinking-fg: #854d0e;
  --mast-tool-bg: #f0fdf4;
  --mast-tool-fg: #166534;
  --mast-tool-pending: #f59e0b;
  --mast-user-bubble: #dbeafe;
  --mast-user-fg: #1e3a8a;

  /* Typography */
  --mast-font: system-ui, sans-serif;
  --mast-font-mono: ui-monospace, monospace;
  --mast-text-sm: 0.875rem;
  --mast-text-base: 1rem;

  /* Spacing */
  --mast-gap: 0.75rem;
  --mast-radius: 0.5rem;
}

/* Dark theme — activated by OS preference OR explicit attribute */
@media (prefers-color-scheme: dark) {
  [data-mast-root]:not([data-mast-theme='light']) {
    --mast-bg: #111827;
    --mast-bg-subtle: #1f2937;
    --mast-fg: #f9fafb;
    --mast-fg-muted: #9ca3af;
    --mast-border: #374151;
    --mast-accent: #3b82f6;
    --mast-accent-fg: #ffffff;
    --mast-thinking-bg: #1c1917;
    --mast-thinking-fg: #fcd34d;
    --mast-tool-bg: #052e16;
    --mast-tool-fg: #86efac;
    --mast-tool-pending: #fbbf24;
    --mast-user-bubble: #1e3a8a;
    --mast-user-fg: #bfdbfe;
  }
}

/* Explicit dark override (for apps using next-themes or similar) */
[data-mast-root][data-mast-theme='dark'] {
  /* same tokens as above */
}
```

**Manual theme control:** Apps that manage their own theme switching (e.g. via
`next-themes`) pass `data-mast-theme="light"` or `data-mast-theme="dark"` to the
root element. `ConversationPanel` accepts a `theme` prop that sets this attribute:

```tsx
<ConversationPanel theme="dark" />        // force dark
<ConversationPanel theme="light" />       // force light
<ConversationPanel />                     // follow OS (default)
```

### 2.3 CSS class naming

All default classes use the `mast-` prefix (e.g. `mast-message`, `mast-thinking-block`).
This avoids collisions with Tailwind utility classes and other CSS frameworks.

---

## 3. Data Types

These types live in `@mast-ai/react-ui` and are separate from the `@mast-ai/core` types
they are derived from. The UI types represent the _rendered state_ of a conversation, not
the raw protocol messages.

```typescript
export type ToolCallStatus = 'success' | 'error' | 'cancelled';

export interface ToolEventEntry {
  id: string; // stable key for matching pending approvals back to entries
  type: 'tool_call_started' | 'tool_call_completed';
  name: string;
  args?: unknown;
  result?: unknown;
  subThinking?: string; // accumulated thinking streamed from inside the tool/sub-agent
  subText?: string; // accumulated text streamed from inside the tool/sub-agent
  nestedToolEvents?: ToolEventEntry[]; // tool calls fired by a sub-agent inside this tool
  isStreaming: boolean; // true while the tool is executing
  awaitingApproval?: boolean; // true while paused on the inline approval queue or onApprovalRequired
  status?: ToolCallStatus; // populated when isStreaming flips to false
}

export interface ConversationEntry {
  id: string; // stable key for React reconciliation
  role: 'user' | 'assistant';
  text: string; // accumulated text (empty while streaming)
  thinking?: string; // accumulated thinking (empty while streaming)
  toolEvents: ToolEventEntry[];
  isStreaming: boolean;
}
```

The `useAgentStream` internal hook builds and maintains a `ConversationEntry[]` from
the `AgentEvent` stream emitted by `AgentRunner`. `status` is derived as:

- `'cancelled'` — set by the approval proxy when the user rejects the call.
- `'error'` — set when `tool_call_completed.error` is `true` (tool threw or was missing).
- `'success'` — set otherwise.

A `'cancelled'` status set by the proxy is preserved when the runner emits the
final `tool_call_completed` event so the synthetic cancelled result does not
get reclassified as success.

`nestedToolEvents` captures the tool calls a sub-agent fires while the
parent tool is executing. The list is populated as `tool_call_started` and
`tool_call_completed` events arrive on the parent's `onToolEvent` callback;
`<ToolCallBlock>` renders nested entries recursively. Currently scoped to a
single level of nesting — grandchild events route back to the outermost
matching parent. Deeper nesting requires either path-based routing in
`onToolEvent` or recursive plumbing inside `createAgentTool`, and is left to a
follow-up.

---

## 4. Components

### 4.1 `<AgentProvider>`

Wraps a subtree with agent context. Manages a `Conversation` instance from
`@mast-ai/core` and exposes it via the `useAgent()` hook.

```tsx
interface AgentProviderProps {
  runner: AgentRunner;
  agent: AgentConfig;
  children: React.ReactNode;
  icons?: IconMap;

  /**
   * Called before executing any tool call that has requiresApproval: true in
   * its ToolDefinition. Return true to proceed, false to cancel, a string to
   * short-circuit execution with a synthetic result, or INLINE_APPROVAL to
   * defer to the inline approval queue surfaced via useAgent().pendingApprovals.
   *
   * Also called for any tool whose name appears in approvalOverride, regardless
   * of the tool's own requiresApproval flag — allowing context-specific policy
   * (e.g. a sandbox environment that auto-approves everything, or a production
   * deployment that adds approval to a third-party tool it did not define).
   */
  onApprovalRequired?: (
    toolCall: ToolEventEntry,
  ) => Promise<boolean | string | typeof INLINE_APPROVAL>;

  /**
   * Runtime override of per-tool approval policy. Names in this set trigger
   * onApprovalRequired even if requiresApproval is false on the tool definition;
   * names prefixed with '!' suppress approval even if requiresApproval is true.
   * Example: approvalOverride={['extra_tool', '!safe_tool']}
   */
  approvalOverride?: string[];

  /**
   * Seed the conversation with a previously saved Message[] history.
   * The history is set on the underlying Conversation instance before the
   * first turn, allowing the LLM to continue from where it left off.
   */
  initialHistory?: Message[];

  /**
   * Seed the UI rendering state with a previously saved ConversationEntry[].
   * Use alongside initialHistory to fully restore a prior session.
   */
  initialEntries?: ConversationEntry[];

  /**
   * Called after each completed turn (not during streaming) with the latest
   * core message history and UI entry list. Use this to persist the conversation
   * to localStorage, IndexedDB, a server, or any other storage.
   * Not called when a run is cancelled or errors before completion.
   */
  onConversationChange?: (history: Message[], entries: ConversationEntry[]) => void;
}
```

**Internal state managed by `AgentProvider`:**

- `conversation` — `Conversation` instance (from `@mast-ai/core`)
- `entries` — `ConversationEntry[]` built by processing `AgentEvent` stream
- `isRunning` — boolean
- `abortController` — ref, replaced on each new run

### 4.2 `<ConversationPanel>`

Renders a complete chat UI as a single composable unit. Internally renders
`<MessageList>` and `<ChatInput>`. Requires `<AgentProvider>` as an ancestor.

```tsx
interface ConversationPanelProps {
  className?: string;

  /**
   * Replace the default tool call renderer. Called once per ToolEventEntry.
   * Receives a PendingApproval handle as the second argument when the call
   * is awaiting an inline approval decision (i.e. onApprovalRequired returned
   * INLINE_APPROVAL). Consumers compose <InlineApproval> and <ToolCallBlock>
   * inside this function to dispatch on tool name, awaiting state, or status.
   *
   * When omitted, the library renders <InlineApproval> for entries with a
   * pending approval handle and <ToolCallBlock> otherwise.
   */
  renderToolCall?: (entry: ToolEventEntry, approval?: PendingApproval) => React.ReactNode;

  /** Replace the default markdown renderer. Receives the raw text string. */
  renderMessage?: (text: string) => React.ReactNode;

  /** Placeholder text for the input field. */
  inputPlaceholder?: string;
}
```

Renders:

```html
<div data-mast-root class="mast-conversation-panel {className}">
  <MessageList renderToolCall="{...}" renderMessage="{...}" />
  <ChatInput placeholder="{...}" />
</div>
```

### 4.3 `<MessageList>`

Scrollable list of `ConversationEntry` items. Reads `entries` from context.
Uses `@tanstack/react-virtual` (`useVirtualizer`) to render only the visible window of
messages. Automatically scrolls to the bottom when a new entry is appended or the last
entry (currently streaming) changes size.

```tsx
interface MessageListProps {
  className?: string;
  renderToolCall?: (entry: ToolEventEntry) => React.ReactNode;
  renderMessage?: (text: string) => React.ReactNode;
}
```

The virtualizer uses dynamic item measurement (`measureElement`) so variable-height
messages (those with long tool call results or large markdown blocks) are handled
correctly. A `useEffect` that watches `entries.length` and the last entry's `text`
length drives the auto-scroll-to-bottom behaviour.

Renders:

```html
<div data-mast-message-list class="mast-message-list {className}" role="log" aria-live="polite">
  <div style="height: {totalSize}px; position: relative;">
    {virtualItems.map(item => (
    <div data-index="{item.index}" style="position: absolute; top: {item.start}px; width: 100%">
      <MessageItem entry="{entries[item.index]}" ... />
    </div>
    ))}
  </div>
</div>
```

### 4.4 `<MessageItem>`

Renders a single `ConversationEntry`. Delegates to `<UserMessage>` or
`<AssistantMessage>` based on `entry.role`.

```tsx
interface MessageItemProps {
  entry: ConversationEntry;
  className?: string;
  renderToolCall?: (entry: ToolEventEntry) => React.ReactNode;
  renderMessage?: (text: string) => React.ReactNode;
}
```

### 4.5 `<AssistantMessage>`

Renders an assistant turn: optional `<ThinkingBlock>`, zero or more
`<ToolCallBlock>` entries, then the final text. Text is rendered via the optional
`react-markdown` renderer or the `renderMessage` override.

```tsx
interface AssistantMessageProps {
  entry: ConversationEntry;
  className?: string;
  renderToolCall?: (entry: ToolEventEntry) => React.ReactNode;
  renderMessage?: (text: string) => React.ReactNode;
}
```

### 4.6 `<UserMessage>`

Renders a user turn as a simple text bubble.

```tsx
interface UserMessageProps {
  entry: ConversationEntry;
  className?: string;
}
```

### 4.7 `<ThinkingBlock>`

Collapsible section for the agent's thinking/reasoning trace.

```tsx
interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
  /** Default: 'Thinking Process' */
  label?: string;
}
```

- When `isStreaming` is true, shows a pulsing indicator next to the label.
- Collapsed by default; expands on click.
- Uses a native `<details>/<summary>` element so it works without JavaScript and is
  keyboard-accessible by default.

### 4.8 `<ToolCallBlock>`

Displays a single tool invocation with live streaming of sub-agent output.

```tsx
interface ToolCallBlockProps {
  entry: ToolEventEntry;
  className?: string;
}
```

- **Streaming state** (`isStreaming: true`): spinner icon; `subThinking` rendered in a
  collapsible `<ThinkingBlock>` that auto-expands while streaming; `subText` rendered
  as live markdown below the thinking block.
- **Completed state** (`isStreaming: false`): check mark icon; `subThinking` and
  `subText` remain visible (collapsed by default); `result` available in expanded view
  as formatted JSON.
- Tools that are not sub-agents will have no `subThinking` or `subText`; they show
  only the spinner → check transition and args/result.
- When `entry.nestedToolEvents` is non-empty, each nested tool call renders
  recursively inside the parent block, indented with a left border.
- Uses `<details>/<summary>` for args and result expand/collapse.

### 4.9 `<ChatInput>`

Text input wired to `sendMessage` from context. Handles Enter-to-send and
disabled state during streaming.

```tsx
interface ChatInputProps {
  className?: string;
  placeholder?: string;
  /** Overrides default send button content */
  sendLabel?: React.ReactNode;
  /** Overrides default cancel button content (shown while isRunning) */
  cancelLabel?: React.ReactNode;
  /**
   * Opt-in mention picker (see §13). When provided, the textarea is wrapped in
   * a compound input that renders inline chips for selected items and shows a
   * keyboard-navigable picker while the user types `@<query>`. On send, the
   * library calls `sendMessage(prompt, displayText)` so the user bubble shows
   * the chip form while the LLM receives the augmented prompt.
   *
   * Omit to keep the plain textarea behaviour unchanged.
   */
  mentions?: MentionsConfig;
}
```

- Pressing Enter (without Shift) submits.
- While `isRunning`, the send button becomes a cancel button that calls `cancel()`.
- Auto-grows vertically (using `rows` attribute, not fixed height).
- When `mentions` is provided the picker handles ArrowUp / ArrowDown / Enter /
  Escape; Enter only submits the message when the picker is closed.

---

## 5. Hooks

### `useAgent()`

Access agent state from any component inside `<AgentProvider>`.

```typescript
interface UseAgentReturn {
  messages: ConversationEntry[];
  history: Message[]; // raw core Message[] — read this to imperatively save state
  /**
   * Send a user message and start a new turn. The first argument is the prompt
   * delivered to the LLM. The optional second argument overrides what is
   * rendered in the user bubble; when omitted, the prompt is shown.
   */
  sendMessage: (text: string, displayText?: string) => void;
  cancel: () => void;
  isRunning: boolean;
  reset: () => void; // clears entries and history; starts a new Conversation
  /**
   * Tool calls awaiting an inline approval decision. Populated when
   * onApprovalRequired resolves to INLINE_APPROVAL. Each entry exposes
   * approve(), reject(), and respondWith() callbacks; the runner is paused
   * until one is called.
   */
  pendingApprovals: PendingApproval[];
}

interface PendingApproval {
  toolName: string;
  args: unknown;
  approve: () => void;
  reject: () => void;
  respondWith: (result: string) => void;
}

function useAgent(): UseAgentReturn;
```

Throws if called outside `<AgentProvider>`.

---

## 6. Icons

### 6.1 Strategy

Icons are **bundled inline** as small SVG React components. The library has no dependency
on `lucide-react` or any icon library. Consuming apps that prefer a different icon set
pass replacements via the `icons` prop on `<AgentProvider>`.

### 6.2 Default icon set

The following icons ship inside the package as hand-authored SVGs (~50–80 bytes each,
~500 bytes total gzipped):

| Key         | Used in                                      | Default appearance       |
| ----------- | -------------------------------------------- | ------------------------ |
| `brain`     | `<ThinkingBlock>` header                     | Simple brain outline     |
| `wrench`    | `<ToolCallBlock>` header (pending)           | Simple wrench outline    |
| `check`     | `<ToolCallBlock>` header (status: success)   | Checkmark circle         |
| `error`     | `<ToolCallBlock>` header (status: error)     | Crossed-out circle       |
| `cancelled` | `<ToolCallBlock>` header (status: cancelled) | Slashed circle           |
| `loader`    | Streaming / pending spinner                  | Animated spinning circle |
| `send`      | `<ChatInput>` send button                    | Filled arrow             |
| `stop`      | `<ChatInput>` cancel button                  | Filled square            |

### 6.3 `IconMap` type

```typescript
export interface IconMap {
  brain?: React.ReactNode;
  wrench?: React.ReactNode;
  check?: React.ReactNode;
  error?: React.ReactNode;
  cancelled?: React.ReactNode;
  loader?: React.ReactNode;
  send?: React.ReactNode;
  stop?: React.ReactNode;
}
```

All keys are optional. Unspecified keys fall back to the bundled defaults.

### 6.4 `icons` prop on `<AgentProvider>`

```tsx
interface AgentProviderProps {
  // ... existing props
  icons?: IconMap;
}
```

Icons are distributed to child components via a dedicated `IconContext` (separate from
agent state to avoid re-renders on state changes).

### 6.5 Lucide usage example

```tsx
import { Brain, Wrench, CircleCheck, LoaderCircle, Send, Square } from 'lucide-react';

<AgentProvider
  runner={runner}
  agent={agentConfig}
  icons={{
    brain: <Brain size={16} />,
    wrench: <Wrench size={16} />,
    check: <CircleCheck size={16} />,
    loader: <LoaderCircle size={16} className="mast-spin" />,
    send: <Send size={16} />,
    stop: <Square size={16} />,
  }}
>
  <ConversationPanel />
</AgentProvider>;
```

### 6.6 `useIcons()` hook (internal)

Components read icons via an internal `useIcons()` hook rather than accepting individual
icon props. This keeps the per-component API clean while still allowing app-wide
overrides.

```typescript
// internal — not exported
function useIcons(): Required<IconMap>;
```

---

## 7. Module Layout

```
packages/react-ui/
├── src/
│   ├── index.ts               — public exports
│   ├── context.tsx            — AgentProvider, AgentContext, useAgent
│   ├── icons.tsx              — IconMap type, IconContext, useIcons, bundled SVG defaults
│   ├── types.ts               — ConversationEntry, ToolEventEntry
│   ├── hooks/
│   │   └── useAgentStream.ts  — internal: builds ConversationEntry[] from AgentEvent
│   └── components/
│       ├── ConversationPanel.tsx
│       ├── MessageList.tsx
│       ├── MessageItem.tsx
│       ├── AssistantMessage.tsx
│       ├── UserMessage.tsx
│       ├── ThinkingBlock.tsx
│       ├── ToolCallBlock.tsx
│       └── ChatInput.tsx
├── styles/
│   └── default.css            — emitted as dist/styles.css
├── package.json
├── tsconfig.json
└── vite.config.ts             — library mode; externalises react, @mast-ai/core
```

### Public exports (`src/index.ts`)

```typescript
// Provider + hook
export { AgentProvider } from './context';
export { useAgent } from './context';

// Components
export { ConversationPanel } from './components/ConversationPanel';
export { MessageList } from './components/MessageList';
export { MessageItem } from './components/MessageItem';
export { AssistantMessage } from './components/AssistantMessage';
export { UserMessage } from './components/UserMessage';
export { ThinkingBlock } from './components/ThinkingBlock';
export { ToolCallBlock } from './components/ToolCallBlock';
export { ChatInput } from './components/ChatInput';

// Types
export type { ConversationEntry, ToolEventEntry, AgentProviderProps, IconMap } from './types';
```

CSS is a separate export path (`@mast-ai/react-ui/styles.css`) handled by the build
output, not imported from `index.ts`.

---

## 8. Streaming State Machine

`useAgentStream` subscribes to the `AgentEvent` stream from `AgentRunner` and
maintains `ConversationEntry[]` as follows:

| Event                                 | Action                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| User sends message                    | Append `{ role: 'user', text: displayText ?? prompt, isStreaming: false }`; pass `prompt` to `runStream`                                 |
| Run starts                            | Append `{ role: 'assistant', text: '', isStreaming: true }`                                                                              |
| `text_delta`                          | Mutate last entry: append `delta` to `text`                                                                                              |
| `thinking`                            | Mutate last entry: append `delta` to `thinking`                                                                                          |
| `tool_call_started`                   | Mutate last entry: push `{ id, type: 'tool_call_started', name, args, isStreaming: true }` to `toolEvents`                               |
| `onToolEvent` → `thinking`            | Mutate matching `ToolEventEntry`: append `delta` to `subThinking`                                                                        |
| `onToolEvent` → `text_delta`          | Mutate matching `ToolEventEntry`: append `delta` to `subText`                                                                            |
| `onToolEvent` → `tool_call_started`   | Mutate matching parent `ToolEventEntry`: push `{ id, type: 'tool_call_started', name, args, isStreaming: true }` onto `nestedToolEvents` |
| `onToolEvent` → `tool_call_completed` | Mutate matching nested `ToolEventEntry` (under the parent): set `result`, `isStreaming: false`, `status` from `event.error`              |
| Approval proxy notifies               | Mutate matching `ToolEventEntry`: set `awaitingApproval` to `true`/`false`                                                               |
| Approval proxy cancels                | Mutate matching `ToolEventEntry`: set `status: 'cancelled'` (sticky across `tool_call_completed`)                                        |
| `tool_call_completed`                 | Mutate matching `ToolEventEntry`: set `result`, `isStreaming: false`, `status` from `event.error` (preserving an existing `'cancelled'`) |
| `done`                                | Mutate last entry: set `text = output`, `isStreaming = false`                                                                            |
| Error / cancel                        | Mutate last entry: set `isStreaming = false`; optionally append error text                                                               |

`onToolEvent` events are wired by passing an `onToolEvent` handler to `RunBuilder` inside `useAgentStream`. Events are matched to the correct `ToolEventEntry` by `toolName`. The `done` event from a sub-agent is ignored — the parent's `tool_call_completed` is the authoritative signal that a tool finished.

State updates use `React.useState` with structural copies to trigger re-renders. The
last entry's `isStreaming` flag drives the pulsing indicator in `<ThinkingBlock>` and
the spinner in `<ToolCallBlock>`.

---

## 9. Tool Approval Flow (Optional)

### 9.1 Policy: `requiresApproval` on `ToolDefinition` (core change)

Approval intent is declared by the tool author on the tool definition:

```typescript
// @mast-ai/core — ToolDefinition extended
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval?: boolean; // tool author declares this tool is sensitive
}
```

This is the canonical signal. `requiresApproval: true` means "pause and ask a human
before executing this." The declaration lives next to the tool's name and description,
where it is discoverable, portable across all MAST runners, and set once rather than
per-app.

### 9.2 Mechanism: `onApprovalRequired` callback

`AgentProvider` pauses the run before executing any tool whose effective approval flag
is `true` and calls `onApprovalRequired`. The consuming app renders its own confirmation
UI and returns:

- `true` — proceed with the tool call as normal
- `false` — cancel the tool call; the runner receives a synthetic "user cancelled" result
- `string` — skip execution and inject this string as the tool result directly
- `INLINE_APPROVAL` — defer to the inline approval queue (see §9.3)

```tsx
<AgentProvider
  runner={runner}
  agent={agentConfig}
  onApprovalRequired={async (toolCall) => {
    if (toolCall.name === 'rich_tool') return INLINE_APPROVAL; // resolved inline
    return await myConfirmationDialog(toolCall); // resolved out-of-band
  }}
>
```

While `onApprovalRequired` (or the inline queue) is pending, the matching
`ToolEventEntry.awaitingApproval` is set to `true` so renderers can show a paused
indicator. The flag is cleared in a `try/finally` so it always resets, including when
the callback throws.

### 9.3 Inline approval queue

Returning `INLINE_APPROVAL` from `onApprovalRequired` enqueues a `PendingApproval`
handle on `useAgent().pendingApprovals` and pauses the runner until the consumer
calls `approve()`, `reject()`, or `respondWith(result)`:

```typescript
interface PendingApproval {
  toolName: string;
  args: unknown;
  approve: () => void; // resolves with `true`
  reject: () => void; // resolves with `false`
  respondWith: (result: string) => void; // resolves with the string
}
```

The library handles promise-resolver plumbing — consumers never call `new Promise`
themselves. Two ergonomic entry points use this queue:

**(a) Custom rendering via `renderToolCall`.** The single `renderToolCall` prop on
`<ConversationPanel>` / `<MessageList>` receives `(entry, approval?)`; when `approval`
is present the consumer can render any UI they like and wire the buttons directly to
`approval.approve()` / `approval.reject()`.

**(b) Built-in `<InlineApproval>` component.** Exported as a stand-alone component
that renders a default approve/reject card. Compose it inside `renderToolCall` for
tools that should use the default skin, or omit `renderToolCall` entirely — the
library uses it as the default for any awaiting entry with a handle.

When `reset()` is called while approvals are pending, the library calls `reject()`
on each so their proxies finish and the run terminates cleanly.

### 9.4 Runtime override: `approvalOverride`

The `approvalOverride` prop allows context-specific policy adjustments without touching
tool definitions:

```tsx
// A sandbox that suppresses approval for normally-sensitive tools:
<AgentProvider approvalOverride={['!delete_file']} ... />

// A high-trust workflow that adds approval to a third-party tool it didn't define:
<AgentProvider approvalOverride={['third_party_tool']} ... />
```

Names prefixed with `!` suppress approval even when the tool has `requiresApproval: true`.
Unprefixed names add approval even when the tool does not.

The effective approval decision for a tool named `name` is:

```
overrideSet = new Set(approvalOverride.filter(s => !s.startsWith('!')))
suppressSet = new Set(approvalOverride.filter(s => s.startsWith('!')).map(s => s.slice(1)))

needsApproval = (toolDef.requiresApproval || overrideSet.has(name)) && !suppressSet.has(name)
```

`onApprovalRequired` is not called when `needsApproval` is false, or when
`onApprovalRequired` is not provided (in which case tools with `requiresApproval: true`
execute without pausing — the callback is the opt-in).

---

## 10. Accessibility

- `<MessageList>` uses `role="log"` and `aria-live="polite"` so screen readers
  announce new messages.
- `<ThinkingBlock>` and `<ToolCallBlock>` use native `<details>/<summary>` elements,
  which are keyboard-accessible without JavaScript.
- `<ChatInput>` has an associated `<label>` (visually hidden) for screen readers.
- Send and cancel buttons have descriptive `aria-label` attributes.
- Streaming indicators (pulsing dots) are wrapped in `aria-hidden="true"` since they
  convey purely visual state already communicated via `aria-live`.

---

## 11. Testing Strategy

### 11.1 Stack

| Tool                          | Role                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| Vitest                        | Test runner (consistent with other packages in the monorepo) |
| `@testing-library/react`      | Component rendering and user-event simulation                |
| `jsdom`                       | DOM environment for Vitest                                   |
| `@testing-library/user-event` | Realistic keyboard/click interactions                        |

### 11.2 Unit tests

**`useAgentStream` (highest priority)**

The streaming state machine is the most complex logic in the library and the hardest
to verify manually. Tests use a mock `AgentRunner` that yields a scripted sequence of
`AgentEvent`s.

| Scenario                            | What is verified                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Text streaming                      | `text_delta` events accumulate into the last entry's `text`; `isStreaming` is true during and false after                                     |
| Thinking streaming                  | `thinking` deltas accumulate into `thinking`; co-exists with text deltas                                                                      |
| Tool call lifecycle                 | `tool_call_started` appends a pending `ToolEventEntry` with `isStreaming: true`; `tool_call_completed` sets `result` and `isStreaming: false` |
| Sub-agent thinking                  | `onToolEvent` → `thinking` appends to matching `ToolEventEntry.subThinking`                                                                   |
| Sub-agent text                      | `onToolEvent` → `text_delta` appends to matching `ToolEventEntry.subText`                                                                     |
| Sub-agent `done` ignored            | `onToolEvent` → `done` does not affect parent entry's `isStreaming`                                                                           |
| Nested tool calls                   | `onToolEvent` → `tool_call_started` pushes a nested entry onto the parent; `tool_call_completed` finalises it with `result` and `status`      |
| Multiple concurrent tool calls      | Each call tracked independently by name; sub-agent events routed to correct entry                                                             |
| `done` event                        | Sets `isStreaming: false`, finalises `text` from `output`                                                                                     |
| Error / cancel                      | Sets `isStreaming: false` on the last entry; prior entries unchanged                                                                          |
| New turn while previous is complete | Appends a new entry rather than mutating the last                                                                                             |

**Approval flow**

| Scenario                                    | What is verified                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Tool with `requiresApproval: true`          | `onApprovalRequired` is called before tool executes                                                                   |
| Callback returns `false`                    | Tool call is cancelled; runner receives synthetic "user cancelled" result                                             |
| Callback returns a string                   | Injected as the tool result; tool does not execute                                                                    |
| `approvalOverride` adds a name              | Unlisted tool triggers approval                                                                                       |
| `approvalOverride` suppresses with `!`      | Tool with `requiresApproval: true` executes without prompting                                                         |
| No `onApprovalRequired` provided            | Tools with `requiresApproval: true` execute silently                                                                  |
| `awaitingApproval` flag                     | Set while the callback is pending; cleared on resolve, reject, or throw                                               |
| `INLINE_APPROVAL` exposes `PendingApproval` | Handle appears on `useAgent().pendingApprovals` while waiting                                                         |
| `approve()` / `reject()` / `respondWith()`  | Resolve the proxy and remove the handle from the queue                                                                |
| `reset()` while pending                     | Rejects in-flight approvals so the run terminates                                                                     |
| Tool call status                            | `'success'` on normal return; `'error'` when `tool_call_completed.error` is true; `'cancelled'` when the user rejects |

**Conversation persistence**

| Scenario                            | What is verified                                               |
| ----------------------------------- | -------------------------------------------------------------- |
| `onConversationChange` fires        | Called with current `history` and `entries` after `done` event |
| Not called on cancel/error          | Callback not invoked when run ends without `done`              |
| `initialHistory` seeds core history | First turn sent to runner includes the provided prior messages |
| `initialEntries` seeds UI           | Pre-existing entries render immediately on mount               |
| `reset()` clears both               | After reset, `messages` is empty and `history` is empty        |
| `useAgent().history` reflects state | Returns the live `Conversation.history` after each turn        |

**Components**

| Component         | Scenarios tested                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `<ThinkingBlock>` | Renders collapsed by default; expands on click; shows pulse indicator when `isStreaming`                     |
| `<ToolCallBlock>` | Pending state (spinner, no result); completed state (check, result visible when expanded)                    |
| `<ChatInput>`     | Enter submits; Shift+Enter does not; button switches to cancel while `isRunning`; disabled while `isRunning` |
| `<MessageList>`   | Renders user and assistant entries; scrolls to bottom on new entry                                           |
| `<AgentProvider>` | `useAgent()` throws when called outside provider                                                             |
| Icon override     | Components render the custom node from `icons` prop instead of default SVG                                   |

### 11.3 File layout

Test files live alongside their source, following the convention of the other packages
in the monorepo.

```
packages/react-ui/src/
├── context.test.tsx
├── approval.test.tsx
├── hooks/
│   └── useAgentStream.test.ts
└── components/
    ├── ThinkingBlock.test.tsx
    ├── ToolCallBlock.test.tsx
    ├── ChatInput.test.tsx
    └── MessageList.test.tsx
```

---

## 12. Demo App (`apps/demo-react-ui`)

A Vite + React + TypeScript app in the monorepo that serves as both a manual test
surface and a reference implementation.

### Stack

| Concern     | Choice                                                                   |
| ----------- | ------------------------------------------------------------------------ |
| Bundler     | Vite                                                                     |
| LLM adapter | `@mast-ai/google-genai` (API key entered in-app, kept in `localStorage`) |
| Icons       | `lucide-react` (demonstrates icon override)                              |
| Markdown    | `react-markdown` + `remark-gfm` + `rehype-sanitize`                      |

The Gemini API key is **not** read from a Vite env var; baking it into the
bundle would leak it on any public deployment. The app gates rendering on a
key stored in `localStorage` and exposes a "Reset API key" button in the
header to clear it.

### What it demonstrates

1. **Minimal setup** — `<AgentProvider>` + `<ConversationPanel>` with a single CSS import
   and a `GoogleGenAIAdapter`.
2. **Custom icons** — all eight icon slots overridden with `lucide-react` equivalents
   (including the new `error` and `cancelled` slots).
3. **Tool call rendering** — five registered tools that exercise every status path:
   - `get_current_time` — read, no approval (success).
   - `get_page_title` — read, inline approval via the bundled `<InlineApproval>` (option b).
   - `set_page_title` — write, inline approval via a custom `renderToolCall` card that
     previews the proposed title (option a).
   - `copy_to_clipboard` — write, modal approval via `window.confirm` outside the chat.
   - `parse_integer` — read, no approval; throws on invalid input to surface the
     `'error'` status in `<ToolCallBlock>`.
     Tool bubbles are wrapped in a `<details>` so they start collapsed and can be
     expanded for arguments, sub-agent output, and the final result.
4. **Dark mode** — a toggle button that sets `theme="dark"` / `"light"` on
   `<ConversationPanel>`, demonstrating manual theme control alongside the OS default.
5. **Approval flow** — single `onApprovalRequired` callback dispatches by tool name:
   inline tools return `INLINE_APPROVAL`, the others fall through to `window.confirm`.
6. **Pending approvals queue** — header badge driven by `useAgent().pendingApprovals`.
7. **Multi-conversation persistence** — sidebar lists every saved conversation, the
   most recent is auto-loaded on page load, and each entry has a delete button.
   Save and restore are wired through `onConversationChange` plus `initialHistory` /
   `initialEntries`; switching conversations remounts the provider via a `key`
   keyed on the active conversation id. Storage backend is `localStorage`.
8. **In-app instructions** — a static right-hand panel listing example prompts
   (one per tool, one for `@`-mentions) and UI tips so a fresh visitor can drive
   the demo without external docs.

### File structure

```
apps/demo-react-ui/
├── src/
│   ├── main.tsx        — mounts App
│   ├── App.tsx         — API key gate + AgentProvider setup, tool registration, theme toggle, renderToolCall, conversation list + localStorage persistence, instructions panel
│   └── tools.ts        — five tool definitions covering every approval/status path
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## 13. Mention Pipeline (Optional)

### 13.1 Goal

Let consumers expose a `@`-triggered picker in `<ChatInput>` for referencing
arbitrary workspace items (documents, files, skills, users, …) without baking
any of those concepts into the library. Generic over a `MentionItem` shape.

### 13.2 Data types

```typescript
export interface MentionItem<T = unknown> {
  /** Stable key. */
  id: string;
  /** Shown in the picker row and used as the chip text after `@`. */
  label: string;
  /** Optional secondary text rendered alongside `label` in the picker. */
  description?: string;
  /** Arbitrary payload accessible to `buildPrompt` and `renderItem`. */
  data?: T;
}

export interface MentionSegment<T = unknown> {
  /** Plain text preceding the chip. */
  text: string;
  /** The mentioned item that terminates this segment. */
  item: MentionItem<T>;
}
```

The compound input is modelled as `MentionSegment<T>[]` followed by a
`trailingInput` string. Selecting an item from the picker converts the
in-progress `@<query>` into a chip and starts a new trailing-text region.

### 13.3 Configuration

```typescript
export interface MentionsConfig<T = unknown> {
  /** Trigger character. Default: '@'. */
  trigger?: string;
  /**
   * Static item list. The picker filters by case-insensitive substring on
   * `label`. Mutually exclusive with `onSearch`.
   */
  items?: MentionItem<T>[];
  /**
   * Async/sync search function. Called with the current query string each
   * time it changes. The latest result wins (stale resolutions are ignored).
   */
  onSearch?: (query: string) => MentionItem<T>[] | Promise<MentionItem<T>[]>;
  /** Render a custom row in the picker. Default: `<div>{item.label}</div>`. */
  renderItem?: (item: MentionItem<T>, isActive: boolean) => React.ReactNode;
  /**
   * Render the chip that replaces the `@<query>` once selected. Default: the
   * library renders `@<label>` with a remove button.
   */
  renderChip?: (item: MentionItem<T>, onRemove: () => void) => React.ReactNode;
  /**
   * Build the prompt sent to the LLM from the segment list and trailing text.
   * Default: returns the inline display form (segments joined as
   * `<text>@<label>...<trailing>`).
   *
   * Apps that want to inject context (document IDs, file paths, …) override
   * this to prepend or wrap the inline text.
   */
  buildPrompt?: (segments: MentionSegment<T>[], trailing: string) => string;
}
```

`<ChatInput mentions={...}>` and `<ConversationPanel mentions={...}>` accept
the config; `<ConversationPanel>` forwards it to its internal `<ChatInput>`.

### 13.4 `useMentions` hook

For consumers building bespoke inputs.

```typescript
export interface UseMentionsReturn<T = unknown> {
  /** Committed segments preceding the trailing text. */
  segments: MentionSegment<T>[];
  /** Text after the last chip (or the entire field when no chips). */
  trailingInput: string;
  /** Current `@<query>` if the cursor is inside an in-progress mention. */
  mentionQuery: string | null;
  /** Filtered item list to render in the picker. */
  filteredItems: MentionItem<T>[];
  /** Index of the highlighted picker row. */
  pickerIndex: number;

  /** Wire to the textarea's `value`/`onChange`. */
  setTrailingInput: (text: string) => void;
  /** Wire to the textarea's `onKeyDown`. Returns `true` if the event was consumed. */
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Append a chip and reset the in-progress mention. */
  selectItem: (item: MentionItem<T>) => void;
  /** Remove a chip by id, re-merging its preceding text into the next region. */
  removeChip: (id: string) => void;
  /** Build `{ prompt, displayText }` for `sendMessage`. */
  buildSubmission: () => { prompt: string; displayText: string };
  /** Clear all segments and trailing text. */
  clear: () => void;
}

export function useMentions<T = unknown>(config: MentionsConfig<T>): UseMentionsReturn<T>;
```

`handleKeyDown` consumes Up / Down / Enter / Escape only when
`mentionQuery !== null && filteredItems.length > 0`. Other keys (including
Enter when the picker is closed) fall through unchanged so the host textarea
can perform its own submit handling.

### 13.5 Pure utilities

Exported alongside the hook for advanced consumers.

```typescript
/** Returns the `@<query>` suffix at the end of `input`, or `null`. */
export function extractMentionQuery(input: string, trigger?: string): string | null;
/** Strips a trailing `@<query>` from `input`. */
export function removeMentionTrigger(input: string, trigger?: string): string;
/** Default prompt builder: `<text>@<label>...<trailing>`. */
export function buildInlineMentionPrompt<T>(
  segments: MentionSegment<T>[],
  trailing: string,
): string;
```

### 13.6 Send-time behaviour

`<ChatInput>` with a `mentions` prop calls
`sendMessage(prompt, displayText)` from `useAgent()`, where:

- `displayText` is `segments.map(s => `${s.text}@${s.item.label}`).join('') + trailing` (always inline; not configurable beyond `renderChip` for the in-input rendering).
- `prompt` is `mentions.buildPrompt?.(segments, trailing) ?? displayText`.

The user `ConversationEntry.text` is set to `displayText`; the LLM-bound
input passed to `Conversation.runStream` is `prompt`. When `mentions` is
omitted, the existing single-argument call is preserved.

### 13.7 Styling

New CSS classes and tokens scoped under `[data-mast-root]`:

| Class                        | Purpose                                            |
| ---------------------------- | -------------------------------------------------- |
| `mast-mention-input`         | Compound wrapper containing chips + textarea       |
| `mast-mention-chip`          | Single chip rendering `@<label>` and remove button |
| `mast-mention-chip-remove`   | Remove (`x`) button inside a chip                  |
| `mast-mention-picker`        | Floating picker popover                            |
| `mast-mention-picker-item`   | A single picker row                                |
| `mast-mention-picker-active` | Modifier for the keyboard-highlighted row          |

| Token                             | Default (light)               | Default (dark)               |
| --------------------------------- | ----------------------------- | ---------------------------- |
| `--mast-mention-chip-bg`          | `#dbeafe`                     | `#1e3a8a`                    |
| `--mast-mention-chip-fg`          | `#1e3a8a`                     | `#bfdbfe`                    |
| `--mast-mention-picker-bg`        | `--mast-bg`                   | `--mast-bg`                  |
| `--mast-mention-picker-active-bg` | `--mast-bg-subtle`            | `--mast-bg-subtle`           |
| `--mast-mention-picker-shadow`    | `0 4px 12px rgba(0,0,0,0.08)` | `0 4px 12px rgba(0,0,0,0.4)` |

### 13.8 Accessibility

- Picker uses `role="listbox"` with `role="option"` rows; the active row
  carries `aria-selected="true"`.
- The textarea owns the `aria-activedescendant` attribute pointing at the
  active row's id when the picker is open, so screen readers track keyboard
  navigation.
- Each chip's remove button has `aria-label` of the form `Remove reference to
${item.label}`.

### 13.9 Module additions

```
packages/react-ui/src/
└── mentions/
    ├── index.ts            — re-exports
    ├── types.ts            — MentionItem, MentionSegment, MentionsConfig
    ├── utils.ts            — extractMentionQuery, removeMentionTrigger, buildInlineMentionPrompt
    ├── useMentions.ts      — hook
    └── MentionPicker.tsx   — internal picker popover (used by ChatInput)
```

Public exports added to `src/index.ts`:

```typescript
export { useMentions } from './mentions/useMentions';
export {
  extractMentionQuery,
  removeMentionTrigger,
  buildInlineMentionPrompt,
} from './mentions/utils';
export type { MentionItem, MentionSegment, MentionsConfig, UseMentionsReturn } from './mentions';
```

### 13.10 Testing additions

| Scenario                                    | What is verified                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `extractMentionQuery`                       | Returns query when input ends with `@<chars>`; `null` after a space; respects custom `trigger`   |
| `useMentions` segment management            | Selecting an item appends a segment with the preceding text; removing a chip re-merges text      |
| Picker keyboard navigation                  | ArrowDown/ArrowUp wrap; Enter selects the active item; Escape closes the picker                  |
| Async `onSearch`                            | Stale resolutions are discarded; latest query wins                                               |
| `<ChatInput mentions>` send                 | Calls `sendMessage(prompt, displayText)` with prompt from `buildPrompt` and inline `displayText` |
| `useAgent().sendMessage(text, displayText)` | User entry's `text` is `displayText`; `Conversation.runStream` receives the `text` argument      |
| `mentions` omitted                          | `<ChatInput>` renders unchanged and calls `sendMessage(text)` (single argument)                  |

## 14. Post-Implementation Deliverables

The following are required before the feature is considered complete. They are deferred
until the package and demo are implemented and manually verified.

### 14.1 Developer documentation (`docs/react-ui/USAGE.md`)

A usage guide covering:

- Installation (peer deps, optional deps, CSS import)
- Basic setup with `GoogleGenAIAdapter`
- Registering tools
- Custom icons (lucide-react example)
- Dark mode and theming (CSS variable overrides)
- Custom tool call rendering (`renderToolCall` prop)
- Custom message rendering (`renderMessage` prop)
- Composing a custom layout with primitives (`MessageList` + `ChatInput`)
- Fully headless usage via `useAgent()`
- Approval flow (`requiresApproval` on `ToolDefinition` + `onApprovalRequired` callback)
- Mention pipeline (`mentions` prop on `<ChatInput>` / `<ConversationPanel>`, `useMentions` for bespoke inputs, `sendMessage(text, displayText)` for prompt/display split)

### 14.2 Skill update (`skills/mast-ai/`)

- Add `@mast-ai/react-ui` to the Core Concepts list in `SKILL.md`
- Add a reference link to `references/react-ui.md` in `SKILL.md`
- Create `skills/mast-ai/references/react-ui.md` mirroring the USAGE.md content in
  reference format
- Add `skills/mast-ai/assets/react-ui-basic.tsx` — a minimal working example showing
  `AgentProvider` + `ConversationPanel` with `GoogleGenAIAdapter`
