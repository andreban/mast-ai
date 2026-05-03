// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { AgentConfig } from './types.js';
import type { AgentRunner } from './runner.js';
import type { Tool, ToolContext, ToolDefinition } from './tool.js';
import { AgentError } from './error.js';

/** Configuration for {@link createAgentTool}. */
export interface AgentToolOptions {
  name: string;
  description: string;
  /** JSON Schema object describing the tool's arguments. */
  parameters: Record<string, unknown>;
  /** Whether the tool reads or modifies state. Defaults to `'read'`. */
  scope?: 'read' | 'write';
  /** When true, the tool is sensitive and requires human confirmation before executing. */
  requiresApproval?: boolean;
  /** Build the input string passed to the child agent from the tool args. */
  buildInput: (args: unknown) => string;
}

/**
 * Wraps an {@link AgentConfig} as a {@link Tool} so it can be registered as a
 * sub-agent of another agent. The returned tool, when called, runs `agent` on
 * the given `runner`, forwards every non-`done` child event to
 * `context.onEvent`, and returns the child's final output as the tool result.
 *
 * `runner` and `agent` are independent of the parent: the child can use a
 * different adapter, registry, instructions, or tool allowlist.
 */
export function createAgentTool(
  runner: AgentRunner,
  agent: AgentConfig,
  options: AgentToolOptions,
): Tool {
  const definition: ToolDefinition = {
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    scope: options.scope ?? 'read',
    requiresApproval: options.requiresApproval,
  };

  return {
    definition: () => definition,
    async call(args: unknown, context: ToolContext): Promise<string> {
      const input = options.buildInput(args);
      const builder = runner.runBuilder(agent);
      if (context.signal) builder.signal(context.signal);

      for await (const event of builder.runStream(input)) {
        if (event.type === 'done') {
          return event.output;
        }
        context.onEvent?.(event);
      }

      throw new AgentError(`Sub-agent '${agent.name}' stream ended without a 'done' event.`);
    },
  };
}
