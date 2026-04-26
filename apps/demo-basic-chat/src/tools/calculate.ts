// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolContext } from '@mast-ai/core';

export class CalculatorTool implements Tool {
  definition() {
    return {
      name: 'calculate',
      description: 'Evaluates a mathematical expression (e.g., "2 + 2").',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string' }
        },
        required: ['expression']
      },
      scope: 'read' as const
    };
  }

  async call(args: unknown, _context: ToolContext): Promise<{ result: number }> {
    const { expression } = args as { expression: string };
    try {
      const result = new Function(`return ${expression}`)();
      return { result };
    } catch {
      throw new Error(`Failed to evaluate expression: ${expression}`);
    }
  }
}
