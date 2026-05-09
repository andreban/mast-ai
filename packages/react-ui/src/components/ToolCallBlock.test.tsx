// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ThinkingEntry, ToolEventEntry } from '../types.js';
import { ToolCallBlock } from './ToolCallBlock.js';
import { NestedToolRenderContext, ToolLabelContext } from './ToolLabelContext.js';

function makeEntry(overrides: Partial<ToolEventEntry> = {}): ToolEventEntry {
  return {
    type: 'tool_call_started',
    name: 'demo_tool',
    args: { foo: 'bar' },
    isStreaming: true,
    ...overrides,
  };
}

function thinkingBlock(content: string, id = 'think'): ThinkingEntry {
  return { id, type: 'thinking', content };
}

describe('<ToolCallBlock>', () => {
  afterEach(() => {
    cleanup();
  });

  describe('streaming sub-agent state', () => {
    it('renders the spinner icon while streaming', () => {
      render(<ToolCallBlock entry={makeEntry({ nestedContentBlocks: [], subText: '' })} />);
      const status = screen.getByTestId('mast-tool-call-status');
      expect(status.querySelector('svg.mast-spin')).not.toBeNull();
    });

    it('renders a sub-agent thinking block from nestedContentBlocks expanded while streaming', () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            nestedContentBlocks: [thinkingBlock('sub-agent reasoning')],
            subText: '',
          })}
        />,
      );
      const summary = screen.getByText('Thinking Process');
      const details = summary.closest('details');
      expect(details).not.toBeNull();
      expect(details!.open).toBe(true);
      expect(screen.getByText('sub-agent reasoning')).toBeDefined();
    });

    it('renders subText as live content below the nested content', () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            nestedContentBlocks: [thinkingBlock('thoughts')],
            subText: 'streaming output',
          })}
        />,
      );
      const subText = screen.getByTestId('mast-tool-call-sub-text');
      expect(subText.textContent).toBe('streaming output');
    });

    it('omits the result section while still streaming', () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            nestedContentBlocks: [thinkingBlock('x')],
            subText: 'y',
            result: 'should-not-show',
          })}
        />,
      );
      expect(screen.queryByText('Result')).toBeNull();
    });
  });

  describe('completed sub-agent state', () => {
    const completed: ToolEventEntry = {
      type: 'tool_call_completed',
      name: 'demo_tool',
      args: { foo: 'bar' },
      result: { ok: true, value: 42 },
      nestedContentBlocks: [thinkingBlock('final thoughts')],
      subText: 'final answer',
      isStreaming: false,
    };

    it('renders the check icon when completed', () => {
      const { container } = render(<ToolCallBlock entry={completed} />);
      const status = screen.getByTestId('mast-tool-call-status');
      expect(status.querySelector('svg')).not.toBeNull();
      expect(container.querySelector('svg.mast-spin')).toBeNull();
    });

    it('keeps nested thinking visible but collapses it by default once completed', () => {
      render(<ToolCallBlock entry={completed} />);
      const details = screen.getByText('Thinking Process').closest('details');
      expect(details).not.toBeNull();
      expect(details!.open).toBe(false);
      expect(screen.getByText('final thoughts')).toBeDefined();
    });

    it('keeps subText visible after completion', () => {
      render(<ToolCallBlock entry={completed} />);
      expect(screen.getByTestId('mast-tool-call-sub-text').textContent).toBe('final answer');
    });

    it('exposes the result in a collapsible <details> as formatted JSON', async () => {
      const user = userEvent.setup();
      render(<ToolCallBlock entry={completed} defaultOpen />);

      const summary = screen.getByText('Result');
      const details = summary.closest('details');
      expect(details).not.toBeNull();
      expect(details!.open).toBe(false);

      await user.click(summary);
      expect(details!.open).toBe(true);

      const code = details!.querySelector('code');
      expect(code).not.toBeNull();
      expect(code!.textContent).toContain('"ok": true');
      expect(code!.textContent).toContain('"value": 42');
    });
  });

  describe('plain tool (no sub-agent output)', () => {
    it('shows a spinner while streaming and no sub-agent slots', () => {
      render(<ToolCallBlock entry={makeEntry()} />);
      const status = screen.getByTestId('mast-tool-call-status');
      expect(status.querySelector('svg.mast-spin')).not.toBeNull();
      expect(screen.queryByText('Thinking Process')).toBeNull();
      expect(screen.queryByTestId('mast-tool-call-sub-text')).toBeNull();
      expect(screen.queryByTestId('mast-tool-call-nested')).toBeNull();
    });

    it('shows the check icon when completed and no sub-agent slots', () => {
      const completed: ToolEventEntry = {
        type: 'tool_call_completed',
        name: 'demo_tool',
        args: { foo: 'bar' },
        result: 'plain result',
        isStreaming: false,
      };
      const { container } = render(<ToolCallBlock entry={completed} />);
      const status = screen.getByTestId('mast-tool-call-status');
      expect(status.querySelector('svg')).not.toBeNull();
      expect(container.querySelector('svg.mast-spin')).toBeNull();
      expect(screen.queryByText('Thinking Process')).toBeNull();
      expect(screen.queryByTestId('mast-tool-call-sub-text')).toBeNull();
    });

    it('still renders args and (after completion) result in <details>', async () => {
      const user = userEvent.setup();
      const completed: ToolEventEntry = {
        type: 'tool_call_completed',
        name: 'demo_tool',
        args: { city: 'NYC' },
        result: 'sunny',
        isStreaming: false,
      };
      render(<ToolCallBlock entry={completed} defaultOpen />);

      const argsSummary = screen.getByText('Arguments');
      await user.click(argsSummary);
      const argsDetails = argsSummary.closest('details');
      expect(argsDetails!.open).toBe(true);
      expect(argsDetails!.querySelector('code')!.textContent).toContain('"city": "NYC"');

      const resultSummary = screen.getByText('Result');
      await user.click(resultSummary);
      const resultDetails = resultSummary.closest('details');
      expect(resultDetails!.open).toBe(true);
      expect(resultDetails!.querySelector('code')!.textContent).toContain('sunny');
    });
  });

  describe('nested content blocks', () => {
    it('does not render the nested container when nestedContentBlocks is undefined', () => {
      const { container } = render(<ToolCallBlock entry={makeEntry()} />);
      expect(container.querySelector('.mast-tool-call-block-nested')).toBeNull();
    });

    it('renders nested tool entries recursively', () => {
      const nestedCompleted: ToolEventEntry = {
        id: 'nested-1',
        type: 'tool_call_completed',
        name: 'inner_tool',
        args: { q: 1 },
        result: 'inner_result',
        isStreaming: false,
        status: 'success',
      };
      const parent: ToolEventEntry = {
        id: 'parent-1',
        type: 'tool_call_completed',
        name: 'agent_tool',
        args: {},
        result: 'outer_result',
        isStreaming: false,
        status: 'success',
        nestedContentBlocks: [nestedCompleted],
      };
      const { container } = render(<ToolCallBlock entry={parent} />);
      const nestedContainer = container.querySelector('.mast-tool-call-block-nested');
      expect(nestedContainer).not.toBeNull();
      const nestedBlocks = nestedContainer!.querySelectorAll('[data-mast-tool-call-block]');
      expect(nestedBlocks).toHaveLength(1);
      expect(nestedBlocks[0].getAttribute('data-tool-name')).toBe('inner_tool');
      expect(screen.getByText('inner_tool')).toBeDefined();
    });

    it('interleaves thinking blocks and tool entries in source order', () => {
      const parent: ToolEventEntry = {
        id: 'parent',
        type: 'tool_call_completed',
        name: 'agent_tool',
        args: {},
        result: 'outer',
        isStreaming: false,
        status: 'success',
        nestedContentBlocks: [
          thinkingBlock('first thought', 't1'),
          {
            id: 'nested-a',
            type: 'tool_call_completed',
            name: 'inner_a',
            args: {},
            result: 'a',
            isStreaming: false,
            status: 'success',
          },
          thinkingBlock('second thought', 't2'),
          {
            id: 'nested-b',
            type: 'tool_call_completed',
            name: 'inner_b',
            args: {},
            result: 'b',
            isStreaming: false,
            status: 'success',
          },
        ],
      };
      const { container } = render(<ToolCallBlock entry={parent} defaultOpen />);
      const nestedContainer = container.querySelector('.mast-tool-call-block-nested')!;
      // Each child element is one rendered block — assert sequence by class.
      const sequence = Array.from(nestedContainer.children).map((el) => {
        if (el.classList.contains('mast-tool-call-block-sub-thinking')) return 'thinking';
        if (el.matches('[data-mast-tool-call-block]')) {
          return `tool:${el.getAttribute('data-tool-name')}`;
        }
        return el.tagName.toLowerCase();
      });
      expect(sequence).toEqual(['thinking', 'tool:inner_a', 'thinking', 'tool:inner_b']);
    });

    it('only marks the trailing thinking block as streaming while the parent is in flight', () => {
      const parent: ToolEventEntry = {
        id: 'parent',
        type: 'tool_call_started',
        name: 'agent_tool',
        args: {},
        isStreaming: true,
        nestedContentBlocks: [
          thinkingBlock('first', 't1'),
          {
            id: 'nested-a',
            type: 'tool_call_completed',
            name: 'inner_a',
            args: {},
            result: 'a',
            isStreaming: false,
            status: 'success',
          },
          thinkingBlock('second', 't2'),
        ],
      };
      const { container } = render(<ToolCallBlock entry={parent} defaultOpen />);
      const thinkingDetails = Array.from(
        container.querySelectorAll('details.mast-tool-call-block-sub-thinking'),
      );
      expect(thinkingDetails).toHaveLength(2);
      expect((thinkingDetails[0] as HTMLDetailsElement).open).toBe(false);
      expect((thinkingDetails[1] as HTMLDetailsElement).open).toBe(true);
    });

    it('forwards the ToolLabelContext resolver to nested entries', () => {
      const parent: ToolEventEntry = {
        id: 'parent',
        type: 'tool_call_started',
        name: 'invoke_writer',
        args: {},
        isStreaming: true,
        nestedContentBlocks: [
          {
            id: 'nested-1',
            type: 'tool_call_completed',
            name: 'delegate_to_skill',
            args: { skillName: 'Proofreader' },
            result: 'done',
            isStreaming: false,
            status: 'success',
          },
        ],
      };
      render(
        <ToolLabelContext.Provider
          value={(entry) => {
            if (entry.name === 'delegate_to_skill') {
              const args = entry.args as { skillName?: string } | undefined;
              return args?.skillName;
            }
            return undefined;
          }}
        >
          <ToolCallBlock entry={parent} />
        </ToolLabelContext.Provider>,
      );
      // Parent uses entry.name (resolver returns undefined for it).
      expect(screen.getByText('invoke_writer')).toBeDefined();
      // Nested entry uses the resolver's value.
      expect(screen.getByText('Proofreader')).toBeDefined();
      expect(screen.queryByText('delegate_to_skill')).toBeNull();
    });

    it('routes nested tool entries through NestedToolRenderContext when one is provided', () => {
      const renderNested = vi.fn((entry: ToolEventEntry) => (
        <span data-testid={`custom-${entry.name}`}>{entry.name}</span>
      ));
      const nestedTool: ToolEventEntry = {
        id: 'nested-a',
        type: 'tool_call_started',
        name: 'inner_a',
        args: {},
        isStreaming: true,
      };
      const parent: ToolEventEntry = {
        id: 'parent',
        type: 'tool_call_started',
        name: 'agent_tool',
        args: {},
        isStreaming: true,
        nestedContentBlocks: [nestedTool],
      };
      render(
        <NestedToolRenderContext.Provider value={renderNested}>
          <ToolCallBlock entry={parent} />
        </NestedToolRenderContext.Provider>,
      );
      expect(screen.getByTestId('custom-inner_a').textContent).toBe('inner_a');
      // The bare recursive ToolCallBlock should NOT have rendered for the
      // nested entry — only the top-level parent block exists.
      expect(screen.queryAllByTestId('mast-tool-call-status')).toHaveLength(1);
      expect(renderNested).toHaveBeenCalledWith(nestedTool);
    });

    it('falls back to bare recursive ToolCallBlock when no NestedToolRenderContext is provided', () => {
      const parent: ToolEventEntry = {
        id: 'parent',
        type: 'tool_call_started',
        name: 'agent_tool',
        args: {},
        isStreaming: true,
        nestedContentBlocks: [
          {
            id: 'nested-a',
            type: 'tool_call_completed',
            name: 'inner_a',
            args: {},
            result: 'a',
            isStreaming: false,
            status: 'success',
          },
        ],
      };
      const { container } = render(<ToolCallBlock entry={parent} />);
      const nestedBlocks = container.querySelectorAll(
        '.mast-tool-call-block-nested [data-mast-tool-call-block]',
      );
      expect(nestedBlocks).toHaveLength(1);
      expect(nestedBlocks[0].getAttribute('data-tool-name')).toBe('inner_a');
    });

    it('renders multiple nested tool entries in order', () => {
      const parent: ToolEventEntry = {
        id: 'parent',
        type: 'tool_call_started',
        name: 'agent_tool',
        args: {},
        isStreaming: true,
        nestedContentBlocks: [
          {
            id: 'nested-a',
            type: 'tool_call_completed',
            name: 'inner_a',
            args: {},
            result: 'a',
            isStreaming: false,
            status: 'success',
          },
          {
            id: 'nested-b',
            type: 'tool_call_started',
            name: 'inner_b',
            args: {},
            isStreaming: true,
          },
        ],
      };
      const { container } = render(<ToolCallBlock entry={parent} />);
      const nested = container.querySelectorAll(
        '.mast-tool-call-block-nested [data-mast-tool-call-block]',
      );
      const names = Array.from(nested).map((el) => el.getAttribute('data-tool-name'));
      expect(names).toEqual(['inner_a', 'inner_b']);
    });
  });

  describe('header content', () => {
    it('renders the tool name', () => {
      render(<ToolCallBlock entry={makeEntry({ name: 'get_current_time' })} />);
      expect(screen.getByText('get_current_time')).toBeDefined();
    });

    it('renders the label prop in place of entry.name when provided', () => {
      render(
        <ToolCallBlock entry={makeEntry({ name: 'delegate_to_skill' })} label="Proofreader" />,
      );
      expect(screen.getByText('Proofreader')).toBeDefined();
      expect(screen.queryByText('delegate_to_skill')).toBeNull();
    });

    it('accepts a ReactNode label, not just a string', () => {
      render(
        <ToolCallBlock
          entry={makeEntry({ name: 'delegate_to_skill' })}
          label={<em data-testid="custom-label">Proofreader</em>}
        />,
      );
      expect(screen.getByTestId('custom-label').textContent).toBe('Proofreader');
    });

    it('falls back to entry.name when label is omitted', () => {
      render(<ToolCallBlock entry={makeEntry({ name: 'plain_tool' })} />);
      expect(screen.getByText('plain_tool')).toBeDefined();
    });

    it('reads the label from ToolLabelContext when no label prop is set', () => {
      render(
        <ToolLabelContext.Provider
          value={(entry) => (entry.name === 'delegate_to_skill' ? 'Proofreader' : undefined)}
        >
          <ToolCallBlock entry={makeEntry({ name: 'delegate_to_skill' })} />
        </ToolLabelContext.Provider>,
      );
      expect(screen.getByText('Proofreader')).toBeDefined();
      expect(screen.queryByText('delegate_to_skill')).toBeNull();
    });

    it('falls back to entry.name when the context resolver returns undefined', () => {
      render(
        <ToolLabelContext.Provider value={() => undefined}>
          <ToolCallBlock entry={makeEntry({ name: 'plain_tool' })} />
        </ToolLabelContext.Provider>,
      );
      expect(screen.getByText('plain_tool')).toBeDefined();
    });

    it('falls back to entry.name when the context resolver returns null', () => {
      render(
        <ToolLabelContext.Provider value={() => null}>
          <ToolCallBlock entry={makeEntry({ name: 'plain_tool' })} />
        </ToolLabelContext.Provider>,
      );
      expect(screen.getByText('plain_tool')).toBeDefined();
    });

    it('prefers the explicit label prop over the context resolver', () => {
      render(
        <ToolLabelContext.Provider value={() => 'from-context'}>
          <ToolCallBlock entry={makeEntry({ name: 'tool' })} label="from-prop" />
        </ToolLabelContext.Provider>,
      );
      expect(screen.getByText('from-prop')).toBeDefined();
      expect(screen.queryByText('from-context')).toBeNull();
    });

    it('forwards className to the root element', () => {
      const { container } = render(<ToolCallBlock entry={makeEntry()} className="custom-class" />);
      const root = container.querySelector('[data-mast-tool-call-block]');
      expect(root).not.toBeNull();
      expect(root!.className).toContain('custom-class');
      expect(root!.className).toContain('mast-tool-call-block');
    });

    it('exposes data-streaming on the root while streaming', () => {
      const { container } = render(<ToolCallBlock entry={makeEntry()} />);
      const root = container.querySelector('[data-mast-tool-call-block]');
      expect(root!.getAttribute('data-streaming')).toBe('true');
    });

    it('omits data-streaming when not streaming', () => {
      const completed: ToolEventEntry = {
        type: 'tool_call_completed',
        name: 'demo_tool',
        args: {},
        result: 'ok',
        isStreaming: false,
      };
      const { container } = render(<ToolCallBlock entry={completed} />);
      const root = container.querySelector('[data-mast-tool-call-block]');
      expect(root!.getAttribute('data-streaming')).toBeNull();
    });
  });

  describe('collapsible body', () => {
    const completed: ToolEventEntry = {
      type: 'tool_call_completed',
      name: 'demo_tool',
      args: { foo: 'bar' },
      result: 'ok',
      isStreaming: false,
    };

    it('renders the root as a <details> with the header inside a <summary>', () => {
      const { container } = render(<ToolCallBlock entry={makeEntry()} />);
      const root = container.querySelector('[data-mast-tool-call-block]');
      expect(root).not.toBeNull();
      expect(root!.tagName).toBe('DETAILS');
      const header = root!.querySelector('.mast-tool-call-block-header');
      expect(header).not.toBeNull();
      expect(header!.tagName).toBe('SUMMARY');
    });

    it('auto-expands the body while streaming (default defaultOpen="streaming")', () => {
      const { container } = render(<ToolCallBlock entry={makeEntry()} />);
      const root = container.querySelector('[data-mast-tool-call-block]') as HTMLDetailsElement;
      expect(root.open).toBe(true);
    });

    it('collapses the body when streaming completes (default defaultOpen="streaming")', () => {
      const { container } = render(<ToolCallBlock entry={completed} />);
      const root = container.querySelector('[data-mast-tool-call-block]') as HTMLDetailsElement;
      expect(root.open).toBe(false);
    });

    it('keeps the body open when defaultOpen is true, even after completion', () => {
      const { container } = render(<ToolCallBlock entry={completed} defaultOpen />);
      const root = container.querySelector('[data-mast-tool-call-block]') as HTMLDetailsElement;
      expect(root.open).toBe(true);
    });

    it('keeps the body collapsed when defaultOpen is false, even while streaming', () => {
      const { container } = render(<ToolCallBlock entry={makeEntry()} defaultOpen={false} />);
      const root = container.querySelector('[data-mast-tool-call-block]') as HTMLDetailsElement;
      expect(root.open).toBe(false);
    });

    it('toggles open when the user clicks the header', async () => {
      const user = userEvent.setup();
      const { container } = render(<ToolCallBlock entry={completed} />);
      const root = container.querySelector('[data-mast-tool-call-block]') as HTMLDetailsElement;
      expect(root.open).toBe(false);

      const header = root.querySelector('.mast-tool-call-block-header') as HTMLElement;
      await user.click(header);
      expect(root.open).toBe(true);
    });

    it('wraps body content in a .mast-tool-call-block-body container', () => {
      const { container } = render(<ToolCallBlock entry={completed} defaultOpen />);
      const body = container.querySelector('.mast-tool-call-block-body');
      expect(body).not.toBeNull();
      expect(body!.querySelector('.mast-tool-call-block-args')).not.toBeNull();
      expect(body!.querySelector('.mast-tool-call-block-result')).not.toBeNull();
    });
  });
});
