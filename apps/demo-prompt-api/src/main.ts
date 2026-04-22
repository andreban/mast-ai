// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { marked } from 'marked';
import { VERSION, ToolRegistry, AgentRunner, createAgent, Conversation } from '@mast-ai/core';
import { BuiltInAIAdapter, checkAvailability } from '@mast-ai/built-in-ai';
import type { LanguageModelAvailability } from '@mast-ai/built-in-ai';

document.querySelector<HTMLElement>('#version')!.textContent = `v${VERSION}`;

// --- Setup ---
const agentConfig = createAgent({
  name: 'PromptAPIAssistant',
  instructions: 'You are a helpful assistant running entirely on-device via the browser Prompt API.',
  tools: [],
});

// --- Availability ---
const availabilityBadge = document.querySelector<HTMLElement>('#availability-badge')!;
const availabilityNote = document.querySelector<HTMLElement>('#availability-note')!;
const sendButton = document.querySelector<HTMLButtonElement>('#send-button')!;

const NOTES: Record<string, string> = {
  readily: 'The model is downloaded and ready.',
  downloading: 'The model is currently downloading. Please wait.',
  'after-download': 'The model needs to be downloaded before use.',
  unavailable: 'On-device AI is not available in this browser.',
  'no-api': 'The Prompt API (LanguageModel) is not supported in this browser.',
};

async function refreshAvailability() {
  availabilityBadge.className = 'availability-badge checking';
  availabilityBadge.textContent = 'Checking…';
  availabilityNote.textContent = '';
  sendButton.disabled = true;

  let status: LanguageModelAvailability | 'no-api';
  try {
    status = await checkAvailability();
  } catch {
    status = 'no-api';
  }

  availabilityBadge.className = `availability-badge ${status}`;
  availabilityBadge.textContent = status;
  availabilityNote.textContent = NOTES[status] ?? '';
  sendButton.disabled = status !== 'readily';
}

document.querySelector('#refresh-button')!.addEventListener('click', refreshAvailability);
refreshAvailability();

// --- Conversation ---
function buildConversation(): Conversation {
  const adapter = new BuiltInAIAdapter();
  const runner = new AgentRunner(adapter, new ToolRegistry());
  return runner.conversation(agentConfig);
}

let conversation = buildConversation();

// --- Chat Logic ---
const messageList = document.querySelector('#message-list')!;
const promptInput = document.querySelector<HTMLTextAreaElement>('#prompt-input')!;
const stopButton = document.querySelector<HTMLButtonElement>('#stop-button')!;
const statusIndicator = document.querySelector('#status-indicator')!;

let currentController: AbortController | null = null;

function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string;
}

function appendMessage(role: 'user' | 'assistant', content: string): HTMLElement {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (role === 'assistant') {
    bubble.innerHTML = renderMarkdown(content);
  } else {
    bubble.textContent = content;
  }
  msgEl.appendChild(bubble);
  messageList.appendChild(msgEl);
  messageList.scrollTop = messageList.scrollHeight;
  return bubble;
}

function appendError(message: string) {
  const msgEl = document.createElement('div');
  msgEl.className = 'message system error';
  const small = document.createElement('small');
  small.textContent = message;
  msgEl.appendChild(small);
  messageList.appendChild(msgEl);
  messageList.scrollTop = messageList.scrollHeight;
}

async function handleSend() {
  if (currentController) return;

  const text = promptInput.value.trim();
  if (!text) return;

  promptInput.value = '';
  promptInput.disabled = true;
  sendButton.disabled = true;
  stopButton.hidden = false;
  statusIndicator.textContent = 'Running…';
  statusIndicator.className = 'status-indicator running';

  appendMessage('user', text);

  const controller = new AbortController();
  currentController = controller;

  let assistantBubble: HTMLElement | null = null;
  let accumulatedText = '';

  try {
    const stream = conversation.runStream(text, controller.signal);
    for await (const event of stream) {
      if (event.type === 'text_delta') {
        accumulatedText += event.delta;
        if (!assistantBubble) assistantBubble = appendMessage('assistant', '');
        assistantBubble.innerHTML = renderMarkdown(accumulatedText);
        messageList.scrollTop = messageList.scrollHeight;
      } else if (event.type === 'done' && !assistantBubble) {
        appendMessage('assistant', event.output);
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error(error);
      appendError(`Error: ${error instanceof Error ? error.message : String(error)}`);
      // On error, rebuild the conversation so the next turn starts clean.
      conversation = buildConversation();
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
