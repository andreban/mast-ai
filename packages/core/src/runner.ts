import type { AgentConfig, AgentEvent, AgentResult, Message, ToolCall } from './types';
import type { LlmAdapter, AdapterRequest } from './adapter/index';
import { ToolRegistry } from './tool';
import { AgentError } from './error';

export class RunBuilder {
  private _history: Message[] = [];
  private _signal?: AbortSignal;

  constructor(
    private readonly runner: AgentRunner,
    private readonly agent: AgentConfig
  ) {}

  /** Prepend prior conversation turns. */
  history(messages: Message[]): this {
    this._history = [...messages];
    return this;
  }

  /** Attach an AbortSignal to cancel the run and any in-flight tool calls. */
  signal(signal: AbortSignal): this {
    this._signal = signal;
    return this;
  }

  runStream(input: string): AsyncIterable<AgentEvent> {
    return this.runner._executeStream(this.agent, input, this._history, this._signal);
  }

  async run(input: string): Promise<AgentResult> {
    let output = '';
    for await (const event of this.runStream(input)) {
      if (event.type === 'text_delta') {
        output += event.delta;
      }
    }
    return { output };
  }

  async runTyped<T>(input: string): Promise<T> {
    const result = await this.run(input);
    try {
      return JSON.parse(result.output) as T;
    } catch (err) {
      throw new AgentError('Failed to parse structured output', err);
    }
  }
}

export class AgentRunner {
  constructor(
    public readonly adapter: LlmAdapter,
    public readonly registry: ToolRegistry = new ToolRegistry()
  ) {}

  /** Primary entry point for multi-turn use. */
  runBuilder(agent: AgentConfig): RunBuilder {
    return new RunBuilder(this, agent);
  }

  /** Single-turn convenience methods (delegate to runBuilder). */
  runStream(agent: AgentConfig, input: string): AsyncIterable<AgentEvent> {
    return this.runBuilder(agent).runStream(input);
  }

  run(agent: AgentConfig, input: string): Promise<AgentResult> {
    return this.runBuilder(agent).run(input);
  }

  runTyped<T>(agent: AgentConfig, input: string): Promise<T> {
    return this.runBuilder(agent).runTyped<T>(input);
  }

  /** @internal */
  async *_executeStream(
    agent: AgentConfig,
    input: string,
    history: Message[],
    signal?: AbortSignal
  ): AsyncIterable<AgentEvent> {
    // 1. Validate that all names in agent.tools exist in the registry.
    const tools = agent.tools || [];
    const toolDefinitions = [];
    for (const toolName of tools) {
      const tool = this.registry.get(toolName);
      if (!tool) {
        throw new AgentError(`Tool '${toolName}' requested by agent '${agent.name}' is not registered.`);
      }
      toolDefinitions.push(tool.definition());
    }

    // Clone history and add new user message
    const currentHistory: Message[] = [
      ...history,
      { role: 'user', content: { type: 'text', text: input } }
    ];

    while (true) {
      if (signal?.aborted) {
        throw new AgentError('Run aborted', signal.reason);
      }

      // 2. Construct an AdapterRequest
      const request: AdapterRequest = {
        system: agent.instructions,
        messages: currentHistory,
        tools: toolDefinitions,
        outputSchema: agent.outputSchema,
      };

      let finalOutput = '';
      const toolCalls: ToolCall[] = [];

      // 3 & 4. Call adapter.generateStream or fallback
      if (this.adapter.generateStream) {
        const stream = this.adapter.generateStream(request);
        for await (const chunk of stream) {
          if (signal?.aborted) {
            throw new AgentError('Run aborted', signal.reason);
          }
          if (chunk.type === 'text_delta') {
            finalOutput += chunk.delta!;
            yield { type: 'text_delta', delta: chunk.delta! };
          } else if (chunk.type === 'thinking') {
            yield { type: 'thinking', delta: chunk.delta! };
          } else if (chunk.type === 'tool_call') {
            toolCalls.push(chunk.toolCall!);
          }
        }
      } else {
        const response = await this.adapter.generate(request);
        if (response.text) {
          finalOutput = response.text;
          yield { type: 'text_delta', delta: finalOutput };
        }
        if (response.toolCalls) {
          toolCalls.push(...response.toolCalls);
        }
      }

      // 5 & 6. Execute tool calls if any
      if (toolCalls.length > 0) {
        // Emit started events
        for (const call of toolCalls) {
          yield { type: 'tool_call_started', name: call.name, args: call.args };
        }

        // Execute concurrently
        const toolResults = await Promise.all(
          toolCalls.map(async (call) => {
            const tool = this.registry.get(call.name);
            if (!tool) {
              return { call, result: `Error: Tool '${call.name}' not found.` };
            }
            try {
              const result = await tool.call(call.args, { signal });
              return { call, result };
            } catch (err: any) {
               return { call, result: `Error executing tool: ${err.message}` };
            }
          })
        );

        // Emit completed events and append to history
        const resultMessages: Message[] = [];
        for (const { call, result } of toolResults) {
          yield { type: 'tool_call_completed', name: call.name, result };
          resultMessages.push({
            role: 'user',
            content: { type: 'tool_result', id: call.id, name: call.name, result }
          });
        }

        currentHistory.push({
          role: 'assistant',
          content: { type: 'tool_calls', calls: toolCalls }
        });
        currentHistory.push(...resultMessages);

        // 8. Repeat loop
        continue;
      }

      // 9. Emit done
      yield { type: 'done', output: finalOutput };
      break;
    }
  }
}
