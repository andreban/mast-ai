import type { Message, ToolCall } from '../types';
import type { ToolDefinition } from '../tool';

export interface ModelConfig {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  [key: string]: unknown;   // pass-through for provider-specific fields
}

export interface AdapterRequest {
  messages: Message[];
  system?: string;
  tools: ToolDefinition[];
  outputSchema?: Record<string, unknown>;  // JSON Schema
  config?: ModelConfig;
}

export interface AdapterResponse {
  text?: string;            // undefined when tool calls were issued
  toolCalls: ToolCall[];    // empty on a final text response
}

export interface AdapterStreamChunk {
  type: 'text_delta' | 'tool_call' | 'thinking';
  delta?: string;           // present when type === 'text_delta' or 'thinking'
  toolCall?: ToolCall;      // present when type === 'tool_call'
}

export interface LlmAdapter {
  generate(request: AdapterRequest): Promise<AdapterResponse>;
  generateStream?(request: AdapterRequest): AsyncIterable<AdapterStreamChunk>;
}
