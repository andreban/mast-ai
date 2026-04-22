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

  /** Creates a Conversation that automatically tracks history across turns. */
  conversation(agent: AgentConfig): Conversation;

  /** Single-turn convenience methods */
  runStream(agent: AgentConfig, input: string): AsyncIterable<AgentEvent>;
  run(agent: AgentConfig, input: string): Promise<AgentResult>;
  runTyped<T>(agent: AgentConfig, input: string): Promise<T>;
}
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

