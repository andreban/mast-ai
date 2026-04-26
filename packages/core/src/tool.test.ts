// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry, ToolRegistryView, type ToolProvider } from './tool';
import type { Tool, ToolDefinition, ToolContext } from './tool';

function makeTool(name: string, scope: 'read' | 'write'): Tool {
  return {
    definition: (): ToolDefinition => ({
      name,
      description: `${name} tool`,
      parameters: {},
      scope,
    }),
    call: vi.fn().mockResolvedValue({}),
  };
}

describe('ToolDefinition', () => {
  it('has a scope field', () => {
    const def: ToolDefinition = {
      name: 'test',
      description: 'test',
      parameters: {},
      scope: 'read',
    };
    expect(def.scope).toBe('read');
  });
});

describe('ToolRegistry', () => {
  it('implements ToolProvider', () => {
    const registry: ToolProvider = new ToolRegistry();
    expect(typeof registry.getTools).toBe('function');
    expect(typeof registry.getTool).toBe('function');
  });

  it('registers and retrieves tools', () => {
    const registry = new ToolRegistry();
    const tool = makeTool('myTool', 'read');
    registry.register(tool);
    expect(registry.getTool('myTool')).toBe(tool);
  });

  it('throws when registering a duplicate tool name', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('dup', 'read'));
    expect(() => registry.register(makeTool('dup', 'write'))).toThrow("Tool 'dup' is already registered.");
  });

  it('getTools returns definitions of all registered tools', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('a', 'read'));
    registry.register(makeTool('b', 'write'));
    const defs = registry.getTools();
    expect(defs).toHaveLength(2);
    expect(defs.map(d => d.name)).toContain('a');
    expect(defs.map(d => d.name)).toContain('b');
  });

  it('getTool returns undefined for unknown names', () => {
    const registry = new ToolRegistry();
    expect(registry.getTool('missing')).toBeUndefined();
  });

  it('unregister removes a tool', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('gone', 'write'));
    registry.unregister('gone');
    expect(registry.getTool('gone')).toBeUndefined();
    expect(registry.getTools()).toHaveLength(0);
  });

  it('unregister is a no-op for unknown names', () => {
    const registry = new ToolRegistry();
    expect(() => registry.unregister('nope')).not.toThrow();
  });

  it('readOnly returns a ToolRegistryView', () => {
    const registry = new ToolRegistry();
    expect(registry.readOnly()).toBeInstanceOf(ToolRegistryView);
  });
});

describe('ToolRegistryView', () => {
  it('implements ToolProvider', () => {
    const view: ToolProvider = new ToolRegistry().readOnly();
    expect(typeof view.getTools).toBe('function');
    expect(typeof view.getTool).toBe('function');
  });

  it('getTools filters to matching scope only', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('reader', 'read'));
    registry.register(makeTool('writer', 'write'));

    const view = registry.readOnly();
    const defs = view.getTools();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('reader');
  });

  it('getTool returns tool when scope matches', () => {
    const registry = new ToolRegistry();
    const tool = makeTool('reader', 'read');
    registry.register(tool);

    const view = registry.readOnly();
    expect(view.getTool('reader')).toBe(tool);
  });

  it('getTool returns undefined when scope does not match', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('writer', 'write'));

    const view = registry.readOnly();
    expect(view.getTool('writer')).toBeUndefined();
  });

  it('getTool returns undefined for unknown names', () => {
    const view = new ToolRegistry().readOnly();
    expect(view.getTool('missing')).toBeUndefined();
  });

  it('reflects additions to the parent registry live', () => {
    const registry = new ToolRegistry();
    const view = registry.readOnly();

    expect(view.getTools()).toHaveLength(0);

    registry.register(makeTool('lateRead', 'read'));
    expect(view.getTools()).toHaveLength(1);
    expect(view.getTool('lateRead')).toBeDefined();
  });

  it('reflects removals from the parent registry live', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('removable', 'read'));
    const view = registry.readOnly();

    expect(view.getTools()).toHaveLength(1);
    registry.unregister('removable');
    expect(view.getTools()).toHaveLength(0);
  });
});
