# Product Requirements Document: @mast-ai/react-ui

## 1. Problem Statement

Every MAST-powered React application independently rebuilds the same agent chat UI:
a streaming message list, collapsible thinking blocks, tool call displays, and a text
input wired to `AgentRunner`. This has happened in at least two existing apps
([agent-text-editor](https://github.com/andreban/agent-text-editor) and
[bandarrame_rs/admin-ui](https://github.com/andreban/bandarrame_rs)). Each
reimplementation duplicates rendering logic, streaming state management, and accessibility
concerns while diverging on styling details.

The gap between "I have an AgentRunner" and "I have a working chat UI" is currently filled
by hundreds of lines of app-specific boilerplate that cannot be shared.

## 2. Goals

- **Eliminate the UI boilerplate** for any developer who has an `AgentRunner` from `@mast-ai/core`.
- **Cover non-chat use cases** — the agent panel should be embeddable as a sidebar, modal,
  or inline pane in text editors, image editors, CAD tools, and any other application type.
  It must not assume it is the primary UI.
- **Maximise React app compatibility** — work in any React app regardless of its existing
  styling setup (Tailwind, MUI, Ant Design, CSS Modules, plain CSS, etc.).
- **Minimise mandatory dependencies** — do not impose Radix UI, shadcn, or any headless
  component library on consumers. Do not require Tailwind to be installed or configured.
- **Export all building blocks** — every sub-component must be independently importable so
  developers can compose bespoke UIs without forking the library.

## 3. Non-Goals

- **Editor integrations** — Monaco decorations, diff overlays, and canvas annotations are
  domain-specific. They stay in the consuming application.
- **Domain-specific approval flows** — suggestion diffs, plan confirmations, and field-update
  prompts are too app-specific. The library provides a callback hook; the app renders the
  approval UI.
- **Server-side rendering** — the library targets browser-rendered React applications. SSR
  compatibility is a nice-to-have but not a requirement.
- **Non-React frameworks** — Vue, Svelte, and Web Components are out of scope.

## 4. User Stories

### 4.1 Zero-config chat panel
> As a developer who has an `AgentRunner` and a tool registry, I want to render a full
> chat panel by adding a single component, without configuring any styling system.

```tsx
<AgentProvider runner={runner} agent={agentConfig}>
  <ConversationPanel />
</AgentProvider>
```

### 4.2 Custom layout with library primitives
> As a developer building a text editor, I want a floating chat sidebar that shares
> the same message rendering logic as the default panel, but with my own layout and
> header chrome.

```tsx
<AgentProvider runner={runner} agent={agentConfig}>
  <MySidebar>
    <MessageList />
    <ChatInput />
  </MySidebar>
</AgentProvider>
```

### 4.3 Fully headless custom UI
> As a developer whose app already uses a design system, I want access to the streaming
> state and message data via a hook so I can render everything myself without any library
> styles conflicting with mine.

```tsx
function MyAgentPanel() {
  const { messages, sendMessage, isRunning, cancel } = useAgent();
  return <MyDesignSystemChatPanel ... />;
}
```

### 4.4 Custom tool call rendering
> As a developer whose tools have rich results (images, charts, code diffs), I want to
> replace the default tool call block with my own renderer while keeping everything else
> from the library.

```tsx
<ConversationPanel
  renderToolCall={(toolCall) => <MyRichToolCallRenderer toolCall={toolCall} />}
/>
```

### 4.5 Conversation persistence
> As a developer building a multi-session app, I want to save the conversation after
> each turn and restore it on the next page load so users can continue where they left off.

```tsx
// Save
<AgentProvider
  runner={runner}
  agent={agentConfig}
  onConversationChange={(history, entries) => {
    localStorage.setItem('history', JSON.stringify(history));
    localStorage.setItem('entries', JSON.stringify(entries));
  }}
>

// Restore
<AgentProvider
  runner={runner}
  agent={agentConfig}
  initialHistory={JSON.parse(localStorage.getItem('history') ?? '[]')}
  initialEntries={JSON.parse(localStorage.getItem('entries') ?? '[]')}
>
```

### 4.6 Approval callback
> As a developer whose agent uses tools that require human confirmation, I want to
> hook into the approval flow so I can render my own confirmation UI before the tool
> executes.

```tsx
<AgentProvider
  runner={runner}
  agent={agentConfig}
  onApprovalRequired={(toolCall) => myConfirmationDialog(toolCall)}
>
  <ConversationPanel />
</AgentProvider>
```

## 5. Success Criteria

1. A developer can render a working agent chat UI with three lines of JSX and no style
   configuration.
2. The library ships with zero peer dependencies beyond `react`, `react-dom`,
   `@mast-ai/core`, and `@tanstack/react-virtual`. Markdown rendering and icon sets are
   optional.
3. The default stylesheet imports with a single CSS import and requires no build-tool
   configuration (no Tailwind, no PostCSS plugins).
4. Every component accepts a `className` prop and the default styles are expressed as
   overridable CSS custom properties, so consuming apps can restyle without `!important`.
5. The full component surface (`MessageList`, `MessageItem`, `ThinkingBlock`,
   `ToolCallBlock`, `ChatInput`) is importable individually for compositional use.
6. All interactive elements (send button, collapsible blocks) meet WCAG 2.1 AA
   keyboard-navigation and ARIA requirements.
7. The streaming state machine (`useAgentStream`), approval flow, conversation
   persistence, and all interactive components have unit tests that pass in CI.
8. A working demo app (`apps/demo-react-ui`) ships alongside the library demonstrating
   the default setup with `@mast-ai/google-genai`, custom icons via `lucide-react`, and
   at least two registered tools.
9. Developer documentation (`docs/react-ui/USAGE.md`) and the `skills/mast-ai` skill
   are updated to cover the new package before the feature is considered complete.

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| CSS conflicts with consuming app | Namespace all default classes with `mast-` prefix; use CSS custom properties scoped to `[data-mast]` so they don't bleed |
| `react-markdown` adds weight | Make it optional; `renderMessage` prop lets apps supply their own renderer |
| Streaming state logic diverges from core | Keep all streaming wiring in one `useAgentStream` internal hook derived directly from `AgentEvent` types |
| API surface locks in early design | Keep `ConversationPanel` as a thin compositor over exported primitives; breaking the top-level API is tolerable if primitives remain stable |
