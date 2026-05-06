// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { createAgent, createAgentTool } from '@mast-ai/core';
import type { AgentRunner, Tool, ToolContext } from '@mast-ai/core';
import type { MentionItem } from '@mast-ai/react-ui';

/** Payload attached to each `@`-mentionable doc in the demo. */
export interface DemoDoc {
  path: string;
  body: string;
}

/**
 * In-memory document set powering both the `@`-mention picker and the
 * `read_doc` tool. The picker only sends document IDs to the LLM via
 * `mentionsConfig.buildPrompt`; the agent fetches the body lazily by
 * calling `read_doc(id)`. Keeping the source of truth here means the tool
 * lookup and the picker can never go out of sync.
 */
export const demoDocs: MentionItem<DemoDoc>[] = [
  {
    id: 'doc-roadmap',
    label: 'Roadmap',
    description: 'Q2 product roadmap',
    data: {
      path: 'docs/roadmap.md',
      body: 'Q2 focus: stabilise the React UI surface and ship a packaged demo.',
    },
  },
  {
    id: 'doc-style-guide',
    label: 'Style Guide',
    description: 'Writing and code style',
    data: {
      path: 'docs/style.md',
      body: 'Prefer short sentences. Avoid em dashes; prefer commas, colons, or parentheses.',
    },
  },
  {
    id: 'doc-meeting-notes',
    label: 'Meeting Notes',
    description: 'Last week with the design team',
    data: {
      path: 'docs/meetings/2026-04-29.md',
      body: 'Decisions: ship the mention picker behind an opt-in flag; revisit theming next sprint.',
    },
  },
];

interface ReadDocArgs {
  id: string;
}

/**
 * Looks up a doc body by id from {@link demoDocs}. Used by the agent to
 * resolve `@`-mentioned references on demand instead of receiving every
 * doc body inlined into the prompt — the realistic pattern for non-trivial
 * documents.
 */
export class ReadDocTool implements Tool<ReadDocArgs, string> {
  definition() {
    return {
      name: 'read_doc',
      description:
        'Returns the contents of a referenced document by its id. Use the ids from any "The user has referenced..." preamble in the user message.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The document id, e.g. "doc-roadmap".',
          },
        },
        required: ['id'],
      },
      scope: 'read' as const,
    };
  }

  async call(args: ReadDocArgs, _context: ToolContext): Promise<string> {
    const doc = demoDocs.find((d) => d.id === args.id);
    if (!doc) throw new Error(`No document with id '${args.id}'.`);
    return JSON.stringify({
      id: doc.id,
      title: doc.label,
      path: doc.data?.path,
      body: doc.data?.body,
    });
  }
}

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

/**
 * Builds a sub-agent tool that summarises one or more demo docs by id. The
 * sub-agent runs on the provided `runner` with its own restricted allowlist
 * (`read_doc` only) so its `read_doc` calls show up as nested tool events on
 * the parent's `summarize_documents` block.
 */
export function createSummarizeDocumentsTool(runner: AgentRunner): Tool {
  const summarizerAgent = createAgent({
    name: 'DocumentSummarizer',
    instructions:
      'You summarise documents the user has referenced. ' +
      'For each document id you receive, call the read_doc tool to fetch its contents, ' +
      'then produce a single concise paragraph summarising all of them together. ' +
      'Do not assume document contents from the title alone.',
    tools: ['read_doc'],
  });

  return createAgentTool(runner, summarizerAgent, {
    name: 'summarize_documents',
    description:
      'Summarises one or more referenced documents by id. Internally fetches each ' +
      'document with read_doc and returns a concise paragraph summary.',
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'The document ids to summarise, e.g. ["doc-roadmap", "doc-style-guide"].',
        },
      },
      required: ['ids'],
    },
    scope: 'read',
    buildInput: (args) => {
      const { ids } = args as { ids: string[] };
      return `Summarise these document ids together: ${ids.join(', ')}.`;
    },
  });
}
