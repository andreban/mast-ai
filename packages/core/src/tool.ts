// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { AgentEvent } from './types.js';

/** Static description of a tool that is sent to the model so it can decide when to call it. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object describing the tool's arguments. */
  parameters: Record<string, unknown>;
  /** Whether the tool reads or modifies state. Used for scope-based filtering. */
  scope: 'read' | 'write';
  /** When true, the tool author declares this tool is sensitive and requires human confirmation before executing. */
  requiresApproval?: boolean;
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

/**
 * Events emitted by {@link ToolRegistry} (and {@link ToolRegistryView}) when its
 * contents change at runtime. UI components and adapters can subscribe via
 * `addEventListener` to refresh toolbars, re-advertise capabilities, or trigger
 * a new agent turn.
 */
export type ToolRegistryEventMap = {
  /** Fired after a tool is successfully added. */
  'tool-registered': { tool: Tool };
  /** Fired after a tool is removed. Not fired for no-op `unregister` calls. */
  'tool-unregistered': { name: string };
};

type ToolRegistryListener<K extends keyof ToolRegistryEventMap> = (
  event: ToolRegistryEventMap[K],
) => void;

class ToolRegistryEventEmitter {
  private listeners: {
    [K in keyof ToolRegistryEventMap]?: Set<ToolRegistryListener<K>>;
  } = {};

  on<K extends keyof ToolRegistryEventMap>(type: K, listener: ToolRegistryListener<K>): void {
    let set = this.listeners[type];
    if (!set) {
      set = new Set();
      this.listeners[type] = set;
    }
    set.add(listener);
  }

  off<K extends keyof ToolRegistryEventMap>(type: K, listener: ToolRegistryListener<K>): void {
    this.listeners[type]?.delete(listener);
  }

  emit<K extends keyof ToolRegistryEventMap>(type: K, event: ToolRegistryEventMap[K]): void {
    const set = this.listeners[type];
    if (!set) return;
    for (const listener of [...set]) listener(event);
  }
}

/** Holds all tools available to an {@link AgentRunner} and resolves them by name during execution. */
export class ToolRegistry implements ToolProvider {
  private _tools = new Map<string, Tool>();
  private _emitter = new ToolRegistryEventEmitter();

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
    this._emitter.emit('tool-registered', { tool });
    return this;
  }

  /** Removes the tool registered under `name`. No-op if not found. */
  unregister(name: string): void {
    if (!this._tools.delete(name)) return;
    this._emitter.emit('tool-unregistered', { name });
  }

  /** Returns the tool registered under `name`, or `undefined` if not found. */
  getTool(name: string): Tool | undefined {
    return this._tools.get(name);
  }

  /** Returns the definitions of all registered tools for inclusion in an adapter request. */
  getTools(): ToolDefinition[] {
    return Array.from(this._tools.values()).map((t) => t.definition());
  }

  /** Returns a live read-only view filtered to tools with `scope: 'read'`. */
  readOnly(): ToolRegistryView {
    return new ToolRegistryView(this, 'read');
  }

  /** Subscribe to registry mutation events. */
  addEventListener<K extends keyof ToolRegistryEventMap>(
    type: K,
    listener: ToolRegistryListener<K>,
  ): void {
    this._emitter.on(type, listener);
  }

  /** Unsubscribe a previously registered listener. */
  removeEventListener<K extends keyof ToolRegistryEventMap>(
    type: K,
    listener: ToolRegistryListener<K>,
  ): void {
    this._emitter.off(type, listener);
  }
}

/**
 * A live filtered projection of a {@link ToolRegistry}.
 *
 * Changes to the parent registry are automatically reflected — no copy is made.
 * Only tools whose `scope` matches the view's scope are visible.
 */
export class ToolRegistryView implements ToolProvider {
  private _emitter = new ToolRegistryEventEmitter();
  private _scopedNames?: Set<string>;

  constructor(
    private readonly parent: ToolRegistry,
    private readonly scope: 'read' | 'write',
  ) {}

  getTools(): ToolDefinition[] {
    return this.parent.getTools().filter((def) => def.scope === this.scope);
  }

  getTool(name: string): Tool | undefined {
    const tool = this.parent.getTool(name);
    if (!tool) return undefined;
    return tool.definition().scope === this.scope ? tool : undefined;
  }

  /**
   * Subscribe to mutation events forwarded from the parent registry. Only
   * events for tools whose `scope` matches this view's scope are delivered.
   */
  addEventListener<K extends keyof ToolRegistryEventMap>(
    type: K,
    listener: ToolRegistryListener<K>,
  ): void {
    this.ensureParentSubscription();
    this._emitter.on(type, listener);
  }

  /** Unsubscribe a previously registered listener. */
  removeEventListener<K extends keyof ToolRegistryEventMap>(
    type: K,
    listener: ToolRegistryListener<K>,
  ): void {
    this._emitter.off(type, listener);
  }

  private ensureParentSubscription(): void {
    if (this._scopedNames) return;
    const scoped = new Set<string>();
    for (const def of this.parent.getTools()) {
      if (def.scope === this.scope) scoped.add(def.name);
    }
    this._scopedNames = scoped;
    this.parent.addEventListener('tool-registered', (event) => {
      const def = event.tool.definition();
      if (def.scope !== this.scope) return;
      scoped.add(def.name);
      this._emitter.emit('tool-registered', event);
    });
    this.parent.addEventListener('tool-unregistered', (event) => {
      if (!scoped.delete(event.name)) return;
      this._emitter.emit('tool-unregistered', event);
    });
  }
}
