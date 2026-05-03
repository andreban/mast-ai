// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { AgentConfig, AgentEvent, AgentRunner, Conversation } from '@mast-ai/core';

import { AgentProvider } from '../context.js';
import { ChatInput } from './ChatInput.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MockRunnerOptions {
  /** Events to emit before resolving. Default: `[done]`. */
  events?: AgentEvent[];
  /** When true the conversation never resolves until aborted, so `isRunning` stays true. */
  hang?: boolean;
}

function makeMockRunner({ events, hang }: MockRunnerOptions = {}): AgentRunner {
  const stream = (signal: AbortSignal | undefined): AsyncIterable<AgentEvent> =>
    (async function* () {
      const yielded: AgentEvent[] = events ?? [{ type: 'done', output: 'ok', history: [] }];
      for (const event of yielded) yield event;
      if (hang) {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) {
            resolve();
            return;
          }
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }
    })();

  const conversation: Conversation = {
    history: [],
    runStream: vi.fn((_text: string, signal?: AbortSignal) => stream(signal)),
  } as unknown as Conversation;

  return {
    conversation: vi.fn(() => conversation),
  } as unknown as AgentRunner;
}

const agentConfig: AgentConfig = {
  name: 'TestAgent',
  instructions: 'A test agent.',
};

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

describe('<ChatInput>', () => {
  beforeEach(() => {
    // Suppress `act` warnings emitted while a hung run is still in flight at
    // teardown — the tests for the running state intentionally leave it open.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('submits the message on Enter and clears the input', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner();
    renderWithProvider(runner, <ChatInput />);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hello world');
    await user.keyboard('{Enter}');

    const conversation = (runner.conversation as ReturnType<typeof vi.fn>).mock.results[0]
      .value as Conversation;
    expect(conversation.runStream).toHaveBeenCalledTimes(1);
    expect((conversation.runStream as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'hello world',
    );
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('does not submit on Shift+Enter and inserts a newline instead', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner();
    renderWithProvider(runner, <ChatInput />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.type(textarea, 'line one');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(textarea, 'line two');

    const conversation = (runner.conversation as ReturnType<typeof vi.fn>).mock.results[0]
      .value as Conversation;
    expect(conversation.runStream).not.toHaveBeenCalled();
    expect(textarea.value).toBe('line one\nline two');
  });

  it('does not submit when the message is empty or whitespace', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner();
    renderWithProvider(runner, <ChatInput />);

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('{Enter}');
    await user.type(textarea, '   ');
    await user.keyboard('{Enter}');

    const conversation = (runner.conversation as ReturnType<typeof vi.fn>).mock.results[0]
      .value as Conversation;
    expect(conversation.runStream).not.toHaveBeenCalled();
  });

  it('shows the send button while idle', () => {
    const runner = makeMockRunner();
    renderWithProvider(runner, <ChatInput />);

    expect(screen.getByRole('button', { name: 'Send' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('swaps to a cancel button while a run is in progress', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner({ hang: true });
    renderWithProvider(runner, <ChatInput />);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hello');
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('disables the textarea while a run is in progress', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner({ hang: true });
    renderWithProvider(runner, <ChatInput />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.type(textarea, 'hello');
    await user.keyboard('{Enter}');

    await screen.findByRole('button', { name: 'Cancel' });
    expect(textarea.disabled).toBe(true);
  });

  it('calls cancel when the cancel button is clicked', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner({ hang: true });
    renderWithProvider(runner, <ChatInput />);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hello');
    await user.keyboard('{Enter}');

    const cancelButton = await screen.findByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    // Once the run is cancelled the send button reappears.
    expect(await screen.findByRole('button', { name: 'Send' })).toBeDefined();
  });

  it('renders custom sendLabel and cancelLabel content', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner({ hang: true });
    renderWithProvider(
      runner,
      <ChatInput sendLabel={<span>SEND</span>} cancelLabel={<span>CANCEL</span>} />,
    );

    const sendButton = screen.getByRole('button', { name: 'Send' });
    expect(sendButton.textContent).toBe('SEND');

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hi');
    await user.keyboard('{Enter}');

    const cancelButton = await screen.findByRole('button', { name: 'Cancel' });
    expect(cancelButton.textContent).toBe('CANCEL');
  });

  it('uses the supplied placeholder', () => {
    const runner = makeMockRunner();
    renderWithProvider(runner, <ChatInput placeholder="Ask the agent" />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).placeholder).toBe('Ask the agent');
  });

  it('forwards className to the root element', () => {
    const runner = makeMockRunner();
    const { container } = renderWithProvider(runner, <ChatInput className="custom-class" />);
    const root = container.querySelector('[data-mast-chat-input]');
    expect(root).not.toBeNull();
    expect(root!.className).toContain('mast-chat-input');
    expect(root!.className).toContain('custom-class');
  });

  it('disables the textarea and Send button when the provider has runner={null}', () => {
    render(
      <AgentProvider runner={null} agent={agentConfig}>
        <ChatInput />
      </AgentProvider>,
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);

    const sendButton = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
  });
});
