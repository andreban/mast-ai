// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

/** Static description of a tool that is sent to the model so it can decide when to call it. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object describing the tool's arguments. */
  parameters: Record<string, unknown>;
}

/** Runtime context passed to every {@link Tool.call} invocation. */
export interface ToolContext {
  /** Forwarded from the runner; allows long-running tools to be cancelled. */
  signal?: AbortSignal;
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

/** Holds all tools available to an {@link AgentRunner} and resolves them by name during execution. */
export class ToolRegistry {
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

  /** Returns the tool registered under `name`, or `undefined` if not found. */
  get(name: string): Tool | undefined {
    return this._tools.get(name);
  }

  /** Returns the definitions of all registered tools for inclusion in an adapter request. */
  definitions(): ToolDefinition[] {
    return Array.from(this._tools.values()).map(t => t.definition());
  }
}
