// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema object
}

export interface ToolContext {
  signal?: AbortSignal;  // forwarded from the runner; allows long-running tools to be cancelled
}

export interface Tool<TArgs = unknown, TResult = unknown> {
  definition(): ToolDefinition;
  call(args: TArgs, context: ToolContext): Promise<TResult>;
}

export class ToolRegistry {
  private _tools = new Map<string, Tool>();

  register(tool: Tool): this {
    const name = tool.definition().name;
    if (this._tools.has(name)) {
      throw new Error(`Tool '${name}' is already registered.`);
    }
    this._tools.set(name, tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this._tools.get(name);
  }

  definitions(): ToolDefinition[] {
    return Array.from(this._tools.values()).map(t => t.definition());
  }
}
