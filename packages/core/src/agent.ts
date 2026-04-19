import type { AgentConfig } from './types';
import { AgentError } from './error';

export function createAgent(config: AgentConfig): AgentConfig {
  if (!config.name) {
    throw new AgentError('Agent name is required');
  }
  if (!config.instructions) {
    throw new AgentError('Agent instructions are required');
  }
  return config;
}
