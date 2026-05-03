// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useState, type KeyboardEvent } from 'react';
import { AgentRunner, ToolRegistry, createAgent } from '@mast-ai/core';
import { GoogleGenAIAdapter } from '@mast-ai/google-genai';
import {
  AgentProvider,
  AssistantMessage,
  UserMessage,
  useAgent,
  type IconMap,
} from '@mast-ai/react-ui';
import { Brain, CircleCheck, LoaderCircle, Send, Square, Wrench } from 'lucide-react';

import { GetCurrentTimeTool } from './tools';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
if (!apiKey) {
  console.warn('VITE_GEMINI_API_KEY is not set. Copy .env.example to .env and set your key.');
}

const registry = new ToolRegistry().register(new GetCurrentTimeTool());
const runner = new AgentRunner(new GoogleGenAIAdapter(apiKey ?? ''), registry);

const agentConfig = createAgent({
  name: 'DemoAssistant',
  instructions:
    'You are a helpful assistant for a demo of the @mast-ai/react-ui package. ' +
    'Use the get_current_time tool when the user asks about the current time.',
  tools: ['get_current_time'],
});

const icons: IconMap = {
  brain: <Brain size={16} />,
  wrench: <Wrench size={16} />,
  check: <CircleCheck size={16} />,
  loader: <LoaderCircle size={16} className="mast-spin" />,
  send: <Send size={16} />,
  stop: <Square size={16} />,
};

function ChatUI() {
  const { messages, sendMessage, cancel, isRunning } = useAgent();
  const [input, setInput] = useState('');

  const handleSend = () => {
    const text = input.trim();
    if (!text || isRunning) return;
    setInput('');
    sendMessage(text);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div>
      <ul>
        {messages.map((entry) => (
          <li key={entry.id}>
            {entry.role === 'user' ? (
              <UserMessage entry={entry} />
            ) : (
              <AssistantMessage entry={entry} />
            )}
            {entry.isStreaming && entry.text === '' && entry.toolEvents.length === 0 ? (
              <em> (thinking...)</em>
            ) : null}
          </li>
        ))}
      </ul>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        placeholder="Type a message and press Enter."
        disabled={isRunning}
      />
      <div>
        <button type="button" onClick={handleSend} disabled={isRunning || !input.trim()}>
          Send
        </button>
        {isRunning ? (
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AgentProvider runner={runner} agent={agentConfig} icons={icons}>
      <h1>MAST React UI Demo</h1>
      <ChatUI />
    </AgentProvider>
  );
}
