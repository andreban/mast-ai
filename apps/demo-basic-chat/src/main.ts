// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import {
  VERSION,
  ToolRegistry,
  HttpTransport,
  AgentRunner,
  UrpAdapter,
  createAgent,
  Conversation
} from '@mast-ai/core';
import { GetCurrentTimeTool } from './tools/getCurrentTime';
import { CalculatorTool } from './tools/calculate';

// --- Setup ---
const registry = new ToolRegistry()
  .register(new GetCurrentTimeTool())
  .register(new CalculatorTool());

const agentConfig = createAgent({
  name: 'DemoAssistant',
  instructions: 'You are a helpful assistant. Use tools when necessary to answer user questions accurately.',
  tools: ['getCurrentTime', 'calculate']
});

document.querySelector<HTMLElement>('#version')!.textContent = `v${VERSION}`;
const toolsList = document.querySelector<HTMLUListElement>('#tools-list')!;
for (const { name } of registry.definitions()) {
  const li = document.createElement('li');
  const code = document.createElement('code');
  code.textContent = name;
  li.appendChild(code);
  toolsList.appendChild(li);
}

// --- Chat Logic ---
const messageList = document.querySelector('#message-list')!;
const promptInput = document.querySelector<HTMLTextAreaElement>('#prompt-input')!;
const sendButton = document.querySelector<HTMLButtonElement>('#send-button')!;
const stopButton = document.querySelector<HTMLButtonElement>('#stop-button')!;
const endpointInput = document.querySelector<HTMLInputElement>('#endpoint-url')!;
const statusIndicator = document.querySelector('#status-indicator')!;

function buildConversation(): Conversation {
  const runner = new AgentRunner(new UrpAdapter(new HttpTransport({ url: endpointInput.value })), registry);
  return runner.conversation(agentConfig);
}

let conversation = buildConversation();
endpointInput.addEventListener('change', () => { conversation = buildConversation(); });

let currentController: AbortController | null = null;

function appendMessage(role: 'user' | 'assistant', content: string): HTMLElement {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = content;
  msgEl.appendChild(bubble);
  messageList.appendChild(msgEl);
  messageList.scrollTop = messageList.scrollHeight;
  return bubble;
}

function appendSystemMessage(content: string, type: 'tool' | 'thinking' | 'error' = 'tool'): HTMLElement {
  const msgEl = document.createElement('div');
  msgEl.className = `message system ${type}`;
  const small = document.createElement('small');
  small.textContent = content;
  msgEl.appendChild(small);
  messageList.appendChild(msgEl);
  messageList.scrollTop = messageList.scrollHeight;
  return msgEl;
}

async function handleSend() {
  if (currentController) return;

  const text = promptInput.value.trim();
  if (!text) return;

  promptInput.value = '';
  promptInput.disabled = true;
  sendButton.disabled = true;
  stopButton.hidden = false;

  appendMessage('user', text);

  const controller = new AbortController();
  currentController = controller;

  statusIndicator.textContent = 'Running...';
  statusIndicator.className = 'status-indicator running';

  let currentAssistantBubble: HTMLElement | null = null;
  let currentThinkingBubble: HTMLElement | null = null;

  try {
    const stream = conversation.runStream(text, controller.signal);

    for await (const event of stream) {
      if (event.type === 'thinking') {
        if (!currentThinkingBubble) {
          currentThinkingBubble = appendSystemMessage('🤔 Thinking: ' + event.delta, 'thinking');
        } else {
          currentThinkingBubble.querySelector('small')!.textContent += event.delta;
        }
      } else if (event.type === 'text_delta') {
        if (!currentAssistantBubble) {
          currentAssistantBubble = appendMessage('assistant', '');
        }
        currentAssistantBubble.textContent += event.delta;
      } else if (event.type === 'tool_call_started') {
        currentThinkingBubble = null; // Reset thinking
        appendSystemMessage(`🔧 Executing: ${event.name}(${JSON.stringify(event.args)})`, 'tool');
      } else if (event.type === 'tool_call_completed') {
        appendSystemMessage(`✅ Result: ${JSON.stringify(event.result)}`, 'tool');
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error(error);
      appendSystemMessage(`❌ Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  } finally {
    currentController = null;
    promptInput.disabled = false;
    sendButton.disabled = false;
    stopButton.hidden = true;
    promptInput.focus();
    statusIndicator.textContent = 'Idle';
    statusIndicator.className = 'status-indicator';
  }
}

sendButton.addEventListener('click', handleSend);
stopButton.addEventListener('click', () => currentController?.abort());
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});
