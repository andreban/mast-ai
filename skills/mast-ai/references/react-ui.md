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
  runner: AgentRunner | null; // null = "agent not yet configured" (no key, signed-out)
  agent: AgentConfig;
  children: ReactNode;
  icons?: IconMap;
  onApprovalRequired?: OnApprovalRequired;
  approvalOverride?: string[]; // '!name' suppresses approval for that tool; bare names are accepted for symmetry but no longer add approval (set `requiresApproval: true` on the definition instead)
  initialHistory?: Message[]; // read once on mount
  initialEntries?: ConversationEntry[]; // read once on mount
  onConversationChange?: (history: Message[], entries: ConversationEntry[]) => void;
  theme?: 'light' | 'dark' | 'auto'; // forwarded to the auto wrapper when disableRoot={false}; default 'light'
  disableRoot?: boolean; // default true; pass false to opt into the auto <div data-mast-root> wrapper
}
```

Internally creates a `Conversation` via `runner.conversation(agent, { approvalHandler })`, where `approvalHandler` bridges `onApprovalRequired` and `approvalOverride` into the runner's per-run gating contract. The user's `runner` is used directly (no shadow runner). To switch conversations at runtime, remount with a React `key` and seed via `initialHistory` / `initialEntries`. `onConversationChange` fires only after a successful `done` event (not on cancel or error).

`runner={null}` is the "agent not yet configured" state for chat UIs that mount before the user has supplied an API key, signed in, etc. `useAgent()` returns disabled-state defaults (`isReady: false`, empty messages/history, no-op `sendMessage` with a console warning), and `<ChatInput>` greys out automatically. Switching `null` → real runner does not require remounting; the conversation starts fresh on the next `sendMessage` (and picks up `initialHistory` if provided). Prefer this over constructing a stub runner whose adapter throws.

By default, the provider is transparent in the DOM. Place `data-mast-root` on whichever element should anchor the library's CSS variables (typically the outermost container, or implicitly via `<ConversationPanel>` which carries its own). Pass `disableRoot={false}` to opt into a zero-config `<div data-mast-root data-mast-theme={theme}>` wrapper for layouts that have no natural outer container.

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
  isReady: boolean; // false when <AgentProvider> was mounted with runner={null}
}
```

`sendMessage(prompt, displayText?)`: when `displayText` is provided the user bubble renders `displayText` while the LLM receives `prompt`. Use this for slash commands, PII redaction, and the mention pipeline.

## ConversationPanel

Drop-in chat UI. Wraps `<MessageList>` and `<ChatInput>` inside a `[data-mast-root]` element that also carries the `mast-panel` class for the bundled chrome.

```typescript
import { ConversationPanel } from '@mast-ai/react-ui';

interface ConversationPanelProps {
  theme?: 'light' | 'dark' | 'auto'; // default 'light'; pass 'auto' to follow prefers-color-scheme
  className?: string;
  renderToolCall?: (entry: ToolEventEntry, approval?: PendingApproval) => ReactNode;
  renderApproval?: (entry: ToolEventEntry, approval: PendingApproval) => ReactNode;
  renderMessage?: (text: string) => ReactNode;
  inputPlaceholder?: string;
  mentions?: MentionsConfig;
}
```

## Primitives

For non-default layouts (sidebar, docked panel, etc.), drop the primitives into your own JSX. `<AgentProvider>` is already transparent by default, so just add `data-mast-root` to whatever element should anchor the CSS custom properties. (Use `disableRoot={false}` when you want the provider to render its own zero-config wrapper instead.) `[data-mast-root]` is purely the theming scope; add the `mast-panel` class to the same element if you want the bundled chrome (border, padding, flex column, `height: 100%`), or skip it to use your own card without doubled borders.

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
  subText?: string; // accumulated sub-agent text
  nestedContentBlocks?: ContentBlock[]; // sub-agent thinking + tool calls in source order
  isStreaming: boolean;
  awaitingApproval?: boolean;
  status?: 'success' | 'error' | 'cancelled';
}
```

## Approval Flow

Approval is enforced inside `@mast-ai/core`'s `AgentRunner`: before invoking any tool whose `ToolDefinition.requiresApproval` is `true`, the runner consults the `ApprovalHandler` `<AgentProvider>` attached to the run. Three pieces:

1. Tool author sets `requiresApproval: true` on the tool definition.
2. By default, the library routes such calls through the inline approval queue (`useAgent().pendingApprovals`) rendered by `<InlineApproval>`. Apps may supply `onApprovalRequired` on `<AgentProvider>` to plug in a different confirmation UI, auto-approve specific tools, inject canned results, or short-circuit cancellations.
3. Optional: `approvalOverride={['!safe_tool']}` suppresses approval for a flagged tool at runtime. To _add_ approval to a tool that does not declare it, set `requiresApproval: true` on the definition at registration — the runner only consults the handler for flagged tools.

```typescript
import { INLINE_APPROVAL } from '@mast-ai/react-ui';

