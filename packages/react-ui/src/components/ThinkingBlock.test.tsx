// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { ThinkingBlock } from './ThinkingBlock';

describe('<ThinkingBlock>', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders collapsed by default', () => {
    render(<ThinkingBlock content="Some reasoning trace" />);
    const details = screen.getByText('Thinking Process').closest('details');
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
  });

  it('uses the default "Thinking Process" label when none is supplied', () => {
    render(<ThinkingBlock content="x" />);
    expect(screen.getByText('Thinking Process')).toBeDefined();
  });

  it('honours a custom label', () => {
    render(<ThinkingBlock content="x" label="Reasoning" />);
    expect(screen.getByText('Reasoning')).toBeDefined();
  });

  it('expands when the summary is clicked', async () => {
    const user = userEvent.setup();
    render(<ThinkingBlock content="hidden until expanded" />);

    const summary = screen.getByText('Thinking Process');
    const details = summary.closest('details');
    expect(details!.open).toBe(false);

    await user.click(summary);
    expect(details!.open).toBe(true);
  });

  it('renders the pulsing indicator while streaming', () => {
    render(<ThinkingBlock content="" isStreaming />);
    expect(screen.queryByTestId('mast-thinking-pulse')).not.toBeNull();
  });

  it('omits the pulsing indicator when not streaming', () => {
    render(<ThinkingBlock content="done" isStreaming={false} />);
    expect(screen.queryByTestId('mast-thinking-pulse')).toBeNull();
  });

  it('omits the pulsing indicator when isStreaming is unspecified', () => {
    render(<ThinkingBlock content="done" />);
    expect(screen.queryByTestId('mast-thinking-pulse')).toBeNull();
  });

  it('renders the bundled brain icon by default', () => {
    const { container } = render(<ThinkingBlock content="x" />);
    expect(container.querySelector('summary svg')).not.toBeNull();
  });

  it('forwards className to the root element', () => {
    render(<ThinkingBlock content="x" className="custom-class" />);
    const details = screen.getByText('Thinking Process').closest('details');
    expect(details!.className).toContain('custom-class');
    expect(details!.className).toContain('mast-thinking-block');
  });

  it('renders the content inside the details element', () => {
    render(<ThinkingBlock content="step-by-step thoughts" />);
    expect(screen.getByText('step-by-step thoughts')).toBeDefined();
  });
});
