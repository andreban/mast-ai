// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { AgentRunner, ToolRegistry, createAgent } from '@mast-ai/core';
import { GoogleGenAIAdapter } from '@mast-ai/google-genai';
import { AgentProvider, ConversationPanel, type IconMap } from '@mast-ai/react-ui';
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

type ThemeChoice = 'system' | 'light' | 'dark';

const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

const THEME_LABEL: Record<ThemeChoice, string> = {
  system: 'Theme: System',
  light: 'Theme: Light',
  dark: 'Theme: Dark',
};

export default function App() {
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const panelTheme = theme === 'system' ? undefined : theme;

  return (
    <AgentProvider runner={runner} agent={agentConfig} icons={icons}>
      <div className="demo-shell">
        <header className="demo-header">
          <h1>MAST React UI Demo</h1>
          <button
            type="button"
            className="demo-theme-toggle"
            onClick={() => setTheme((current) => NEXT_THEME[current])}
          >
            {THEME_LABEL[theme]}
          </button>
        </header>
        <ConversationPanel theme={panelTheme} />
      </div>
    </AgentProvider>
  );
}
