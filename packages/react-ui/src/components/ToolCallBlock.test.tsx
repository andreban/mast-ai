// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import type { ToolEventEntry } from '../types.js';
import { ToolCallBlock } from './ToolCallBlock.js';

function makeEntry(overrides: Partial<ToolEventEntry> = {}): ToolEventEntry {
  return {
    type: 'tool_call_started',
    name: 'demo_tool',
    args: { foo: 'bar' },
    isStreaming: true,
    ...overrides,
  };
}

describe('<ToolCallBlock>', () => {
  afterEach(() => {
    cleanup();
  });

  describe('streaming sub-agent state', () => {
    it('renders the spinner icon while streaming', () => {
      render(<ToolCallBlock entry={makeEntry({ subThinking: '', subText: '' })} />);
      const status = screen.getByTestId('mast-tool-call-status');
      expect(status.querySelector('svg.mast-spin')).not.toBeNull();
    });

    it('renders subThinking inside an auto-expanded ThinkingBlock while streaming', () => {
      render(
        <ToolCallBlock entry={makeEntry({ subThinking: 'sub-agent reasoning', subText: '' })} />,
      );
      const summary = screen.getByText('Thinking Process');
      const details = summary.closest('details');
      expect(details).not.toBeNull();
      expect(details!.open).toBe(true);
      expect(screen.getByText('sub-agent reasoning')).toBeDefined();
    });

    it('renders subText as live content below the thinking block', () => {
      render(
        <ToolCallBlock
          entry={makeEntry({ subThinking: 'thoughts', subText: 'streaming output' })}
        />,
      );
      const subText = screen.getByTestId('mast-tool-call-sub-text');
      expect(subText.textContent).toBe('streaming output');
    });

    it('omits the result section while still streaming', () => {
      render(
        <ToolCallBlock
          entry={makeEntry({ subThinking: 'x', subText: 'y', result: 'should-not-show' })}
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
      subThinking: 'final thoughts',
      subText: 'final answer',
      isStreaming: false,
    };

    it('renders the check icon when completed', () => {
      const { container } = render(<ToolCallBlock entry={completed} />);
      const status = screen.getByTestId('mast-tool-call-status');
      expect(status.querySelector('svg')).not.toBeNull();
      expect(container.querySelector('svg.mast-spin')).toBeNull();
    });

    it('keeps subThinking visible but collapses it by default', () => {
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
      render(<ToolCallBlock entry={completed} />);

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
      render(<ToolCallBlock entry={completed} />);

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

  describe('nested tool events', () => {
    it('does not render the nested container when nestedToolEvents is undefined', () => {
      const { container } = render(<ToolCallBlock entry={makeEntry()} />);
      expect(container.querySelector('.mast-tool-call-block-nested')).toBeNull();
    });

    it('renders nested entries recursively', () => {
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
        nestedToolEvents: [nestedCompleted],
      };
      const { container } = render(<ToolCallBlock entry={parent} />);
      const nestedContainer = container.querySelector('.mast-tool-call-block-nested');
      expect(nestedContainer).not.toBeNull();
      const nestedBlocks = nestedContainer!.querySelectorAll('[data-mast-tool-call-block]');
      expect(nestedBlocks).toHaveLength(1);
      expect(nestedBlocks[0].getAttribute('data-tool-name')).toBe('inner_tool');
      expect(screen.getByText('inner_tool')).toBeDefined();
    });

    it('renders multiple nested entries in order', () => {
      const parent: ToolEventEntry = {
        id: 'parent',
        type: 'tool_call_started',
        name: 'agent_tool',
        args: {},
        isStreaming: true,
        nestedToolEvents: [
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
});
