// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolContext } from '@mast-ai/core';

export class GetCurrentTimeTool implements Tool {
  definition() {
    return {
      name: 'getCurrentTime',
      description: 'Returns the current local time as a string.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      },
      scope: 'read' as const
    };
  }

  async call(_args: unknown, _context: ToolContext): Promise<{ time: string }> {
    return { time: new Date().toISOString() };
  }
}
