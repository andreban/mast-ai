// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { AgentConfig } from './types';
import { AgentError } from './error';

/**
 * Validates and returns an {@link AgentConfig}.
 *
 * Throws {@link AgentError} if `name` or `instructions` are missing.
 * The return value is the same object passed in — use it as a typed
 * constant so TypeScript can narrow the config at call sites.
 */
export function createAgent(config: AgentConfig): AgentConfig {
  if (!config.name) {
    throw new AgentError('Agent name is required');
  }
  if (!config.instructions) {
    throw new AgentError('Agent instructions are required');
  }
  return config;
}
