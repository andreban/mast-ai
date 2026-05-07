// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { VERSION, ToolRegistry, AgentRunner, createAgent, Conversation } from '@mast-ai/core';
import { GoogleGenAIAdapter } from '@mast-ai/google-genai';

document.querySelector<HTMLElement>('#version')!.textContent = `v${VERSION}`;

const apiKeyInput = document.querySelector<HTMLInputElement>('#api-key')!;
const API_KEY_STORAGE = 'mast-demo-google-search-grounding.gemini-api-key';
apiKeyInput.value = localStorage.getItem(API_KEY_STORAGE) ?? '';

const agent = createAgent({
  name: 'GroundedAssistant',
  instructions:
    'You are a helpful assistant. When the user asks about current events, prices, weather, ' +
    'sports results, or anything that may have changed recently, rely on the Google Search ' +
    'tool to ground your answer. Cite the most relevant source inline when you use search.',
});

// Build the runner whenever the API key changes so the adapter picks it up.
function buildConversation(): Conversation {
  const apiKey = apiKeyInput.value;
  const adapter = new GoogleGenAIAdapter(apiKey, 'gemini-3.1-pro-preview', undefined, [
    { googleSearch: {} },
  ]);
  const runner = new AgentRunner(adapter, new ToolRegistry());
  return runner.conversation(agent);
}

let conversation = buildConversation();

apiKeyInput.addEventListener('change', () => {
  localStorage.setItem(API_KEY_STORAGE, apiKeyInput.value);
  conversation = buildConversation();
});

// --- Chat UI. ----------------------------------------------------------------
const messageList = document.querySelector('#message-list')!;
const promptInput = document.querySelector<HTMLTextAreaElement>('#prompt-input')!;
const sendButton = document.querySelector<HTMLButtonElement>('#send-button')!;
const stopButton = document.querySelector<HTMLButtonElement>('#stop-button')!;
const statusIndicator = document.querySelector('#status-indicator')!;

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

function appendSystemMessage(content: string, type: 'tool' | 'error' = 'tool'): HTMLElement {
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

  if (!apiKeyInput.value.trim()) {
    appendSystemMessage('Set a Google AI API key in the sidebar before sending.', 'error');
    return;
  }

  promptInput.value = '';
  promptInput.disabled = true;
  sendButton.disabled = true;
  stopButton.hidden = false;

  appendMessage('user', text);

  const controller = new AbortController();
  currentController = controller;

  statusIndicator.textContent = 'Running...';
  statusIndicator.className = 'status-indicator running';

  let bubble: HTMLElement | null = null;

  try {
    for await (const event of conversation.runStream(text, controller.signal)) {
      if (event.type === 'text_delta') {
        if (!bubble) bubble = appendMessage('assistant', '');
        bubble.textContent += event.delta;
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error(error);
      appendSystemMessage(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
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
