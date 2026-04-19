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
      }
    };
  }

  async call(_args: unknown, _context: ToolContext): Promise<{ time: string }> {
    return { time: new Date().toISOString() };
  }
}
