// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolContext } from '@mast-ai/core';

/** Returns the current time as an ISO 8601 string. */
export class GetCurrentTimeTool implements Tool {
  definition() {
    return {
      name: 'get_current_time',
      description: 'Returns the current time as an ISO 8601 string.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      scope: 'read' as const,
    };
  }

  async call(_args: unknown, _context: ToolContext): Promise<string> {
    return new Date().toISOString();
  }
}
