# `@mast-ai/react-ui` Usage Guide

`@mast-ai/react-ui` turns an `AgentRunner` from `@mast-ai/core` into a streaming
chat UI. It ships a default theme, a complete `<ConversationPanel>` widget, and
every primitive needed to compose a bespoke layout. This guide walks through the
common use cases. The corresponding API reference lives in
[`SPEC.md`](./SPEC.md); the design rationale is in [`PRD.md`](./PRD.md).

> Every snippet below is valid TypeScript / TSX as written. Imports from
> `@mast-ai/react-ui` are correct as of the current SPEC.

---

## Table of contents

1. [Installation](#1-installation)
2. [Basic setup with `GoogleGenAIAdapter`](#2-basic-setup-with-googlegenaiadapter)
3. [Registering tools](#3-registering-tools)
4. [Custom icons (`lucide-react` example)](#4-custom-icons-lucide-react-example)
5. [Theming](#5-theming)
6. [Custom tool call rendering (`renderToolCall`)](#6-custom-tool-call-rendering-rendertoolcall)
7. [Custom message rendering (`renderMessage`)](#7-custom-message-rendering-rendermessage)
8. [Composing a custom layout with primitives](#8-composing-a-custom-layout-with-primitives)
9. [Fully headless usage via `useAgent()`](#9-fully-headless-usage-via-useagent)
10. [Approval flow](#10-approval-flow)
11. [Nested sub-agent tool calls](#11-nested-sub-agent-tool-calls)
12. [Mention pipeline (`@`-mentions)](#12-mention-pipeline--mentions)
13. [Overriding tool call labels (`getToolLabel`)](#13-overriding-tool-call-labels-gettoollabel)

---

## 1. Installation

```bash
npm install @mast-ai/core @mast-ai/react-ui @tanstack/react-virtual react react-dom
```

`@tanstack/react-virtual` is a required peer dependency: `<MessageList>` uses
virtual scrolling because agent conversations grow unboundedly during long
sessions. `react` and `react-dom` must be 19.0 or newer.

Pick one or more LLM adapters to drive the runner. The examples in this guide
use `@mast-ai/google-genai`:

```bash
npm install @mast-ai/google-genai
```

Optional dependencies, installed only if you want them:

| Package                                           | Used for                                    |
| ------------------------------------------------- | ------------------------------------------- |
| `react-markdown`, `remark-gfm`, `rehype-sanitize` | Markdown rendering inside assistant bubbles |
| `lucide-react` (or any other icon set)            | Replacing the bundled inline SVG icons      |

When `react-markdown` is installed it is detected at runtime. Sanitisation via
`rehype-sanitize` is always applied; consumers that need unrestricted HTML
should pass a `renderMessage` prop instead (see §7).

### CSS import

The default stylesheet is published as a separate export. Import it once at the
top of your app entry:

```ts
import '@mast-ai/react-ui/styles.css';
```

It is plain CSS (no PostCSS plugins, no Tailwind config) and uses CSS custom
properties scoped under `[data-mast-root]` so it does not collide with global
styles. Skip the import entirely if you want the headless behaviour.

---

## 2. Basic setup with `GoogleGenAIAdapter`

Three lines of JSX, no styling configuration:

```tsx
import { AgentRunner, ToolRegistry, createAgent } from '@mast-ai/core';
import { GoogleGenAIAdapter } from '@mast-ai/google-genai';
import { AgentProvider, ConversationPanel } from '@mast-ai/react-ui';
import '@mast-ai/react-ui/styles.css';

const runner = new AgentRunner(
  new GoogleGenAIAdapter(import.meta.env.VITE_GEMINI_API_KEY),
  new ToolRegistry(),
);

const agent = createAgent({
  name: 'Assistant',
  instructions: 'You are a helpful assistant.',
});

export default function App() {
  return (
    <AgentProvider runner={runner} agent={agent}>
      <ConversationPanel />
    </AgentProvider>
  );
}
```

`<AgentProvider>` owns a `Conversation` instance from `@mast-ai/core`, drives it
with the agent runner, and exposes the streaming state to descendants through
`useAgent()`. `<ConversationPanel>` renders a complete chat UI and must be
nested inside the provider.

> Do not bake the API key into a public bundle. The reference demo
> (`apps/demo-react-ui`) prompts for the key at runtime and stores it in
> `localStorage`; production apps should fetch a short-lived token from a
> backend instead.

---

## 3. Registering tools

Tools are registered with the `ToolRegistry` before the runner is constructed.
The runner sends each tool's `definition()` to the LLM and the registry
resolves names to implementations at call time. The browser owns tool
execution; the server (when running in hybrid mode) only sees metadata.

```tsx
import { AgentRunner, ToolRegistry, createAgent } from '@mast-ai/core';
import type { Tool, ToolContext } from '@mast-ai/core';
import { GoogleGenAIAdapter } from '@mast-ai/google-genai';
import { AgentProvider, ConversationPanel } from '@mast-ai/react-ui';

class GetCurrentTimeTool implements Tool {
  definition() {
    return {
      name: 'get_current_time',
      description: 'Returns the current time as an ISO 8601 string.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      scope: 'read' as const,
    };
  }

  async call(_args: unknown, _context: ToolContext): Promise<string> {
    return new Date().toISOString();
  }
}

const registry = new ToolRegistry().register(new GetCurrentTimeTool());
const runner = new AgentRunner(new GoogleGenAIAdapter(GEMINI_API_KEY), registry);

const agent = createAgent({
  name: 'Assistant',
  instructions:
    'You are a helpful assistant. Call get_current_time when the user asks ' +
    'about the current time.',
  tools: ['get_current_time'],
});

export default function App() {
  return (
    <AgentProvider runner={runner} agent={agent}>
      <ConversationPanel />
    </AgentProvider>
  );
}
```

Two details that bite first-time users:

- The `tools` array on `createAgent` is the LLM's allowlist for the turn. A tool
  registered on the registry but missing from this list is invisible to the
  model.
- `scope: 'read' | 'write'` is required on every definition. The runner uses it
  to filter which tools are passed to the model when scope-based filtering is
  in use.

For tools that should pause for human confirmation, see §10.

---

## 4. Custom icons (`lucide-react` example)

The library ships eight inline SVG icons (~500 bytes total gzipped) so the
package has no icon dependency. Override any subset via the `icons` prop on
`<AgentProvider>`:

```tsx
import { Brain, CircleCheck, CircleX, LoaderCircle, Send, Square, Wrench } from 'lucide-react';
import { AgentProvider, type IconMap } from '@mast-ai/react-ui';

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

<AgentProvider runner={runner} agent={agent} icons={icons}>
  <ConversationPanel />
</AgentProvider>;
```

Unspecified keys fall back to the bundled defaults. The `mast-spin` class is
defined in the default stylesheet and rotates the loader icon.

---

## 5. Theming

Every visual value in the default stylesheet is a CSS custom property scoped
under `[data-mast-root]`, so consumers can override individual tokens, swap the
whole palette, or remap every token onto an existing design system without
`!important` and without forking the stylesheet.

### 5.1 Dark mode

The default stylesheet ships a light theme and an automatic dark theme that
follows `prefers-color-scheme`. Apps that manage their own theme switching can
force a value with the `theme` prop on `<ConversationPanel>`:

```tsx
<ConversationPanel theme="dark" />   // force dark
<ConversationPanel theme="light" />  // force light
<ConversationPanel />                // follow OS (default)
```

The prop sets `data-mast-theme` on the panel root. The default stylesheet
selects on that attribute so OS preferences are overridden without
`!important`. When composing primitives directly (see §8), set
`data-mast-theme={theme}` yourself on the element that carries `data-mast-root`.

### 5.2 Token reference

Every token below is defined on `[data-mast-root]` in the default stylesheet
and is safe to override at any scope.

| Token                             | Used by                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| `--mast-bg`                       | Panel background, args/result panes, mention picker background |
| `--mast-bg-subtle`                | Message list background, code blocks, picker hover row         |
| `--mast-fg`                       | Body text                                                      |
| `--mast-fg-muted`                 | Secondary text (chevrons, "show args" labels, descriptions)    |
| `--mast-border`                   | Panel border, code-block border, sub-agent indent rule         |
| `--mast-accent`                   | Send button, primary approval action                           |
| `--mast-accent-fg`                | Foreground on `--mast-accent`                                  |
| `--mast-thinking-bg`              | `<ThinkingBlock>` background, inline approval card background  |
| `--mast-thinking-fg`              | `<ThinkingBlock>` text, inline approval card text              |
| `--mast-tool-bg`                  | `<ToolCallBlock>` background (success / running)               |
| `--mast-tool-fg`                  | `<ToolCallBlock>` text (success / running)                     |
| `--mast-tool-pending`             | Streaming spinner color, cancel button, approval card border   |
| `--mast-tool-error-bg`            | `<ToolCallBlock>` background when `status: 'error'`            |
| `--mast-tool-error-fg`            | `<ToolCallBlock>` text when `status: 'error'`                  |
| `--mast-tool-cancelled-bg`        | `<ToolCallBlock>` background when `status: 'cancelled'`        |
| `--mast-tool-cancelled-fg`        | `<ToolCallBlock>` text when `status: 'cancelled'`              |
| `--mast-user-bubble`              | User message bubble background                                 |
| `--mast-user-fg`                  | User message bubble text                                       |
| `--mast-mention-chip-bg`          | `@`-mention chip background (input and user bubble)            |
| `--mast-mention-chip-fg`          | `@`-mention chip text                                          |
| `--mast-mention-picker-bg`        | Mention picker popover background (defaults to `--mast-bg`)    |
| `--mast-mention-picker-active-bg` | Highlighted picker row (defaults to `--mast-bg-subtle`)        |
| `--mast-mention-picker-shadow`    | Mention picker drop shadow                                     |
| `--mast-font`                     | All UI text                                                    |
| `--mast-font-mono`                | Code blocks, tool names, `<pre>` content                       |
| `--mast-text-sm`                  | Secondary text size (sub-text, status labels, picker rows)     |
| `--mast-text-base`                | Body text size                                                 |
| `--mast-gap`                      | Vertical / horizontal gap inside the panel                     |
| `--mast-radius`                   | Border radius for buttons, blocks, and the panel itself        |

Tokens whose default is `var(--mast-bg)` or `var(--mast-bg-subtle)` inherit
from the base color tokens automatically, so overriding `--mast-bg` once is
usually enough.

### 5.3 Overriding individual tokens

Set whichever tokens you want to change on any selector that contains a
`[data-mast-root]` element. The default stylesheet uses single-attribute
selectors, so an unscoped override wins by source order if its CSS is loaded
after `@mast-ai/react-ui/styles.css`.

```css
/* App-wide brand accent. */
[data-mast-root] {
  --mast-accent: #ec4899;
  --mast-accent-fg: #ffffff;
  --mast-radius: 0.25rem;
}

/* Different palette inside a sidebar variant. */
.app-sidebar [data-mast-root] {
  --mast-bg: #0f172a;
  --mast-fg: #e2e8f0;
}
```

### 5.4 Mapping onto an existing design system (Tailwind / shadcn)

Apps with their own design tokens typically want library components to inherit
the app theme rather than ship a parallel palette. The pattern is to remap
every `--mast-*` token onto the consumer's variables in a single block. Two
non-obvious things tripped up the first integration we did:

**Specificity tie-break.** A bare `[data-mast-root]` selector loses to the
library's own `[data-mast-root][data-mast-theme='dark']` block in dark mode,
so the dark theme keeps the library's hardcoded colors. Listing all three
selectors in one rule forces equal specificity and lets source order (the
consumer's CSS loaded after the library's) tie-break in favor of the override.

**App-driven dark mode.** Tailwind and shadcn use a `.dark` class on `<html>`
to swap variables. The library's `data-mast-theme` attribute is independent
and follows OS preference by default. Pass `data-mast-theme={theme}` from your
theme state to keep the library in sync with the app theme, otherwise OS dark
mode and an app forced to light (or vice versa) will mix.

**`hsl(var(--*))` vs raw color literals.** shadcn projects scaffolded with
`shadcn-ui add` store colors as raw HSL triples (`--background: 0 0% 100%`),
so the consumer expression must wrap them in `hsl(...)`. Tailwind v4 / shadcn
v4 setups instead store full color values (`--background: oklch(...)` or
`hsl(0 0% 100%)`), in which case you drop the `hsl()` wrapper and reference
the variable directly. Mixing the two forms produces invalid `color` values
that browsers silently fall back from.

Drop the following block into your global stylesheet, after the
`@mast-ai/react-ui/styles.css` import:

```css
[data-mast-root],
[data-mast-root][data-mast-theme='dark'],
[data-mast-root][data-mast-theme='light'] {
  --mast-bg: hsl(var(--background));
  --mast-bg-subtle: hsl(var(--muted) / 0.2);
  --mast-fg: hsl(var(--foreground));
  --mast-fg-muted: hsl(var(--muted-foreground));
  --mast-border: hsl(var(--border));
  --mast-accent: hsl(var(--primary));
  --mast-accent-fg: hsl(var(--primary-foreground));
  --mast-thinking-bg: hsl(var(--muted));
  --mast-thinking-fg: hsl(var(--muted-foreground));
  --mast-tool-bg: hsl(var(--muted) / 0.4);
  --mast-tool-fg: hsl(var(--muted-foreground));
  --mast-tool-pending: hsl(var(--primary));
  --mast-tool-error-bg: hsl(var(--destructive) / 0.1);
  --mast-tool-error-fg: hsl(var(--destructive));
  --mast-tool-cancelled-bg: hsl(var(--muted));
  --mast-tool-cancelled-fg: hsl(var(--muted-foreground));
  --mast-user-bubble: hsl(var(--primary));
  --mast-user-fg: hsl(var(--primary-foreground));
  --mast-mention-chip-bg: hsl(var(--primary) / 0.1);
  --mast-mention-chip-fg: hsl(var(--primary));
}
```

Then sync the library theme to your app theme on the panel root:

```tsx
import { ConversationPanel } from '@mast-ai/react-ui';
import { useTheme } from 'next-themes'; // or your own theme provider

function Chat() {
  const { resolvedTheme } = useTheme(); // 'light' | 'dark'
  return <ConversationPanel theme={resolvedTheme === 'dark' ? 'dark' : 'light'} />;
}
```

If you compose primitives directly instead of using `<ConversationPanel>`,
forward `data-mast-theme` onto the element that carries `data-mast-root`:

```tsx
<aside data-mast-root data-mast-theme={resolvedTheme}>
  <MessageList />
  <ChatInput />
</aside>
```

### 5.5 Importing the bundled Tailwind / shadcn preset

The preset above also ships as an importable stylesheet. Add it after the
default styles import to skip writing the mapping yourself:

```ts
import '@mast-ai/react-ui/styles.css';
import '@mast-ai/react-ui/themes/tailwind-shadcn.css';
```

The preset assumes the standard shadcn variables (`--background`,
`--foreground`, `--primary`, `--primary-foreground`, `--muted`,
`--muted-foreground`, `--border`, `--destructive`) are defined as raw HSL
triples on `:root` and `.dark`, which is the default shadcn layout. Tailwind
v4 / shadcn v4 projects that store full color values should copy the snippet
in §5.4 and drop the `hsl()` wrapper instead.

You still need to forward the app theme via `data-mast-theme` (§5.4) so the
library's dark detection stays in sync with the `.dark` class.

### 5.6 Plain CSS without a design system

For apps that do not use Tailwind or shadcn, override the tokens directly in
your global stylesheet. The library's automatic dark mode applies whenever
`data-mast-theme` is unset, so you only need a second block for explicit
themes:

```css
[data-mast-root] {
  --mast-bg: #fafafa;
  --mast-fg: #1c1917;
  --mast-accent: #f97316;
  --mast-accent-fg: #ffffff;
  --mast-radius: 0.375rem;
  --mast-font: 'Inter', system-ui, sans-serif;
}

[data-mast-root][data-mast-theme='dark'] {
  --mast-bg: #1c1917;
  --mast-fg: #fafafa;
  --mast-accent: #fb923c;
}
```

Set tokens to `inherit` (or a `var()` reference) to pull values from a parent
element. Combined with `<ConversationPanel theme={theme}>`, this gives full
control over the panel's appearance without touching the library bundle.

---

## 6. Custom tool call rendering (`renderToolCall`)

The default `<ToolCallBlock>` covers most cases: it shows the tool name, a
spinner during execution, the args and result on demand, and any sub-agent
narration. The block itself collapses behind its header — by default it stays
open while the tool is running and collapses on completion. Pass
`defaultOpen={true}` (always open) or `defaultOpen={false}` (always collapsed)
to override. To take full control (e.g. to render a chart for a tool that returns
plot data), supply a `renderToolCall` callback:

```tsx
import { ConversationPanel, ToolCallBlock } from '@mast-ai/react-ui';
import type { ToolEventEntry } from '@mast-ai/react-ui';

function MyChart({ entry }: { entry: ToolEventEntry }) {
  const result = entry.result as { points: { x: number; y: number }[] } | undefined;
  return result ? <ScatterPlot points={result.points} /> : <span>Plotting…</span>;
}

const renderToolCall = (entry: ToolEventEntry) => {
  if (entry.name === 'plot_scatter') return <MyChart entry={entry} />;
  return <ToolCallBlock entry={entry} />;
};

<ConversationPanel renderToolCall={renderToolCall} />;
```

The callback runs once per `ToolEventEntry` (one per tool invocation), so
dispatch on `entry.name` and fall back to the bundled `<ToolCallBlock>` for
tools that do not need special handling.

When a call is awaiting an inline approval decision the second argument is a
`PendingApproval` handle; see §10.3 for the full pattern.

If the only thing you need to override is the header text — say, a
`delegate_to_skill` call where the interesting label is in the args — pass the
`label` prop on `<ToolCallBlock>` instead of cloning the entry:

```tsx
const renderToolCall = (entry: ToolEventEntry) => {
  if (entry.name === 'delegate_to_skill') {
    const skillName = (entry.args as { skillName?: string } | undefined)?.skillName;
    return <ToolCallBlock entry={entry} label={skillName ?? entry.name} />;
  }
  return <ToolCallBlock entry={entry} />;
};
```

For lists where the only customisation is relabelling, the `getToolLabel` slot
on `<ConversationPanel>` / `<MessageList>` / `<AssistantMessage>` is more
direct — see §13.

---

## 7. Custom message rendering (`renderMessage`)

Assistant text is rendered with `react-markdown` if it is installed (and
sanitised with `rehype-sanitize`). Override the entire renderer with
`renderMessage`:

```tsx
import { ConversationPanel } from '@mast-ai/react-ui';

const renderMessage = (text: string) => <pre className="my-app-monospace">{text}</pre>;

<ConversationPanel renderMessage={renderMessage} />;
```

The callback receives the raw text string. Use it to plug in a different
markdown library, render LaTeX, embed code blocks with your existing syntax
highlighter, or escape every character because your domain is plain text.

---

## 8. Composing a custom layout with primitives

`<ConversationPanel>` is a thin wrapper around `<MessageList>` and
`<ChatInput>`. For a sidebar, a docked panel, or any non-default layout, drop
those primitives directly into your own JSX:

```tsx
import { AgentProvider, MessageList, ChatInput } from '@mast-ai/react-ui';

function AgentSidebar() {
  return (
    <aside className="my-sidebar" data-mast-root>
      <header className="my-sidebar-header">
        <h2>Assistant</h2>
        <button onClick={closeSidebar}>×</button>
      </header>
      <MessageList />
      <ChatInput placeholder="Ask the assistant…" />
    </aside>
  );
}

<AgentProvider runner={runner} agent={agent}>
  <AgentSidebar />
</AgentProvider>;
```

Add `data-mast-root` to whichever element should anchor the CSS custom
properties. `<ConversationPanel>` does this for you; bespoke wrappers must do
it themselves.

Other primitives exported for compositional use: `<MessageItem>`,
`<UserMessage>`, `<AssistantMessage>`, `<ThinkingBlock>`, `<ToolCallBlock>`,
and `<InlineApproval>`. See [`SPEC.md` §4](./SPEC.md#4-components) for their
prop signatures.

---

## 9. Fully headless usage via `useAgent()`

If your app already has a design system and you do not want any library styles,
read the streaming state directly via `useAgent()` and render it however you
like. The hook is the same one the library's components use internally, so all
information available to `<ConversationPanel>` is available to you.

```tsx
import { AgentProvider, useAgent } from '@mast-ai/react-ui';

function MyAgentPanel() {
  const { messages, sendMessage, cancel, isRunning, reset } = useAgent();
  return (
    <div>
      {messages.map((entry) => (
        <div key={entry.id} data-role={entry.role}>
          <p>{entry.text}</p>
          {entry.toolEvents.map((tool) => (
            <span key={tool.id}>
              {tool.name} — {tool.isStreaming ? 'running' : tool.status}
            </span>
          ))}
        </div>
      ))}
      <button disabled={isRunning} onClick={() => sendMessage('Hello!')}>
        Send
      </button>
      {isRunning && <button onClick={cancel}>Cancel</button>}
      <button onClick={reset}>New conversation</button>
    </div>
  );
}

<AgentProvider runner={runner} agent={agent}>
  <MyAgentPanel />
</AgentProvider>;
```

`useAgent()` throws if called outside an `<AgentProvider>` so misuse is caught
at the call site.

### Display vs LLM prompt split

`sendMessage` accepts an optional second argument that overrides the user
bubble text. The first argument is what the LLM receives:

```tsx
function CommandInput() {
  const { sendMessage, isRunning } = useAgent();
  return (
    <button
      disabled={isRunning}
      onClick={() => sendMessage('Summarise the active document.', '/summarize')}
    >
      Summarize
    </button>
  );
}
```

The user sees `/summarize` in the chat history; the LLM sees the full prompt.
Use this for slash commands, PII redaction, or any other case where the
rendered text differs from what the model should see.

### Conversation persistence

Save the conversation after each turn with `onConversationChange` and seed a
new mount with `initialHistory` / `initialEntries`:

```tsx
import { AgentProvider } from '@mast-ai/react-ui';
import type { ConversationEntry } from '@mast-ai/react-ui';
import type { Message } from '@mast-ai/core';

const STORAGE_KEY = 'my-app:agent-state';

interface SavedState {
  history: Message[];
  entries: ConversationEntry[];
}

function loadSaved(): SavedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedState) : { history: [], entries: [] };
  } catch {
    return { history: [], entries: [] };
  }
}

const saved = loadSaved();

<AgentProvider
  runner={runner}
  agent={agent}
  initialHistory={saved.history}
  initialEntries={saved.entries}
  onConversationChange={(history, entries) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ history, entries }));
  }}
>
  <ConversationPanel />
</AgentProvider>;
```

`onConversationChange` fires after each completed turn (i.e. after a `done`
event), not during streaming and not when a run is cancelled or errors before
completion. `initialHistory` and `initialEntries` are read once on mount; later
changes have no effect until `reset()` is called or the provider is remounted.
Apps that swap between conversations should remount `<AgentProvider>` with a
React `key` keyed on the active conversation id.

---

## 10. Approval flow

Tools that read from sensitive sources or write to shared state should
typically pause for human confirmation. The flow has three pieces:

1. The tool author marks the definition with `requiresApproval: true`.
2. The app supplies an `onApprovalRequired` callback on `<AgentProvider>`.
3. Optional: `approvalOverride` adjusts the policy at runtime.

### 10.1 Declaring approval intent on the tool

```ts
import type { Tool, ToolContext } from '@mast-ai/core';

interface SetPageTitleArgs {
  title: string;
}

class SetPageTitleTool implements Tool<SetPageTitleArgs, string> {
  definition() {
    return {
      name: 'set_page_title',
      description: 'Sets the title of the current browser page.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The new page title.' },
        },
        required: ['title'],
      },
      scope: 'write' as const,
      requiresApproval: true,
    };
  }

  async call(args: SetPageTitleArgs, _context: ToolContext): Promise<string> {
    document.title = args.title;
    return `Page title set to: ${args.title}`;
  }
}
```

`requiresApproval` is the canonical signal: it lives next to the name and
description, where it is discoverable, portable across all MAST runners, and
declared once instead of per-app.

### 10.2 Resolving approvals out-of-band

The simplest pattern returns `true` or `false` from `onApprovalRequired` based
on a modal:

```tsx
import { AgentProvider, type OnApprovalRequired } from '@mast-ai/react-ui';

const onApprovalRequired: OnApprovalRequired = async (toolCall) => {
  return window.confirm(`Allow tool "${toolCall.name}" to run?`);
};

<AgentProvider runner={runner} agent={agent} onApprovalRequired={onApprovalRequired}>
  <ConversationPanel />
</AgentProvider>;
```

The callback can also return:

- a `string` to skip execution and inject that string as the tool result, or
- `INLINE_APPROVAL` to defer to the inline approval queue (next section).

While the callback is pending, the matching `ToolEventEntry.awaitingApproval`
is `true` so renderers can show a paused indicator.

### 10.3 Inline approvals

For approvals that should appear inline in the chat (rather than as a modal),
return the `INLINE_APPROVAL` sentinel and either compose the bundled
`<InlineApproval>` component inside `renderToolCall` or let the library use it
as the default:

```tsx
import {
  AgentProvider,
  ConversationPanel,
  INLINE_APPROVAL,
  InlineApproval,
  ToolCallBlock,
  type OnApprovalRequired,
  type PendingApproval,
  type ToolEventEntry,
} from '@mast-ai/react-ui';

const onApprovalRequired: OnApprovalRequired = async (toolCall) => {
  if (toolCall.name === 'set_page_title' || toolCall.name === 'get_page_title') {
    return INLINE_APPROVAL;
  }
  return window.confirm(`Allow tool "${toolCall.name}" to run?`);
};

function SetPageTitleApproval({
  entry,
  approval,
}: {
  entry: ToolEventEntry;
  approval: PendingApproval;
}) {
  const args = entry.args as { title?: string } | undefined;
  return (
    <div className="my-approval-card">
      <div>
        Change page title to <code>{args?.title ?? '(missing)'}</code>?
      </div>
      <button type="button" onClick={approval.approve}>
        Apply
      </button>
      <button type="button" onClick={approval.reject}>
        Discard
      </button>
    </div>
  );
}

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

<AgentProvider runner={runner} agent={agent} onApprovalRequired={onApprovalRequired}>
  <ConversationPanel renderToolCall={renderToolCall} />
</AgentProvider>;
```

Each `PendingApproval` exposes:

- `approve()` — runs the tool normally.
- `reject()` — runner receives a synthetic "user cancelled" result.
- `respondWith(result)` — skips execution and injects `result` as the tool
  result.

The library handles all promise-resolver plumbing; consumers never call
`new Promise` themselves. The active set is also available via
`useAgent().pendingApprovals` so app chrome (e.g. a header badge) can show how
many tools are paused.

#### Customising only the approval card with `renderApproval`

The default `<InlineApproval>` shows the tool name and the raw args JSON. For a
tool whose args are opaque internal fields (ids, flags), that is a poor prompt:
`rename_document({ id: '44c2…', title: 'New' })` reads as a UUID and a string
when what the user wants to see is `Rename "Old" to "New"?`.

The `renderToolCall` callback can intercept this case, but doing so means
rebuilding the layout, buttons, and styling of every other tool call too. The
narrower `renderApproval` slot replaces only the approval card and lets the
default `<ToolCallBlock>` keep rendering everything else:

```tsx
import { ConversationPanel, InlineApproval, type RenderApproval } from '@mast-ai/react-ui';

const renderApproval: RenderApproval = (entry, approval) => {
  switch (entry.name) {
    case 'rename_document': {
      const args = entry.args as { id: string; title: string };
      return (
        <ApprovalCard
          summary={`Rename document to "${args.title}"?`}
          onApprove={approval.approve}
          onReject={approval.reject}
        />
      );
    }
    case 'delete_document': {
      const args = entry.args as { id: string; title: string };
      return (
        <ApprovalCard
          summary={`Delete "${args.title}"?`}
          danger
          onApprove={approval.approve}
          onReject={approval.reject}
        />
      );
    }
    default:
      // Fall back to the bundled card for tools without bespoke copy.
      return (
        <InlineApproval
          entry={entry}
          approve={approval.approve}
          reject={approval.reject}
          respondWith={approval.respondWith}
        />
      );
  }
};

function ApprovalCard({
  summary,
  danger,
  onApprove,
  onReject,
}: {
  summary: string;
  danger?: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className={danger ? 'my-approval danger' : 'my-approval'}>
      <p>{summary}</p>
      <button type="button" onClick={onApprove}>
        Approve
      </button>
      <button type="button" onClick={onReject}>
        Reject
      </button>
    </div>
  );
}

<ConversationPanel renderApproval={renderApproval} />;
```

When both `renderApproval` and `renderToolCall` are provided, `renderApproval`
wins for entries with a pending approval handle and `renderToolCall` continues
to handle every other tool event. Compose `<InlineApproval>` (or `<ToolCallBlock>`)
inside either slot as the fallback for tools you have not customised.

### 10.4 Runtime overrides

`approvalOverride` adjusts the policy without touching tool definitions:

```tsx
// Sandbox: skip approval for normally-sensitive tools.
<AgentProvider {...props} approvalOverride={['!set_page_title']} />

// High-trust workflow: add approval to a third-party tool.
<AgentProvider {...props} approvalOverride={['third_party_tool']} />
```

Bare names add approval; names prefixed with `!` suppress it. The effective
rule is described in [`SPEC.md` §9.4](./SPEC.md#94-runtime-override-approvaloverride).

---

## 11. Nested sub-agent tool calls

Tools that internally run another agent (built with `createAgentTool` from
`@mast-ai/core`) emit `tool_call_started` / `tool_call_completed` events for
the nested calls they fire. `useAgentStream` routes those events into
`ToolEventEntry.nestedToolEvents`, and `<ToolCallBlock>` renders them
recursively under the parent block.

This is automatic — no extra wiring is needed in the consumer. The only
requirement is that the sub-agent tool be built with `createAgentTool` so the
events it emits are well-formed. For example, the demo's
`summarize_documents` sub-agent calls `read_doc` for each referenced
document, and each of those calls appears as a nested entry under the parent
`summarize_documents` block:

```tsx
import { createAgent, createAgentTool } from '@mast-ai/core';
import type { AgentRunner, Tool } from '@mast-ai/core';

export function createSummarizeDocumentsTool(runner: AgentRunner): Tool {
  const summarizerAgent = createAgent({
    name: 'DocumentSummarizer',
    instructions:
      'You summarise documents the user has referenced. ' +
      'For each id you receive, call read_doc to fetch its contents, ' +
      'then produce a single concise paragraph summarising all of them together.',
    tools: ['read_doc'],
  });

  return createAgentTool(runner, summarizerAgent, {
    name: 'summarize_documents',
    description: 'Summarises one or more referenced documents by id.',
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'The document ids to summarise.',
        },
      },
      required: ['ids'],
    },
    scope: 'read',
    buildInput: (args) => {
      const { ids } = args as { ids: string[] };
      return `Summarise these document ids together: ${ids.join(', ')}.`;
    },
  });
}
```

Nesting is currently scoped to a single level (a sub-agent calling its own
tools). Grandchild events route back to the outermost matching parent; deeper
disambiguation is a future extension tracked in the SPEC.

### 11.1 Custom sub-agent tools: use `forwardTo(context)`

`createAgentTool` is the canonical wrapper, but some tools need custom logic
around the sub-agent run (multi-step orchestration, conditional invocation,
post-processing). Those tools should chain `forwardTo(context)` on the
sub-agent's `RunBuilder` instead of hand-rolling the forwarding loop:

```ts
import type { Tool, ToolContext, AgentRunner, AgentConfig } from '@mast-ai/core';

export function createInvokeWriterTool(runner: AgentRunner, agent: AgentConfig): Tool {
  return {
    definition: () => ({
      name: 'invoke_writer',
      description: 'Delegates a writing task to the writer agent.',
      parameters: { type: 'object', properties: { task: { type: 'string' } } },
      scope: 'write',
    }),
    async call(args, context: ToolContext): Promise<string> {
      const { task } = args as { task: string };
      const builder = runner.runBuilder(agent).forwardTo(context);
      if (context.signal) builder.signal(context.signal);

      for await (const event of builder.runStream(task)) {
        if (event.type === 'done') return event.output;
      }
      throw new Error("Writer sub-agent ended without a 'done' event");
    },
  };
}
```

`forwardTo(context)`:

- Forwards every non-`done` child event to `context.onEvent`, populating
  `subThinking` / `subText` / `nestedToolEvents` on the parent's tool entry.
- Filters `done` events automatically (they carry the child's full history,
  which must not leak to the parent runner's consumer).
- Is a no-op when `context.onEvent` is undefined.
- Composes with `history()`, `signal()`, and `onToolEvent()` in any order.

Forgetting to call `forwardTo(context)` is a silent failure: the tool runs
fine but the parent's tool block shows no streamed sub-output. Always
chain it on any sub-agent `RunBuilder` invoked from a tool's `call`.

---

## 12. Mention pipeline (`@`-mentions)

The mention pipeline lets users reference workspace items inline by typing
`@`. It is fully opt-in: when omitted, `<ChatInput>` renders an unchanged
plain textarea. The library handles the picker, chip rendering, keyboard
navigation, and the submit-time prompt-vs-display split; the consuming app
supplies the items and decides what context the LLM sees.

### 12.1 Wiring it on `<ChatInput>` / `<ConversationPanel>`

```tsx
import { ConversationPanel } from '@mast-ai/react-ui';
import type { MentionsConfig } from '@mast-ai/react-ui';

interface DocRef {
  path: string;
  body: string;
}

const docs: { id: string; label: string; description?: string; data: DocRef }[] = [
  {
    id: 'doc-1',
    label: 'Roadmap',
    description: 'Q2 plan',
    data: { path: 'docs/roadmap.md', body: '…' },
  },
  { id: 'doc-2', label: 'Style Guide', data: { path: 'docs/style.md', body: '…' } },
];

const mentionsConfig: MentionsConfig<DocRef> = {
  items: docs,
  buildPrompt: (segments, trailing) => {
    const inline = segments.map((s) => `${s.text}@${s.item.label}`).join('') + trailing;
    if (segments.length === 0) return inline;
    const refs = segments.map((s) => `- "${s.item.label}" (id: ${s.item.id})`).join('\n');
    return `The user has referenced the following documents:\n${refs}\n\n${inline}`;
  },
};

<ConversationPanel
  mentions={mentionsConfig as MentionsConfig}
  inputPlaceholder="Type @ to reference a doc, then press Enter."
/>;
```

The user bubble shows the inline `@<label>` form; the LLM receives the prompt
returned by `buildPrompt`. When `mentions` is omitted, the existing
single-argument `sendMessage(text)` path is preserved.

The MentionsConfig accepts:

| Field         | Purpose                                                                            |
| ------------- | ---------------------------------------------------------------------------------- |
| `items`       | Static list. Filtered by case-insensitive substring on `label`.                    |
| `onSearch`    | Async / sync search function. Latest result wins; stale resolutions are discarded. |
| `trigger`     | Trigger character. Default: `'@'`.                                                 |
| `renderItem`  | Custom row in the picker.                                                          |
| `renderChip`  | Custom chip element. Default: `@<label>` with an `×` remove button.                |
| `buildPrompt` | Builds the LLM-facing prompt from the segment list and trailing text.              |

Use either `items` or `onSearch`; if both are passed, `onSearch` wins.

### 12.2 `useMentions` for bespoke inputs

If `<ChatInput>` is too restrictive (e.g. you want a different layout, a
non-textarea input, or virtualisation in the picker), drive your own input
with the `useMentions` hook:

```tsx
import { useAgent, useMentions } from '@mast-ai/react-ui';
import type { MentionsConfig } from '@mast-ai/react-ui';

interface DocRef {
  path: string;
}

function MyMentionInput({ config }: { config: MentionsConfig<DocRef> }) {
  const { sendMessage, isRunning } = useAgent();
  const {
    segments,
    trailingInput,
    mentionQuery,
    filteredItems,
    pickerIndex,
    setTrailingInput,
    handleKeyDown,
    selectItem,
    removeChip,
    buildSubmission,
    clear,
  } = useMentions(config);

  const submit = () => {
    const { prompt, displayText } = buildSubmission();
    if (!displayText.trim()) return;
    sendMessage(prompt, displayText);
    clear();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="my-chips">
        {segments.map((segment) => (
          <span key={segment.item.id} className="my-chip">
            {segment.text}
            <span className="my-chip-label">
              @{segment.item.label}
              <button type="button" onClick={() => removeChip(segment.item.id)}>
                ×
              </button>
            </span>
          </span>
        ))}
      </div>
      <textarea
        value={trailingInput}
        disabled={isRunning}
        onChange={(e) => setTrailingInput(e.target.value)}
        onKeyDown={(e) => {
          if (handleKeyDown(e)) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {mentionQuery !== null && filteredItems.length > 0 && (
        <ul className="my-picker">
          {filteredItems.map((item, index) => (
            <li
              key={item.id}
              aria-selected={index === pickerIndex}
              onClick={() => selectItem(item)}
            >
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
```

`handleKeyDown` returns `true` when it consumes a key (Up / Down / Enter /
Escape while the picker is open); the host textarea should suppress its own
handling in that case so Enter does not double as both "select item" and
"submit".

### 12.3 `sendMessage(text, displayText)` for the prompt/display split

Whether you use `<ChatInput mentions>` or `useMentions`, mention submission
calls `sendMessage(prompt, displayText)` from `useAgent()`:

- `displayText` is what the user bubble renders (the inline `@<label>` form).
- `prompt` is what the LLM receives (`buildPrompt`'s output, falling back to
  the inline form).

The two-argument overload is also useful outside the mention pipeline; see
the slash-command example in §9.

---

## 13. Overriding tool call labels (`getToolLabel`)

`<ToolCallBlock>` displays `entry.name` in its header by default. That works
well for atomic tools (`read_doc`, `set_page_title`, `get_current_time`) but
reads poorly for delegation-style tools whose interesting label lives in the
args. A `delegate_to_skill` call for the "Proofreader" skill displays as
`delegate_to_skill` rather than `Proofreader`.

The `getToolLabel` slot on `<ConversationPanel>`, `<MessageList>`, and
`<AssistantMessage>` resolves a header label per entry without forking the
rest of the tool-call rendering:

```tsx
import { ConversationPanel, type GetToolLabel } from '@mast-ai/react-ui';

const getToolLabel: GetToolLabel = (entry) => {
  if (entry.name === 'delegate_to_skill') {
    const args = entry.args as { skillName?: string } | undefined;
    return args?.skillName;
  }
  // Returning undefined falls back to entry.name, so atomic tools render
  // exactly as before.
  return undefined;
};

<ConversationPanel getToolLabel={getToolLabel} />;
```

The resolver flows through context, so it also applies to nested sub-agent
tool calls rendered recursively inside the parent block (see §11). Returning
`undefined` or `null` for an entry falls back to `entry.name`, which makes it
ergonomic to relabel one tool name while leaving everything else untouched.

If you already have a `renderToolCall` callback (for example to render a chart
for a specific tool), pass `label` directly on the bundled `<ToolCallBlock>`
inside that callback. The `label` prop wins over `getToolLabel`, so the two
work together cleanly:

```tsx
const renderToolCall = (entry: ToolEventEntry) => {
  if (entry.name === 'plot_scatter') return <MyChart entry={entry} />;
  return <ToolCallBlock entry={entry} />;
};
```

The resolver from `getToolLabel` is still consulted for the bundled block, so
the `delegate_to_skill` example above keeps working alongside the chart
override.

---

## See also

- [`PRD.md`](./PRD.md) — problem statement, user stories, success criteria.
- [`SPEC.md`](./SPEC.md) — full type signatures, prop reference, streaming
  state machine, accessibility notes, and testing strategy.
- `apps/demo-react-ui` — runnable reference app exercising every feature in
  this guide.