type OnApprovalRequired = (toolCall: {
  name: string;
  args: unknown;
}) => Promise<boolean | string | typeof INLINE_APPROVAL>;
```

Return values:

- `true`: run the tool normally.
- `false`: skip execution; runner receives the default cancelled string and the UI marks the call as `'cancelled'`.
- `string`: skip execution and inject the string as the tool result; the UI marks the call as `'cancelled'`.
- `INLINE_APPROVAL`: defer to the inline approval queue (see below).

Sub-agents started via `createAgentTool` automatically inherit the parent's `ApprovalHandler` through `ToolContext.approvalHandler`, so a `requiresApproval: true` tool registered on a child runner surfaces approvals to the same `<AgentProvider>` UI — even when the child uses an independent `AgentRunner` with a different adapter or registry. A child runner that sets its own `approvalHandler` opts out of inheritance and enforces its own policy.

### Inline approvals

When `onApprovalRequired` returns `INLINE_APPROVAL`, a `PendingApproval` is added to `useAgent().pendingApprovals` and the runner pauses:

```typescript
interface PendingApproval {
  toolName: string;
  args: unknown;
  approve: () => void;
  reject: (result?: string) => void; // omit `result` for the default cancelled string;
  // pass a string to inject it as the tool result. UI status is `'cancelled'` either way.
}
```

Three rendering entry points:

- **`renderApproval`** (narrow): replaces only the approval card. Called once per tool event with a pending approval handle; non-approval events fall through to `renderToolCall` or the default `<ToolCallBlock>`. Use this when you only want to customise the approval prompt (e.g. render `Rename "Old" to "New"?` instead of the raw arg JSON). Compose `<InlineApproval entry approve reject />` inside the slot as the fallback for tools you have not customised.
- **`renderToolCall`** (full): receives `(entry, approval?)` for every tool event. Use this when the approval card and the rest of the tool-call rendering should both be customised together.
- **`<InlineApproval>`** (default): used automatically for any awaiting entry when neither slot is provided.

`renderApproval` takes precedence over `renderToolCall` for awaiting entries when both are provided. The library handles all promise plumbing, so consumers never call `new Promise`.

## Nested Sub-Agent Tool Calls

Tools built with `createAgentTool` from `@mast-ai/core` automatically forward their child events. `useAgentStream` routes child `thinking`, `tool_call_started`, and `tool_call_completed` events into `ToolEventEntry.nestedContentBlocks` — an interleaved array of `ThinkingEntry` and `ToolEventEntry` blocks in source order. `<ToolCallBlock>` renders the array in that order. No extra wiring is needed in the consumer.

For custom tools that wrap a sub-agent (where `createAgentTool` is too prescriptive), chain `RunBuilder.forwardTo(context)` on the sub-agent run so the parent's `nestedContentBlocks` and `subText` populate without manual forwarding boilerplate. Forgetting to forward is a silent UX failure.

Currently scoped to a single level: grandchild events route back to the outermost matching parent.

## Collapsible `<ToolCallBlock>`

`<ToolCallBlock>` itself is a `<details>`: the header (status icon + tool name) is the click target, and the body — sub-output, nested events, args, result — collapses behind it. Control the open state with `defaultOpen?: boolean | 'streaming'`:

- `'streaming'` (default): open while `entry.isStreaming`, collapses on completion.
- `true`: always open.
- `false`: always collapsed.

```tsx
<ToolCallBlock entry={entry} defaultOpen={false} />
```

## Overriding the tool call header label

`<ToolCallBlock>` shows `entry.name` in its header by default. For delegation-style tools whose interesting label lives in the args (e.g. `delegate_to_skill` should display the target skill's name), override the header without forking the rest of the rendering.

Two slots, same precedence chain (`label` prop → `getToolLabel` from context → `entry.name`):

- **`label?: ReactNode`** on `<ToolCallBlock>` itself — direct, per-instance override. Use inside a `renderToolCall` callback when you already need to dispatch on tool name.
- **`getToolLabel?: (entry) => ReactNode`** on `<ConversationPanel>` / `<MessageList>` / `<AssistantMessage>` — list-wide resolver. Flows via context to every nested `<ToolCallBlock>` (including sub-agent tool calls). Returning `undefined` or `null` falls back to `entry.name`, so it is ergonomic to relabel one tool while leaving everything else untouched.

```tsx
import { ConversationPanel, type GetToolLabel } from '@mast-ai/react-ui';

const getToolLabel: GetToolLabel = (entry) => {
  if (entry.name === 'delegate_to_skill') {
    const args = entry.args as { skillName?: string } | undefined;
    return args?.skillName;
  }
  return undefined;
};

