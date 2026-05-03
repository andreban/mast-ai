# MAST React UI Reference (`@mast-ai/react-ui`)

`@mast-ai/react-ui` turns an `AgentRunner` from `@mast-ai/core` into a streaming chat UI. It ships a default theme, a complete `<ConversationPanel>` widget, and primitives for composing bespoke layouts. The full developer guide is in `docs/react-ui/USAGE.md`; this file is the API reference.

## Installation

```bash
npm install @mast-ai/core @mast-ai/react-ui @tanstack/react-virtual react react-dom
```

`@tanstack/react-virtual` is a required peer dependency (used by `<MessageList>`). React must be 19.0 or newer. Optional: `react-markdown` + `remark-gfm` + `rehype-sanitize` for Markdown rendering, `lucide-react` (or any icon set) for icon overrides.

Import the default stylesheet once at app entry:

```ts
import '@mast-ai/react-ui/styles.css';
```

CSS custom properties are scoped under `[data-mast-root]` and do not collide with global styles. Skip the import for fully headless usage.

## AgentProvider

Wraps a subtree with agent context. Must be rendered around any component that calls `useAgent()` or any of the bundled rendering primitives.

```typescript
import { AgentProvider } from '@mast-ai/react-ui';

interface AgentProviderProps {
  runner: AgentRunner;
  agent: AgentConfig;
  children: ReactNode;
  icons?: IconMap;
  onApprovalRequired?: OnApprovalRequired;
  approvalOverride?: string[]; // bare names add approval; '!name' suppresses it
  initialHistory?: Message[]; // read once on mount
  initialEntries?: ConversationEntry[]; // read once on mount
  onConversationChange?: (history: Message[], entries: ConversationEntry[]) => void;
}
```

Internally creates a `Conversation` via `runner.conversation(agent)`. To switch conversations at runtime, remount with a React `key` and seed via `initialHistory` / `initialEntries`. `onConversationChange` fires only after a successful `done` event (not on cancel or error).

## useAgent

Reads the current state from `<AgentProvider>`. Throws if called outside one.

```typescript
import { useAgent } from '@mast-ai/react-ui';

interface UseAgentReturn {
  messages: ConversationEntry[];
  history: Message[];
  sendMessage: (text: string, displayText?: string) => void;
  cancel: () => void;
  isRunning: boolean;
  reset: () => void;
  pendingApprovals: PendingApproval[];
}
```

`sendMessage(prompt, displayText?)`: when `displayText` is provided the user bubble renders `displayText` while the LLM receives `prompt`. Use this for slash commands, PII redaction, and the mention pipeline.

## ConversationPanel

Drop-in chat UI. Wraps `<MessageList>` and `<ChatInput>` inside a `[data-mast-root]` element.

```typescript
import { ConversationPanel } from '@mast-ai/react-ui';

interface ConversationPanelProps {
  theme?: 'light' | 'dark'; // omit to follow prefers-color-scheme
  className?: string;
  renderToolCall?: (entry: ToolEventEntry, approval?: PendingApproval) => ReactNode;
  renderMessage?: (text: string) => ReactNode;
  inputPlaceholder?: string;
  mentions?: MentionsConfig;
}
```

## Primitives

For non-default layouts (sidebar, docked panel, etc.), drop the primitives into your own JSX. Add `data-mast-root` to whatever element should anchor the CSS custom properties.

```typescript
import {
  MessageList,
  ChatInput,
  MessageItem,
  UserMessage,
  AssistantMessage,
  ThinkingBlock,
  ToolCallBlock,
  InlineApproval,
} from '@mast-ai/react-ui';
```

## ConversationEntry & ToolEventEntry

```typescript
interface ConversationEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
  toolEvents: ToolEventEntry[];
  isStreaming: boolean;
}

interface ToolEventEntry {
  id: string;
  type: 'tool_call_started' | 'tool_call_completed';
  name: string;
  args?: unknown;
  result?: unknown;
  subThinking?: string; // accumulated sub-agent thinking
  subText?: string; // accumulated sub-agent text
  nestedToolEvents?: ToolEventEntry[]; // tool calls fired by a sub-agent
  isStreaming: boolean;
  awaitingApproval?: boolean;
  status?: 'success' | 'error' | 'cancelled';
}
```

## Approval Flow

Three pieces:

1. Tool author sets `requiresApproval: true` on the tool definition.
2. App supplies `onApprovalRequired` on `<AgentProvider>`.
3. Optional: `approvalOverride={['!safe_tool', 'third_party_tool']}` adjusts policy at runtime.

