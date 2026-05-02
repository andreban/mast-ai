# Plan: Tool Event Streaming

## Goal

Allow tools that internally run sub-agents to forward child `AgentEvent`s (thinking chunks, text deltas, tool calls) to the parent runner's consumer in real time, so UIs can show what a skill is doing as it executes.

## Approach

Add an `onEvent` callback to `ToolContext` and an `onToolEvent` hook to `RunBuilder`. Tools that wrap sub-agents call `context.onEvent?.(event)` for each child event. Simple tools that don't call it are completely unaffected. Parallel tool execution via `Promise.all` is preserved.

## Status: complete

All `@mast-ai/core` changes are implemented. See [Consumer integration](#consumer-integration) for how to wire this up in downstream projects.

---

## Implementation

### `src/tool.ts` — add `onEvent` to `ToolContext`

```typescript
import type { AgentEvent } from './types';

export interface ToolContext {
  signal?: AbortSignal;
  /**
   * Called by tools that internally run sub-agents to surface child events
   * to the parent runner's consumer. Simple tools can ignore this entirely.
   * Filter out 'done' events before forwarding to avoid leaking child history.
   */
  onEvent?: (event: AgentEvent) => void;
}
```

### `src/runner.ts` — add `onToolEvent` to `RunBuilder`

```typescript
export class RunBuilder {
  private _onToolEvent?: (toolName: string, event: AgentEvent) => void;

  onToolEvent(handler: (toolName: string, event: AgentEvent) => void): this {
    this._onToolEvent = handler;
    return this;
  }

  runStream(input: string): AsyncIterable<AgentEvent> {
    return this.execute(input, this._history, this._signal, this._onToolEvent);
  }
}
```

`StreamExecutor` and `executeStream` are updated to carry `onToolEvent` through. Inside `Promise.all`, each tool call receives `onEvent` wired to the handler:

```typescript
const result = await tool.call(call.args, {
  signal,
  onEvent: onToolEvent
    ? (event) => onToolEvent(call.name, event)
    : undefined,
});
```

---

## Consumer integration

### In the sub-agent tool (`delegate_to_skill`)

Switch from `run()` to `runStream()` and forward non-`done` events:

```typescript
async call(args: DelegateToSkillArgs, context: ToolContext): Promise<string> {
  for await (const event of childRunner.runBuilder(skill).runStream(args.input)) {
    if (event.type !== 'done') {
      context.onEvent?.(event); // forward thinking / text_delta / tool_call_* only
    } else {
      return event.output;      // only the result goes back to the parent agent
    }
  }
  throw new Error('Child runner ended without a done event');
}
```

`done` must be filtered out. It carries `history: Message[]` — the child's full conversation history — which must not reach the parent's consumers. The parent agent's own context is unaffected (it only sees the tool result string), but UI consumers registered via `onToolEvent` would receive the history payload if `done` is forwarded.

### At the parent run call site

Replace the convenience method with `runBuilder` and attach the handler:

```typescript
runner
  .runBuilder(agentConfig)
  .onToolEvent((toolName, event) => {
    dispatchSkillEvent(toolName, event);
  })
  .runStream(userInput);
```

Key: because `Promise.all` runs tools concurrently, events from multiple tools may interleave. Key UI state by `toolName`, not by arrival order.

> Note: the convenience methods on `AgentRunner` (`run`, `runStream`, `runTyped`) do not surface tool events. Use `runBuilder().onToolEvent(...)` when real-time child visibility is needed.

---

## Files changed in `@mast-ai/core`

| File | Change |
|---|---|
| `src/tool.ts` | Add `onEvent?: (event: AgentEvent) => void` to `ToolContext`; import `AgentEvent` from `./types` |
| `src/runner.ts` | Add `_onToolEvent` field and `onToolEvent()` to `RunBuilder`; update `StreamExecutor` type and `executeStream` signature; pass `onEvent` into `ToolContext` inside `Promise.all` |

No changes to `src/types.ts`, `src/conversation.ts`, or any adapter.
