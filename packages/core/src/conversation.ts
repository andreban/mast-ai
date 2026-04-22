// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { AgentConfig, AgentEvent, AgentResult, Message } from './types';
import type { AgentRunner } from './runner';

/**
 * Stateful wrapper around {@link AgentRunner} that automatically accumulates
 * conversation history across multiple turns.
 *
 * Obtain an instance from {@link AgentRunner.conversation} rather than
 * constructing one directly.
 */
export class Conversation {
  /** Full conversation history, including all turns. May be trimmed via direct mutation. */
  history: Message[] = [];

  constructor(
    private readonly runner: AgentRunner,
    private readonly agent: AgentConfig
  ) {}

  private buildStream(input: string, signal?: AbortSignal) {
    const builder = this.runner.runBuilder(this.agent).history([...this.history]);
    if (signal) builder.signal(signal);
    return builder.runStream(input);
  }

  /** Runs a single turn and waits for the agent to finish, then returns the result. */
  async run(input: string, signal?: AbortSignal): Promise<AgentResult> {
    let output = '';
    for await (const event of this.buildStream(input, signal)) {
      if (event.type === 'text_delta') {
        output += event.delta;
      } else if (event.type === 'done') {
        this.history = event.history;
        output = event.output;
      }
    }
    return { output };
  }

  /** Runs a single turn and returns a stream of {@link AgentEvent} objects. History is updated once the stream is fully consumed. */
  runStream(input: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    return this._streamWithHistoryUpdate(input, signal);
  }

  private async *_streamWithHistoryUpdate(
    input: string,
    signal?: AbortSignal
  ): AsyncIterable<AgentEvent> {
    let capturedHistory: Message[] | null = null;

    const inner = this.buildStream(input, signal);

    try {
      for await (const event of inner) {
        if (event.type === 'done') {
          capturedHistory = event.history;
        }
        yield event;
      }
    } finally {
      // Only update history when the stream completes fully (done event received).
      // If dropped early, capturedHistory is null and history is unchanged.
      if (capturedHistory !== null) {
        this.history = capturedHistory;
      }
    }
  }
}