<ConversationPanel getToolLabel={getToolLabel} />;
```

Use `getToolLabel` when relabelling is the only customisation. Reach for `renderToolCall` + `<ToolCallBlock label>` when you also need to swap the body (e.g. render a chart for a specific tool). The two compose: the `label` prop wins over `getToolLabel`, but the resolver still applies to bundled blocks rendered for tools the callback did not customise.

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

The default stylesheet ships a light theme (default) and an opt-in dark theme. Apps choose with `theme="light" | "dark" | "auto"` on `<ConversationPanel>` (or, when opted in via `disableRoot={false}`, on `<AgentProvider>` so it's forwarded onto the auto wrapper). Both set `data-mast-theme`. Pass `"auto"` to follow `prefers-color-scheme`; the library defaults to light when the attribute is unset, so apps without their own dark theme do not get a surprise dark panel inside an otherwise-light surface.

Every rule in `styles.css` and the bundled theme presets lives inside a `@layer mast-ai` cascade layer. Layered rules always lose to unlayered rules, so a host stylesheet authored against the existing class names overrides the library at equal specificity without `!important`. Hosts that prefer to keep their overrides layered can declare `@layer mast-ai, host;` and write rules inside `@layer host { … }`.

Override individual tokens by setting CSS custom properties under `[data-mast-root]`:

```css
[data-mast-root] {
  --mast-accent: #ec4899;
  --mast-accent-fg: #ffffff;
  --mast-radius: 0.25rem;
}
```

Element-shape tokens (`--mast-button-border`, `--mast-button-padding`, `--mast-input-border`, `--mast-message-border-width`, `--mast-user-bubble-border`) cover the long tail of "my buttons / inputs / message bubbles look slightly different" without reaching into specific class names. Defaults preserve the current visuals.

Typography inherits from the host by default: `--mast-font` is `inherit` and `--mast-text-base` is `1em`, so the panel adopts the surrounding app's font and base size. Hosts that want to pin a specific font set `--mast-font` (and optionally `--mast-text-base`) on `[data-mast-root]`.

For Tailwind / shadcn apps, import the bundled preset to remap every `--mast-*` token onto the standard shadcn HSL variables in one line:

```ts
import '@mast-ai/react-ui/styles.css';
import '@mast-ai/react-ui/themes/tailwind-shadcn.css';
```

Two gotchas when writing the mapping by hand: list `[data-mast-root]`, `[data-mast-root][data-mast-theme='dark']`, `[data-mast-root][data-mast-theme='light']`, and `[data-mast-root][data-mast-theme='auto']` together so source order tie-breaks against the library's dark-mode blocks at every theme variant, and pass `data-mast-theme={theme}` on the panel root so the library tracks the app's class-based dark mode (`.dark` on `<html>`).

The full token list, gotcha rationale, and a plain-CSS example are in `docs/react-ui/USAGE.md` §5.

## Tools that read or modify React state

Tools that wrap component state hit two closure pitfalls when the LLM fires several tool calls in the same turn:

- **Stale reads**: `call` references `tasks` from the closure, so state updates made by earlier tools in the turn are invisible (React has not re-rendered yet).
- **Lost writes**: `setTasks([...tasks, newTask])` reads `tasks` from the closure, so two `add_task` calls compute the next array from the same snapshot and the second overwrites the first.

Standard fix: functional updaters for writes, and a `useRef` mirror for reads. Update the ref synchronously inside the functional updater so subsequent tool calls in the same turn see the post-write value:

```tsx
const [tasks, setTasks] = useState<Task[]>([]);
const tasksRef = useRef(tasks);
tasksRef.current = tasks; // keep ref in sync with non-tool updates too

const runner = useMemo(() => {
  const addTask: Tool = {
    definition: () => ({ name: 'add_task', /* ... */ scope: 'write' }),
    async call(args: unknown) {
      const { name } = args as { name: string };
      setTasks((prev) => {
        const next = [...prev, { id: crypto.randomUUID(), name, completed: false }];
        tasksRef.current = next;
        return next;
      });
      return `Added "${name}".`;
    },
  };
  const listTasks: Tool = {
    definition: () => ({ name: 'list_tasks', /* ... */ scope: 'read' }),
    async call() {
      return JSON.stringify(tasksRef.current);
    },
  };
  const registry = new ToolRegistry().register(addTask).register(listTasks);
  return new AgentRunner(new GoogleGenAIAdapter(apiKey), registry);
}, [apiKey]);
```

Build the tools inside `useMemo` so the setter and ref identities are captured in stable closures and the runner does not get torn down on every `tasks` change. The full walkthrough is in `docs/react-ui/USAGE.md` §15.

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
