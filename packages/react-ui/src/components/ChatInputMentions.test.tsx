// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { AgentConfig, AgentEvent, AgentRunner, Conversation } from '@mast-ai/core';

import { AgentProvider, useAgent } from '../context';
import { ChatInput } from './ChatInput';
import type { MentionItem, MentionsConfig } from '../mentions/types';

/** Inline spy that surfaces user-bubble text to the DOM for assertions. */
function MessagesSpy() {
  const { messages } = useAgent();
  return (
    <ul data-testid="messages-spy">
      {messages.map((m) => (
        <li key={m.id} data-role={m.role}>
          {m.text}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MockRunnerOptions {
  events?: AgentEvent[];
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

interface DocPayload {
  path: string;
}

const items: MentionItem<DocPayload>[] = [
  { id: '1', label: 'README', data: { path: 'README.md' } },
  { id: '2', label: 'CHANGELOG', data: { path: 'CHANGELOG.md' } },
];

describe('<ChatInput mentions>', () => {
  beforeEach(() => {
    // Some tests intentionally leave the runner hanging; suppress act warnings.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the picker when the user types `@`', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner();
    renderWithProvider(runner, <ChatInput mentions={{ items }} />);

    const textarea = screen.getByRole('combobox');
    await user.type(textarea, 'hello @');

    const listbox = screen.getByRole('listbox', { name: 'Mention picker' });
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain('README');
    expect(options[1].textContent).toContain('CHANGELOG');
  });

  it('selects a chip on Enter and renders the chip in the compound input', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner();
    const { container } = renderWithProvider(runner, <ChatInput mentions={{ items }} />);

    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    await user.type(textarea, 'hi @');
    // Picker is open with all items; press Enter to select the active row.
    await user.keyboard('{Enter}');

    const chip = container.querySelector('.mast-mention-chip');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('@README');
    expect(textarea.value).toBe('');
    // After selecting, the picker is closed.
    expect(screen.queryByRole('listbox', { name: 'Mention picker' })).toBeNull();
  });

  it('navigates the picker with ArrowDown / ArrowUp and exposes aria-activedescendant', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner();
    renderWithProvider(runner, <ChatInput mentions={{ items }} />);

    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    await user.type(textarea, '@');

    const listbox = screen.getByRole('listbox', { name: 'Mention picker' });
    const options = within(listbox).getAllByRole('option');
    expect(textarea.getAttribute('aria-activedescendant')).toBe(options[0].id);

    await user.keyboard('{ArrowDown}');
    expect(textarea.getAttribute('aria-activedescendant')).toBe(options[1].id);
    expect(options[1].getAttribute('aria-selected')).toBe('true');
  });

  it('Escape closes the picker without selecting', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner();
    const { container } = renderWithProvider(runner, <ChatInput mentions={{ items }} />);

    const textarea = screen.getByRole('combobox');
    await user.type(textarea, '@');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox', { name: 'Mention picker' })).toBeNull();
    expect(container.querySelectorAll('.mast-mention-chip')).toHaveLength(0);
  });

  it('removeChip merges the segment text into the trailing input', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner();
    const { container } = renderWithProvider(runner, <ChatInput mentions={{ items }} />);

    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    await user.type(textarea, 'hello @');
    await user.keyboard('{Enter}');
    await user.type(textarea, ' world');

    const removeButton = screen.getByRole('button', { name: 'Remove reference to README' });
    await user.click(removeButton);

    expect(container.querySelectorAll('.mast-mention-chip')).toHaveLength(0);
    // Segment text "hello " plus trailing input " world" → "hello  world"
    // (the user's input verbatim, minus the chip).
    expect(textarea.value).toBe('hello  world');
  });

  it('submits with sendMessage(prompt, displayText) using buildPrompt when supplied', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner();
    const buildPrompt: NonNullable<MentionsConfig<DocPayload>['buildPrompt']> = (
      segments,
      trailing,
    ) =>
      `Refs: ${segments.map((s) => `${s.item.label}#${s.item.id}`).join(', ')}\n\n` +
      segments.map((s) => `${s.text}@${s.item.label}`).join('') +
      trailing;

    renderWithProvider(
      runner,
      <>
        <MessagesSpy />
        <ChatInput mentions={{ items, buildPrompt } as MentionsConfig} />
      </>,
    );

    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
    await user.type(textarea, 'hi @');
    await user.keyboard('{Enter}');
    await user.type(textarea, ' there');
    await user.keyboard('{Enter}');

    const conversation = (runner.conversation as ReturnType<typeof vi.fn>).mock.results[0]
      .value as Conversation;
    expect(conversation.runStream).toHaveBeenCalledTimes(1);
    const promptArg = (conversation.runStream as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(promptArg).toBe('Refs: README#1\n\nhi @README there');

    // The user bubble shows the inline displayText, not the augmented prompt.
    const userBubble = await screen.findByText('hi @README there');
    expect(userBubble.getAttribute('data-role')).toBe('user');
    // The chip+textarea cleared after submit.
    expect(textarea.value).toBe('');
  });

  it('falls back to the inline form for both prompt and displayText when buildPrompt is omitted', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner();
    renderWithProvider(runner, <ChatInput mentions={{ items }} />);

    const textarea = screen.getByRole('combobox');
    await user.type(textarea, 'check @');
    await user.keyboard('{Enter}');
    await user.type(textarea, '!');
    await user.keyboard('{Enter}');

    const conversation = (runner.conversation as ReturnType<typeof vi.fn>).mock.results[0]
      .value as Conversation;
    expect((conversation.runStream as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'check @README!',
    );
  });

  it('keeps the plain textarea behaviour when `mentions` is omitted', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner();
    renderWithProvider(runner, <ChatInput />);

    // Without `mentions`, the input is a plain textarea — no combobox role.
    expect(screen.queryByRole('combobox')).toBeNull();
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'plain @text and Enter');
    await user.keyboard('{Enter}');

    const conversation = (runner.conversation as ReturnType<typeof vi.fn>).mock.results[0]
      .value as Conversation;
    expect(conversation.runStream).toHaveBeenCalledTimes(1);
    expect((conversation.runStream as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'plain @text and Enter',
    );
  });

  it('does not submit on Enter while the picker is open with no matches', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner();
    renderWithProvider(runner, <ChatInput mentions={{ items }} />);

    const textarea = screen.getByRole('combobox');
    // `@nope` has no matches, so the picker hides — but Enter still submits
    // because the picker isn't consuming keys when filteredItems is empty.
    await user.type(textarea, 'hi @');
    // Open with matches, press Enter to commit a chip.
    await user.keyboard('{Enter}');
    // Now type @nope which produces no matches.
    await user.type(textarea, ' more @nope');
    await user.keyboard('{Enter}');

    const conversation = (runner.conversation as ReturnType<typeof vi.fn>).mock.results[0]
      .value as Conversation;
    expect(conversation.runStream).toHaveBeenCalledTimes(1);
    expect((conversation.runStream as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'hi @README more @nope',
    );
  });

  it('renders the chip via a custom renderChip when supplied', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner();
    const renderChip: NonNullable<MentionsConfig<DocPayload>['renderChip']> = (item, onRemove) => (
      <span data-testid="custom-chip">
        custom:{item.label}
        <button type="button" onClick={onRemove} aria-label={`Drop ${item.label}`}>
          drop
        </button>
      </span>
    );

    renderWithProvider(runner, <ChatInput mentions={{ items, renderChip } as MentionsConfig} />);

    const textarea = screen.getByRole('combobox');
    await user.type(textarea, '@');
    await user.keyboard('{Enter}');

    const chip = screen.getByTestId('custom-chip');
    expect(chip.textContent).toContain('custom:README');
    expect(screen.getByRole('button', { name: 'Drop README' })).toBeDefined();
  });

  it('renders picker rows via a custom renderItem when supplied', async () => {
    const user = userEvent.setup();
    const runner = makeMockRunner();
    const renderItem: NonNullable<MentionsConfig<DocPayload>['renderItem']> = (item, isActive) => (
      <span data-testid={`custom-item-${item.id}`} data-active={isActive ? 'true' : 'false'}>
        {item.label}/{item.data?.path}
      </span>
    );

    renderWithProvider(runner, <ChatInput mentions={{ items, renderItem } as MentionsConfig} />);

    const textarea = screen.getByRole('combobox');
    await user.type(textarea, '@');

    const customRow = screen.getByTestId('custom-item-1');
    expect(customRow.textContent).toBe('README/README.md');
    expect(customRow.getAttribute('data-active')).toBe('true');
  });
});
