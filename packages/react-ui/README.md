# @mast-ai/react-ui

React 19 components and hooks for [MAST](https://github.com/andreban/mast-ai). Turns an `AgentRunner` into a streaming chat UI: a default theme, a complete `<ConversationPanel>` widget, and headless primitives (`useAgent`, `useAgentStream`) for fully custom layouts.

## Install

```bash
npm install @mast-ai/core @mast-ai/react-ui @tanstack/react-virtual react react-dom
```

`@tanstack/react-virtual` is a required peer dependency — `<MessageList>` virtualises long conversations. React must be 19.0 or newer.

Optional peer dependencies (auto-detected at runtime if installed):

| Package                                           | Adds                                 |
| ------------------------------------------------- | ------------------------------------ |
| `react-markdown`, `remark-gfm`, `rehype-sanitize` | Markdown rendering with sanitisation |

## Quick start

```tsx
import { AgentRunner, ToolRegistry, createAgent } from '@mast-ai/core';
import { GoogleGenAIAdapter } from '@mast-ai/google-genai';
import { GoogleGenAI } from '@google/genai';
import { AgentProvider, ConversationPanel } from '@mast-ai/react-ui';
import '@mast-ai/react-ui/styles.css';

const client = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
const adapter = new GoogleGenAIAdapter(client, { model: 'gemini-2.5-flash' });
const runner = new AgentRunner(adapter, new ToolRegistry());
const agent = createAgent({ name: 'Assistant', instructions: 'Be helpful.', tools: [] });

export function App() {
  return (
    <AgentProvider runner={runner} agent={agent}>
      <ConversationPanel />
    </AgentProvider>
  );
}
```

## What's exported

- **`<AgentProvider>` / `useAgent()`** — context that exposes the runner, conversation, and `sendMessage`.
- **`<ConversationPanel>`** — full chat UI: message list, input, approval prompts, tool call blocks.
- **Primitives** — `<MessageList>`, `<MessageItem>`, `<UserMessage>`, `<AssistantMessage>`, `<ChatInput>`, `<ToolCallBlock>`, `<ThinkingBlock>`, `<InlineApproval>` for custom layouts.
- **`useAgentStream()`** — fully headless variant; you own all rendering.
- **Mentions** — `useMentions()` and helpers for `@`-mention pickers in `<ChatInput>`.

## Documentation

- [Usage guide](https://github.com/andreban/mast-ai/blob/main/docs/react-ui/USAGE.md) — comprehensive walkthrough of every prop and pattern.
- [API spec](https://github.com/andreban/mast-ai/blob/main/docs/react-ui/SPEC.md) — type reference.

## License

Apache-2.0. Copyright 2026 Andre Cipriani Bandarra.
