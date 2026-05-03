# Implementation Plan: @mast-ai/react-ui

Each issue below leaves the project in a state that builds, lints, and passes tests.
The demo app and tests are built in tandem with the library — no issue ships library
code without its corresponding tests, and the demo is wired progressively.

---

## Issue 1 — Package scaffolding

Set up the two new workspace members so the monorepo builds end-to-end with the new
packages present but empty.

**`packages/react-ui`**

- `package.json`: name, peer deps (`react`, `react-dom`, `@mast-ai/core`,
  `@tanstack/react-virtual`), optional deps (`react-markdown`, `remark-gfm`,
  `rehype-sanitize`), dev deps (Vite, Vitest, `@testing-library/react`,
  `@testing-library/user-event`, `jsdom`, TypeScript)
- `vite.config.ts`: library mode, externalises react and `@mast-ai/core`
- `vitest.config.ts`: jsdom environment
- `tsconfig.json`
- `src/index.ts`: empty
- `styles/default.css`: empty

**`apps/demo-react-ui`**

- Vite + React + TypeScript app, `package.json` with workspace deps
  (`@mast-ai/react-ui`, `@mast-ai/google-genai`, `lucide-react`,
  `react-markdown`, `remark-gfm`, `rehype-sanitize`)
- `src/App.tsx`: placeholder "coming soon" UI
- `.env.example`: `VITE_GEMINI_API_KEY=your_key_here`

Both packages added to the root workspace `package.json`.

---

## Issue 2 — Core types and `useAgentStream`

The streaming state machine is the heart of the library. Ship it fully tested before
any component depends on it.

**`packages/react-ui/src/types.ts`**

- `ConversationEntry`, `ToolEventEntry`, `IconMap` (as specified in SPEC §3 and §6.3)

**`packages/react-ui/src/hooks/useAgentStream.ts`**

- Subscribes to `AgentEvent` stream from a `Conversation` instance
- Builds and maintains `ConversationEntry[]` per the state table in SPEC §8

**`src/hooks/useAgentStream.test.ts`**

- All scenarios from SPEC §11.2: text streaming, thinking, tool call lifecycle,
  sub-agent thinking and text via `onToolEvent`, sub-agent `done` ignored,
  concurrent tool calls, `done`, error/cancel, new turn sequencing

Exported from `src/index.ts`.

No demo wiring — the hook is internal and cannot be used without `AgentProvider`.

**Depends on:** Issue 1

---

## Issue 3 — `AgentProvider` and `useAgent` hook

**`packages/react-ui/src/context.tsx`**

- `AgentProvider`: creates a `Conversation` from `runner.conversation(agent)`,
  invokes `useAgentStream`, exposes state via `AgentContext`
- `useAgent()`: reads context, throws with a clear message if called outside the provider

**`src/context.test.tsx`**

- `useAgent()` throws outside provider
- `useAgent()` returns `{ messages, sendMessage, cancel, isRunning, reset }`
- `reset()` clears entries and creates a fresh `Conversation`

Exported from `src/index.ts`.

**`apps/demo-react-ui`** — first functional wiring:

- `src/tools.ts`: `get_current_time` tool (returns `new Date().toISOString()`)
- `App.tsx`: wrap with `AgentProvider` (using `GoogleGenAIAdapter` + `VITE_GEMINI_API_KEY`),
  register `get_current_time`, render a minimal custom UI with `useAgent()`:
  raw `<ul>` of entries (text only) + `<textarea>` + send/cancel `<button>`s
- The demo is now a functional end-to-end chat, albeit unstyled

**Depends on:** Issue 2

---

## Issue 4 — Icon system

**`packages/react-ui/src/icons.tsx`**

- Six hand-authored inline SVG components (brain, wrench, check, loader, send, stop)
- `IconContext` and `useIcons()` internal hook
- `IconMap` type (re-exported from `src/index.ts`)
- `icons` prop wired into `AgentProvider` (update `AgentProviderProps`)

