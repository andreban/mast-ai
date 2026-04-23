# MAST Core API Reference

## AgentConfig

A plain serialisable object that defines the agent's blueprint.

```typescript
export interface AgentConfig {
  name: string;
  instructions: string;
  tools?: string[];                 // names of tools the agent may invoke
  outputSchema?: Record<string, unknown>;  // JSON Schema for structured output
}
```

## ToolRegistry & Tool

`ToolDefinition` defines the tool's schema. `Tool` is the actual implementation.

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema object
}

export interface ToolContext {
  signal?: AbortSignal;
  // Tools wrapping sub-agents call this to surface child events to the parent consumer.
  // Filter out 'done' events before forwarding to avoid leaking child history.
  onEvent?: (event: AgentEvent) => void;
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
```

## AgentRunner

The stateless execution engine. Owns the adapter and registry.

```typescript
export class AgentRunner {
  constructor(adapter: LlmAdapter, registry?: ToolRegistry);

  /** Primary entry point for multi-turn use. Returns a RunBuilder. */
  runBuilder(agent: AgentConfig): RunBuilder;

  /** Creates a Conversation that automatically tracks history across turns. */
  conversation(agent: AgentConfig): Conversation;

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
```

## Conversation

Wraps `AgentRunner` to track state automatically across turns.

```typescript
export class Conversation {
  /** Full conversation history, updated automatically after each completed turn. */
  history: Message[];

  run(input: string, signal?: AbortSignal): Promise<AgentResult>;
  runStream(input: string, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}

// Usage
const conv = runner.conversation(agent);
const result = await conv.run('Hello!');
// conv.history is automatically updated.
```

