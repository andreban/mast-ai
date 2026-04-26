// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { AgentEvent } from './types';

/** Static description of a tool that is sent to the model so it can decide when to call it. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object describing the tool's arguments. */
  parameters: Record<string, unknown>;
  /** Whether the tool reads or modifies state. Used for scope-based filtering. */
  scope: 'read' | 'write';
}

/** Runtime context passed to every {@link Tool.call} invocation. */
export interface ToolContext {
  /** Forwarded from the runner; allows long-running tools to be cancelled. */
  signal?: AbortSignal;
  /**
   * Called by tools that internally run sub-agents to surface child events to
   * the parent runner's consumer. Simple tools can ignore this entirely.
   * Tools should filter out {@link AgentEvent} `done` events before forwarding
   * to avoid leaking child conversation history to the parent's consumers.
   */
  onEvent?: (event: AgentEvent) => void;
}

/**
 * A callable tool that can be registered with a {@link ToolRegistry}.
 *
 * @typeParam TArgs - Shape of the arguments object the model passes to `call`.
 * @typeParam TResult - Value returned by `call` and forwarded to the model as the tool result.
 */
export interface Tool<TArgs = unknown, TResult = unknown> {
  /** Returns the static description used to advertise this tool to the model. */
  definition(): ToolDefinition;
  /** Executes the tool with the given arguments. */
  call(args: TArgs, context: ToolContext): Promise<TResult>;
}

/**
 * Read-only interface for accessing tool definitions and resolving tools by name.
 * Passed to {@link AgentRunner} so that scope-based filtering is handled by the
 * provider rather than the runner.
 */
export interface ToolProvider {
  /** Returns the definitions of all accessible tools. */
  getTools(): ToolDefinition[];
  /** Returns the tool registered under `name`, or `undefined` if not found or out of scope. */
  getTool(name: string): Tool | undefined;
}

/** Holds all tools available to an {@link AgentRunner} and resolves them by name during execution. */
export class ToolRegistry implements ToolProvider {
  private _tools = new Map<string, Tool>();

  /**
   * Registers a tool. Throws if a tool with the same name is already registered.
   * Returns `this` for chaining.
   */
  register(tool: Tool): this {
    const name = tool.definition().name;
    if (this._tools.has(name)) {
      throw new Error(`Tool '${name}' is already registered.`);
    }
    this._tools.set(name, tool);
    return this;
  }

  /** Removes the tool registered under `name`. No-op if not found. */
  unregister(name: string): void {
    this._tools.delete(name);
  }

  /** Returns the tool registered under `name`, or `undefined` if not found. */
  getTool(name: string): Tool | undefined {
    return this._tools.get(name);
  }

  /** Returns the definitions of all registered tools for inclusion in an adapter request. */
  getTools(): ToolDefinition[] {
    return Array.from(this._tools.values()).map(t => t.definition());
  }

  /** Returns a live read-only view filtered to tools with `scope: 'read'`. */
  readOnly(): ToolRegistryView {
    return new ToolRegistryView(this, 'read');
  }
}

/**
 * A live filtered projection of a {@link ToolRegistry}.
 *
 * Changes to the parent registry are automatically reflected — no copy is made.
 * Only tools whose `scope` matches the view's scope are visible.
 */
export class ToolRegistryView implements ToolProvider {
  constructor(
    private readonly parent: ToolRegistry,
    private readonly scope: 'read' | 'write',
  ) {}

  getTools(): ToolDefinition[] {
    return this.parent.getTools().filter(def => def.scope === this.scope);
  }

  getTool(name: string): Tool | undefined {
    const tool = this.parent.getTool(name);
    if (!tool) return undefined;
    return tool.definition().scope === this.scope ? tool : undefined;
  }
}
