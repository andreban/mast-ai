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

/** Returns the current page title. Marked as requiring approval to demonstrate the approval flow. */
export class GetPageTitleTool implements Tool {
  definition() {
    return {
      name: 'get_page_title',
      description: 'Returns the title of the current browser page.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      scope: 'read' as const,
      requiresApproval: true,
    };
  }

  async call(_args: unknown, _context: ToolContext): Promise<string> {
    return document.title;
  }
}

interface SetPageTitleArgs {
  title: string;
}

/** Sets the current page title. Demonstrates inline approval with arguments to review. */
export class SetPageTitleTool implements Tool<SetPageTitleArgs, string> {
  definition() {
    return {
      name: 'set_page_title',
      description: 'Sets the title of the current browser page (visible in the browser tab).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The new page title.' },
        },
        required: ['title'],
      },
      scope: 'write' as const,
      requiresApproval: true,
    };
  }

  async call(args: SetPageTitleArgs, _context: ToolContext): Promise<string> {
    document.title = args.title;
    return `Page title set to: ${args.title}`;
  }
}

interface CopyToClipboardArgs {
  text: string;
}

/** Writes a string to the system clipboard. Demonstrates modal (window.confirm) approval. */
export class CopyToClipboardTool implements Tool<CopyToClipboardArgs, string> {
  definition() {
    return {
      name: 'copy_to_clipboard',
      description: 'Writes the given text to the system clipboard.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to copy.' },
        },
        required: ['text'],
      },
      scope: 'write' as const,
      requiresApproval: true,
    };
  }

  async call(args: CopyToClipboardArgs, _context: ToolContext): Promise<string> {
    await navigator.clipboard.writeText(args.text);
    return `Copied ${args.text.length} character(s) to the clipboard.`;
  }
}

interface ParseIntegerArgs {
  value: string;
}

/** Parses a string as a base-10 integer. Throws when the input is not a valid integer — used to demonstrate the error status in the tool call UI. */
export class ParseIntegerTool implements Tool<ParseIntegerArgs, number> {
  definition() {
    return {
      name: 'parse_integer',
      description:
        'Parses a string as a base-10 integer and returns the number. Throws if the string is not a valid integer.',
      parameters: {
        type: 'object',
        properties: {
          value: { type: 'string', description: 'The string to parse.' },
        },
        required: ['value'],
      },
      scope: 'read' as const,
    };
  }

  async call(args: ParseIntegerArgs, _context: ToolContext): Promise<number> {
    if (!/^-?\d+$/.test(args.value)) {
      throw new Error(`'${args.value}' is not a valid integer.`);
    }
    return parseInt(args.value, 10);
  }
}
