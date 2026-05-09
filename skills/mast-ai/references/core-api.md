# MAST Core API Reference

## AgentConfig

A plain serialisable object that defines the agent's blueprint.

```typescript
export interface AgentConfig {
  name: string;
  instructions: string;
  tools?: string[]; // names of tools the agent may invoke
  outputSchema?: Record<string, unknown>; // JSON Schema for structured output
}
```

## ToolRegistry & Tool

`ToolDefinition` defines the tool's schema. `Tool` is the actual implementation.

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
  scope: 'read' | 'write'; // 'read' is non-mutating; 'write' modifies state
  requiresApproval?: boolean; // tool author declares this tool is sensitive
}

export interface ToolContext {
  signal?: AbortSignal;
  // Tools wrapping sub-agents call this to surface child events to the parent consumer.
  // Filter out 'done' events before forwarding to avoid leaking child history.
  onEvent?: (event: AgentEvent) => void;
  // Active approval handler for the current run; set by the runner. Tools that
  // start sub-agent runs forward this to the child's RunBuilder.withApprovalHandler
  // unless the child runner has its own approvalHandler. createAgentTool does this
  // automatically.
  approvalHandler?: ApprovalHandler;
}

export interface Tool<TArgs = unknown, TResult = unknown> {
  definition(): ToolDefinition;
  call(args: TArgs, context: ToolContext): Promise<TResult>;
}

// Usage
const registry = new ToolRegistry().register({
  definition: () => ({ name: 'myTool', description: '...', parameters: { ... } }),
  call: async (args, context) => { ... }
});

// Subscribe to runtime mutations.
registry.addEventListener('tool-registered', ({ tool }) => { /* ... */ });
registry.addEventListener('tool-unregistered', ({ name }) => { /* ... */ });
// `ToolRegistryView` (returned by `registry.readOnly()`) exposes the same
// addEventListener / removeEventListener API, scoped to the view's filter.
```

## Approval Gating

The runner consults an `ApprovalHandler` before invoking any tool whose definition has `requiresApproval: true`. Tools without the flag, and runs without an attached handler, skip the gate entirely.

```typescript
export interface ApprovalRequest {
  name: string;
  args: unknown;
}

export type ApprovalResponse = { type: 'approve' } | { type: 'reject'; result?: string };

export const ApprovalResponse: {
  approve(): ApprovalResponse;
  reject(result?: string): ApprovalResponse;
};

export interface ApprovalHandler {
  requestApproval(request: ApprovalRequest): Promise<ApprovalResponse>;
}

export const APPROVAL_CANCELLED_RESULT: string;
```

Resolution order for the active handler on a run: `RunBuilder._approvalHandler ?? AgentRunner.approvalHandler`. The runner threads the active handler into `ToolContext.approvalHandler` so tools that start sub-agent runs can forward it (`createAgentTool` does this automatically when `context.approvalHandler` is set and the child runner has no `approvalHandler` of its own — explicit child policy wins).

## AgentRunner

The stateless execution engine. Owns the adapter and registry.

```typescript
export class AgentRunner {
  constructor(adapter: LlmAdapter, registry?: ToolRegistry);

  /** Default ApprovalHandler consulted when no per-run handler is attached. */
  approvalHandler?: ApprovalHandler;

  /** Primary entry point for multi-turn use. Returns a RunBuilder. */
  runBuilder(agent: AgentConfig): RunBuilder;

  /** Creates a Conversation that automatically tracks history across turns. */
  conversation(agent: AgentConfig, options?: ConversationOptions): Conversation;

  /** Single-turn convenience methods (no onToolEvent support). */
  runStream(agent: AgentConfig, input: string): AsyncIterable<AgentEvent>;
  run(agent: AgentConfig, input: string): Promise<AgentResult>;
  runTyped<T>(agent: AgentConfig, input: string): Promise<T>;
}
```

## RunBuilder

Fluent builder returned by `AgentRunner.runBuilder`. Obtain a fresh instance per turn.

```typescript
export class RunBuilder {
  /** Prepend prior conversation turns. */
  history(messages: Message[]): this;

  /** Attach an AbortSignal to cancel the run and any in-flight tool calls. */
  signal(signal: AbortSignal): this;

  /**
   * Subscribe to events emitted by tools that run sub-agents.
   * toolName identifies which tool fired the event.
   * Use this instead of the convenience methods when you need real-time
   * visibility into sub-agent execution.
   */
  onToolEvent(handler: (toolName: string, event: AgentEvent) => void): this;

  /**
   * For tools that internally run a sub-agent: chain this on the sub-agent's
   * RunBuilder to forward every non-`done` event to parentContext.onEvent.
   * Filters `done` (which carries child history) automatically. No-op when
   * parentContext.onEvent is undefined.
   */
  forwardTo(parentContext: ToolContext): this;

  /**
   * Attach an ApprovalHandler that gates `requiresApproval` tools for this run.
   * Overrides the runner-level default (AgentRunner.approvalHandler).
   */
  withApprovalHandler(handler: ApprovalHandler): this;

  runStream(input: string): AsyncIterable<AgentEvent>;
  run(input: string): Promise<AgentResult>;
  runTyped<T>(input: string): Promise<T>;
}

// Usage — subscribing to sub-agent events
runner
  .runBuilder(agent)
  .onToolEvent((toolName, event) => {
    if (event.type === 'text_delta') updateSkillPanel(toolName, event.delta);
  })
  .runStream(input);

// Usage — inside a custom tool that wraps a sub-agent
async call(args, context: ToolContext): Promise<string> {
  const builder = childRunner.runBuilder(childAgent).forwardTo(context);
  for await (const event of builder.runStream(input)) {
    if (event.type === 'done') return event.output;
  }
  throw new Error('child stream ended without done');
}
```

## Conversation

Wraps `AgentRunner` to track state automatically across turns.

```typescript
export interface ConversationOptions {
  /** Approval handler attached to every Conversation.runStream call. */
  approvalHandler?: ApprovalHandler;
}

export class Conversation {
  /** Full conversation history, updated automatically after each completed turn. */
  history: Message[];

  run(input: string, signal?: AbortSignal): Promise<AgentResult>;
  runStream(input: string, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}

// Usage
const conv = runner.conversation(agent, { approvalHandler });
const result = await conv.run('Hello!');
// conv.history is automatically updated. The handler propagates through
// ToolContext.approvalHandler into any sub-agent run started via createAgentTool.
```