**`src/context.test.tsx`** (extend)

- Custom icon node from `icons` prop is rendered in place of bundled default

**`apps/demo-react-ui`**

- Pass all six `lucide-react` icon slots via the `icons` prop on `AgentProvider`

**Depends on:** Issue 3

---

## Issue 5 — `ThinkingBlock` and `ToolCallBlock`

Sub-issues:

- **5a — `ThinkingBlock`**: `<details>/<summary>` element, pulsing indicator when
  `isStreaming`, uses `brain` icon from `useIcons()`. Tests: collapsed by default,
  expands on click, pulse indicator present/absent.
- **5b — `ToolCallBlock`**: three states — streaming (spinner, `subThinking` in an
  auto-expanded `ThinkingBlock`, `subText` as live markdown), completed (check mark,
  everything collapsed, `result` available), and plain tool with no sub-agent output
  (spinner → check, args/result only). Uses `wrench`/`check`/`loader` icons. Tests:
  all three states rendered correctly; `subThinking` and `subText` absent for plain
  tools.

**`apps/demo-react-ui`**

- Replace raw tool-call rendering in `App.tsx` with `ThinkingBlock` and `ToolCallBlock`

**Depends on:** Issue 4

---

## Issue 6 — `UserMessage` and `AssistantMessage`

**`UserMessage`**: renders `entry.text` in a user bubble.

**`AssistantMessage`**: renders `ThinkingBlock` (if `entry.thinking`), zero or more
`ToolCallBlock`s, then final text. Text rendered via `react-markdown` +
`rehype-sanitize` when available; plain `<p>` fallback otherwise. Accepts
`renderMessage` and `renderToolCall` override props.

No dedicated tests beyond what Issue 5 already covers; component correctness is
verified through `MessageList` tests in Issue 8.

**`apps/demo-react-ui`**

- Replace per-entry rendering in `App.tsx` with `UserMessage` and `AssistantMessage`

**Depends on:** Issue 5

---

## Issue 7 — `ChatInput`

**`packages/react-ui/src/components/ChatInput.tsx`**

- Textarea that grows with content
- Enter submits, Shift+Enter inserts newline
- Send button → calls `sendMessage`; swaps to cancel button while `isRunning`
- Uses `send`/`stop` icons from `useIcons()`
- Accepts `sendLabel`, `cancelLabel`, `placeholder`, `className` props

**`src/components/ChatInput.test.tsx`**

- All scenarios from SPEC §11.2: Enter submits, Shift+Enter does not, cancel button
  appears while running

**`apps/demo-react-ui`**

- Replace the raw `<textarea>` + `<button>`s in `App.tsx` with `ChatInput`

**Depends on:** Issue 4 (icons), Issue 3 (useAgent)

---

## Issue 8 — `MessageList` with virtual scrolling

**`packages/react-ui/src/components/MessageList.tsx`**

- `useVirtualizer` from `@tanstack/react-virtual` with `measureElement` for dynamic
  item heights
- `useEffect` that scrolls to the bottom when `entries.length` grows or the last
  streaming entry's `text` length changes
- `role="log"` / `aria-live="polite"` for accessibility
- Accepts `renderToolCall` and `renderMessage` override props

**`src/components/MessageList.test.tsx`**

- Renders user and assistant entries; scrolls to bottom on new entry

**`apps/demo-react-ui`**

- Replace the raw `<ul>` in `App.tsx` with `MessageList`

**Depends on:** Issue 6

---

## Issue 9 — `ConversationPanel` and default CSS

**`packages/react-ui/src/components/ConversationPanel.tsx`**

- Thin compositor: renders `MessageList` + `ChatInput` inside a `[data-mast-root]` div
- Accepts `theme`, `className`, `renderToolCall`, `renderMessage`, `inputPlaceholder`
- Sets `data-mast-theme` attribute from `theme` prop

**`styles/default.css`**