```typescript
import { INLINE_APPROVAL } from '@mast-ai/react-ui';

type OnApprovalRequired = (toolCall: {
  name: string;
  args: unknown;
}) => Promise<boolean | string | typeof INLINE_APPROVAL>;
```

Return values:

- `true`: run the tool normally.
- `false`: runner receives a synthetic "user cancelled" result.
- `string`: skip execution and inject the string as the tool result.
- `INLINE_APPROVAL`: defer to the inline approval queue (see below).

### Inline approvals

When `onApprovalRequired` returns `INLINE_APPROVAL`, a `PendingApproval` is added to `useAgent().pendingApprovals` and the runner pauses. `<ConversationPanel renderToolCall>` receives the handle as the second arg:

```typescript
interface PendingApproval {
  toolName: string;
  args: unknown;
  approve: () => void;
  reject: () => void;
  respondWith: (result: unknown) => void; // skip execution, inject custom result
}
```

Either compose the bundled `<InlineApproval entry approve reject respondWith />` inside `renderToolCall`, or render a custom card. The library handles all promise plumbing, so consumers never call `new Promise`.

## Nested Sub-Agent Tool Calls

Tools built with `createAgentTool` from `@mast-ai/core` automatically forward their child tool events. `useAgentStream` routes child `tool_call_started` / `tool_call_completed` into `ToolEventEntry.nestedToolEvents`, and `<ToolCallBlock>` renders them recursively. No extra wiring is needed in the consumer.

Currently scoped to a single level: grandchild events route back to the outermost matching parent.

## Mention Pipeline (`@`-mentions)

Opt-in: when `mentions` is omitted, `<ChatInput>` renders an unchanged plain textarea.

```typescript
interface MentionItem<T = unknown> {
  id: string;
  label: string;
  description?: string;
  data?: T;
}

interface MentionSegment<T = unknown> {
  text: string; // plain text preceding the chip
  item: MentionItem<T>;
}

interface MentionsConfig<T = unknown> {
  trigger?: string; // default '@'
  items?: MentionItem<T>[]; // static list, filtered by case-insensitive substring on label
  onSearch?: (query: string) => MentionItem<T>[] | Promise<MentionItem<T>[]>; // wins if both are set
  renderItem?: (item: MentionItem<T>, isActive: boolean) => ReactNode;
  renderChip?: (item: MentionItem<T>, onRemove: () => void) => ReactNode;
  buildPrompt?: (segments: MentionSegment<T>[], trailing: string) => string;
}
```

When `buildPrompt` is set, submission calls `sendMessage(buildPrompt(...), inlineDisplayText)`: the LLM receives the augmented prompt while the user bubble shows the inline `@<label>` form.

### useMentions hook

For bespoke inputs (different layout, virtualised picker, non-textarea field):

```typescript
import { useMentions } from '@mast-ai/react-ui';

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
  buildSubmission, // returns { prompt, displayText }
  clear,
} = useMentions(config);
```

`handleKeyDown` returns `true` when it consumed a key (ArrowUp / ArrowDown / Enter / Escape while the picker has items); the host textarea should suppress its own handling in that case.

## Theming

The default stylesheet ships a light theme and an automatic dark theme that follows `prefers-color-scheme`. Apps that manage their own theme can force a value with `theme="light" | "dark"` on `<ConversationPanel>` (sets `data-mast-theme`).

Override individual tokens by setting CSS custom properties under `[data-mast-root]`:

```css
[data-mast-root] {
  --mast-accent: #ec4899;
  --mast-accent-fg: #ffffff;
  --mast-radius: 0.25rem;
}
```

Mention picker tokens: `--mast-mention-chip-bg`, `--mast-mention-picker-bg`, etc. The full token list is in `docs/react-ui/SPEC.md` §2.2 and §13.7.

## Icons

Override any subset of the bundled inline SVG icons via the `icons` prop on `<AgentProvider>`. Unspecified keys fall back to the defaults.

```typescript
interface IconMap {
  brain?: ReactNode; // ThinkingBlock header
  wrench?: ReactNode; // ToolCallBlock header (pending)
  check?: ReactNode; // ToolCallBlock header (success)
  error?: ReactNode; // ToolCallBlock header (error)
  cancelled?: ReactNode; // ToolCallBlock header (cancelled)
  loader?: ReactNode; // streaming spinner; apply class 'mast-spin' to rotate
  send?: ReactNode; // ChatInput send button
  stop?: ReactNode; // ChatInput cancel button
}
```

For a minimal working example, see `assets/react-ui-basic.tsx`.
