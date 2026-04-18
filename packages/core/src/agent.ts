import type { AgentConfig } from './types';

/**
 * Validates and creates an agent configuration.
 * Currently a simple passthrough that ensures the config matches the interface.
 * Can be expanded with more rigorous validation (e.g., Zod or JSON Schema) in the future.
 */
export function createAgent(config: AgentConfig): AgentConfig {
  if (!config.name) {
    throw new Error('Agent name is required');
  }
  if (!config.instructions) {
    throw new Error('Agent instructions are required');
  }
  return config;
}