- Full light theme (CSS custom properties on `[data-mast-root]`)
- `prefers-color-scheme: dark` block
- `[data-mast-theme="dark"]` explicit override block
- All `mast-*` class rules for every component

**`apps/demo-react-ui`**

- Replace `MessageList` + `ChatInput` in `App.tsx` with `ConversationPanel`
- Import `@mast-ai/react-ui/styles.css`
- Add a dark mode toggle button that sets the `theme` prop on `ConversationPanel`

**Depends on:** Issue 7, Issue 8

---

## Issue 10 — Add `requiresApproval` to `@mast-ai/core` `ToolDefinition`

Extend the `ToolDefinition` interface in `packages/core/src/tool.ts`:

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval?: boolean;
}
```

No behaviour change in core — the field is metadata only at this stage. Update
existing core tests to confirm the field is accepted without error.

No demo wiring — the field has no visible effect until Issue 11.

**Depends on:** (none — independent change)

---

## Issue 11 — Approval flow

**`AgentProvider`** wraps the `ToolRegistry` with an approval proxy: for each tool
whose `needsApproval` is true (per the logic in SPEC §9.3), the proxy calls
`onApprovalRequired` before delegating to the real tool. Adds `onApprovalRequired` and
`approvalOverride` to `AgentProviderProps`.

```
needsApproval = (def.requiresApproval || overrideSet.has(name)) && !suppressSet.has(name)
```

**`src/approval.test.tsx`**

- All six scenarios from SPEC §11.2: `requiresApproval: true` triggers callback;
  callback returns `false` / `string` / `true`; `approvalOverride` adds and suppresses;
  no callback → silent execution.

**`apps/demo-react-ui`**

- Add `get_page_title` tool to `src/tools.ts` (returns `document.title`, marked
  `requiresApproval: true`)
- Register `get_page_title` and wire `onApprovalRequired` to `window.confirm`

**Depends on:** Issue 3, Issue 10

---

## Issue 11b — Conversation persistence

Extends `AgentProvider` with save/load hooks.

**`AgentProviderProps` additions**

- `initialHistory?: Message[]` — seeds `Conversation.history` before the first turn
- `initialEntries?: ConversationEntry[]` — seeds the UI entry list on mount
- `onConversationChange?: (history: Message[], entries: ConversationEntry[]) => void` — fired after each completed turn

**`useAgent()` addition**

- `history: Message[]` — live reference to the underlying `Conversation.history`

**`src/context.test.tsx`** (extend)

- `onConversationChange` fires after `done`; not fired on cancel or error
- `initialHistory` is set on the `Conversation` before the first run
- `initialEntries` populates `messages` immediately on mount
- `reset()` clears both `messages` and `history`
- `useAgent().history` reflects current core state

**`apps/demo-react-ui`**

- Wire `onConversationChange` to persist `history` and `entries` to `localStorage`
- Pass `initialHistory` and `initialEntries` loaded from `localStorage` on startup

**Depends on:** Issue 3 (AgentProvider)

---

## Issue 12 — Demo verification and polish

By this point the demo has been wired progressively and should be fully functional.
This issue is a dedicated pass to verify correctness end-to-end and add any remaining
polish before the library is considered complete.

- Manually verify all demo features work together: chat, tool calls, approval dialog,
  dark mode toggle, conversation persistence across page reloads
- Fix any integration issues discovered during manual testing
- Clean up any temporary stubs or placeholder code left from earlier issues
- Confirm `npm run build && npm run lint` still pass from the repo root

**Depends on:** Issue 9, Issue 11, Issue 11b

---

## Issue 13 — `sendMessage(text, displayText?)` overload

Foundation for any pipeline that needs the user bubble to render something
different from the prompt sent to the LLM (mention chips, slash-command
expansion, redaction, translation).

**`packages/react-ui/src/hooks/useAgentStream.ts`**

- Extend `sendMessage` signature to `(text: string, displayText?: string) => void`
- The user `ConversationEntry.text` becomes `displayText ?? text`
- The `text` argument is passed unchanged to `Conversation.runStream` so the
  LLM sees the prompt
- No change to `Conversation.history` semantics — core treats the input as it
  always has

**`packages/react-ui/src/context.tsx`**

- Update `UseAgentReturn.sendMessage` signature to accept `displayText`
- Forward the second argument to `useAgentStream`

**Tests** (extend `useAgentStream.test.ts`)

- Single-argument call still sets user-bubble text equal to the prompt
- Two-argument call sets user-bubble text to `displayText` while the runner
  receives `text`
- `displayText` of empty string is treated as a deliberate override (not a
  fallback to `text`)

No demo wiring — the change is API-level and additive. Demo updates land
with Issue 14.

**Depends on:** Issue 3 (`AgentProvider` and `useAgent`)

---

## Issue 14 — Mention pipeline (`@`-trigger picker for ChatInput)

Optional, opt-in feature mirroring the `@`-mention UX from
[agent-text-editor](https://github.com/andreban/agent-text-editor) and similar
editors. Default `<ChatInput>` behaviour is unchanged when the new prop is
omitted.

Implementation lives in a new `packages/react-ui/src/mentions/` directory
following the layout in SPEC §13.9.

### 14a — Pure utilities and types

- `mentions/types.ts`: `MentionItem<T>`, `MentionSegment<T>`, `MentionsConfig<T>`
- `mentions/utils.ts`: `extractMentionQuery`, `removeMentionTrigger`,
  `buildInlineMentionPrompt`
- Tests for each utility (regex edge cases, custom trigger character)
- Re-exports added to `src/index.ts`

### 14b — `useMentions` hook

- Encapsulates segment / trailing / query / picker-index state
- Exposes `setTrailingInput`, `handleKeyDown`, `selectItem`, `removeChip`,
  `buildSubmission`, `clear`
- Supports both `items` (sync filter on `label`) and `onSearch`
  (async; stale resolutions ignored)
- Tests covering segment management, picker keyboard navigation, async search

### 14c — `<ChatInput mentions>` integration and CSS

- Optional `mentions` prop on `<ChatInput>` and `<ConversationPanel>`
- When provided: render the compound input (chips + textarea), the picker
  popover, and call `sendMessage(prompt, displayText)` on submit
- New CSS rules for `mast-mention-input`, `mast-mention-chip`,
  `mast-mention-picker` (and friends) added to `styles/default.css` with
  light/dark token overrides per SPEC §13.7
- Accessibility: `role="listbox"` / `role="option"`, `aria-selected`,
  `aria-activedescendant` on the textarea, descriptive remove-button
  `aria-label` (SPEC §13.8)
- Tests covering the integrated send path and the no-prop fallback

### 14d — Demo wiring

- Add a small in-memory list of "documents" (e.g. fake markdown files) to
  `apps/demo-react-ui/src/App.tsx`
- Pass `mentions={{ items, buildPrompt }}` to `<ConversationPanel>`
- Demonstrate `buildPrompt` injecting a "The user has referenced..." preamble
  while the user bubble shows the inline `@title` form
- Manually verify keyboard navigation, chip removal, and Enter-vs-submit
  precedence

**Depends on:** Issue 13 (`sendMessage` overload), Issue 9 (ConversationPanel + CSS)

---

## Issue 15 — Post-implementation deliverables

Sub-issues:

- **15a — Developer documentation**: `docs/react-ui/USAGE.md` covering all topics
  from SPEC §14.1 (including the new mention pipeline section)
- **15b — Skill update**: add `@mast-ai/react-ui` to `skills/mast-ai/SKILL.md`,
  create `skills/mast-ai/references/react-ui.md`, add
  `skills/mast-ai/assets/react-ui-basic.tsx` (as specified in SPEC §14.2)

**Depends on:** Issue 12, Issue 14
