// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

/** Thrown by the agent runner for logical errors such as missing tools or aborted runs. */
export class AgentError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

/** Thrown by an {@link LlmAdapter} or {@link UrpTransport} when a backend request fails. */
export class AdapterError extends Error {
  constructor(
    message: string,
    /** HTTP status code, when applicable. */
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}
