// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { AgentConfig, AgentEvent, AgentRunner, Conversation } from '@mast-ai/core';

import { AgentProvider, useAgent } from '../context.js';
import { MessageList } from './MessageList.js';

// ---------------------------------------------------------------------------
// jsdom shims for @tanstack/react-virtual
//
// `@tanstack/virtual-core` measures the scroll element via `offsetWidth` /
// `offsetHeight` (which are 0 in jsdom) and scrolls via `Element.scrollTo`
// (which is not implemented). Without overriding both, the virtualizer treats
// the viewport as 0×0 and renders no items, and the auto-scroll-to-bottom
// effect is a silent no-op. The shims are scoped to the test suite and
// restored afterwards so they do not affect other component tests.
// ---------------------------------------------------------------------------

const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetHeight',
);
const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const originalScrollTo = HTMLElement.prototype.scrollTo;

function installVirtualizerShims() {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return 80;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return 400;
    },
  });
  HTMLElement.prototype.scrollTo = vi.fn() as unknown as HTMLElement['scrollTo'];
}

function restoreVirtualizerShims() {
  if (offsetHeightDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDescriptor);
  }
  if (offsetWidthDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor);
  }
  if (originalScrollTo) {
    HTMLElement.prototype.scrollTo = originalScrollTo;
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
  }
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeMockRunner(events: AgentEvent[]): { runner: AgentRunner; conversation: Conversation } {
  const stream = (): AsyncIterable<AgentEvent> =>
    (async function* () {
      for (const event of events) yield event;
    })();

  const conversation: Conversation = {
    history: [],
    runStream: vi.fn(() => stream()),
  } as unknown as Conversation;

  const runner = {
    conversation: vi.fn(() => conversation),
  } as unknown as AgentRunner;

  return { runner, conversation };
}

const agentConfig: AgentConfig = {
  name: 'TestAgent',
  instructions: 'A test agent.',
};

function SendButton({ text }: { text: string }) {
  const { sendMessage } = useAgent();
  return (
    <button type="button" onClick={() => sendMessage(text)}>
      send {text}
    </button>
  );
}

function renderWithProvider(runner: AgentRunner, child: ReactNode) {
  return render(
    <AgentProvider runner={runner} agent={agentConfig}>
      {child}
    </AgentProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('<MessageList>', () => {
  beforeEach(() => {
    installVirtualizerShims();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreVirtualizerShims();
  });

  it('renders user and assistant entries from context', async () => {
    const user = userEvent.setup();
    const { runner } = makeMockRunner([
      { type: 'text_delta', delta: 'hello from agent' },
      { type: 'done', output: 'hello from agent', history: [] },
    ]);

    renderWithProvider(
      runner,
      <>
        <SendButton text="hi agent" />
        <MessageList />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'send hi agent' }));

    // User entry rendered via <UserMessage>.
    expect(await screen.findByText('hi agent')).toBeDefined();
    // Assistant entry rendered via <AssistantMessage>; final text comes from `done.output`.
    expect(await screen.findByText('hello from agent')).toBeDefined();
  });

  it('exposes role="log" and aria-live="polite" for screen readers', () => {
    const { runner } = makeMockRunner([{ type: 'done', output: 'ok', history: [] }]);
    const { container } = renderWithProvider(runner, <MessageList />);

    const list = container.querySelector('[data-mast-message-list]');
    expect(list).not.toBeNull();
    expect(list!.getAttribute('role')).toBe('log');
    expect(list!.getAttribute('aria-live')).toBe('polite');
  });

  it('forwards className to the root element', () => {
    const { runner } = makeMockRunner([{ type: 'done', output: 'ok', history: [] }]);
    const { container } = renderWithProvider(runner, <MessageList className="custom-class" />);

    const list = container.querySelector('[data-mast-message-list]');
    expect(list).not.toBeNull();
    expect(list!.className).toContain('mast-message-list');
    expect(list!.className).toContain('custom-class');
  });

  it('scrolls to the bottom when a new entry is appended', async () => {
    const user = userEvent.setup();
    const { runner } = makeMockRunner([
      { type: 'text_delta', delta: 'first answer' },
      { type: 'done', output: 'first answer', history: [] },
    ]);

    const { container } = renderWithProvider(
      runner,
      <>
        <SendButton text="first" />
        <MessageList />
      </>,
    );

    const list = container.querySelector('[data-mast-message-list]') as HTMLElement;
    const scrollToSpy = list.scrollTo as ReturnType<typeof vi.fn>;
    scrollToSpy.mockClear();

    await user.click(screen.getByRole('button', { name: 'send first' }));
    await screen.findByText('first answer');

    expect(scrollToSpy).toHaveBeenCalled();
  });

  it('forwards renderToolCall to assistant entries', async () => {
    const user = userEvent.setup();
    const { runner } = makeMockRunner([
      { type: 'tool_call_started', name: 'demo_tool', args: { foo: 'bar' } },
      { type: 'tool_call_completed', name: 'demo_tool', result: 'baz' },
      { type: 'done', output: '', history: [] },
    ]);

    renderWithProvider(
      runner,
      <>
        <SendButton text="run tool" />
        <MessageList renderToolCall={(entry) => <span>tool:{entry.name}</span>} />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'send run tool' }));

    expect(await screen.findByText('tool:demo_tool')).toBeDefined();
  });
});
