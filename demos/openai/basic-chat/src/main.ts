// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { VERSION, ToolRegistry, AgentRunner, createAgent, Conversation } from '@mast-ai/core';
import { OpenAIChatCompletionsAdapter, OpenAIResponsesAdapter } from '@mast-ai/openai';
import type { ReasoningEffort } from '@mast-ai/openai';
import { GetCurrentTimeTool } from './tools/getCurrentTime';
import { CalculatorTool } from './tools/calculate';

const registry = new ToolRegistry()
  .register(new GetCurrentTimeTool())
  .register(new CalculatorTool());

const agentConfig = createAgent({
  name: 'OpenAIAssistant',
  instructions:
    'You are a helpful assistant. Use tools when necessary to answer user questions accurately.',
  tools: ['getCurrentTime', 'calculate'],
});

document.querySelector<HTMLElement>('#version')!.textContent = `v${VERSION}`;

const toolsList = document.querySelector<HTMLUListElement>('#tools-list')!;
for (const { name } of registry.getTools()) {
  const li = document.createElement('li');
  const code = document.createElement('code');
  code.textContent = name;
  li.appendChild(code);
  toolsList.appendChild(li);
}

const apiKeyInput = document.querySelector<HTMLInputElement>('#api-key')!;
const modelInput = document.querySelector<HTMLInputElement>('#model')!;
const reasoningEffortSelect = document.querySelector<HTMLSelectElement>('#reasoning-effort')!;
const apiSelect = document.querySelector<HTMLSelectElement>('#api-mode')!;

const API_KEY_STORAGE = 'mast-demo-openai-basic-chat.api-key';
const MODEL_STORAGE = 'mast-demo-openai-basic-chat.model';
const REASONING_STORAGE = 'mast-demo-openai-basic-chat.reasoning-effort';
const API_MODE_STORAGE = 'mast-demo-openai-basic-chat.api-mode';

apiKeyInput.value = localStorage.getItem(API_KEY_STORAGE) ?? '';
modelInput.value = localStorage.getItem(MODEL_STORAGE) ?? modelInput.value;
reasoningEffortSelect.value = localStorage.getItem(REASONING_STORAGE) ?? '';
apiSelect.value = localStorage.getItem(API_MODE_STORAGE) ?? apiSelect.value;

// Model names that accept the `reasoning_effort` parameter. Non-reasoning
// models (gpt-4o, gpt-4.1, ...) reject it with a 400, so the demo only
// forwards the dropdown value when it's safe.
function isReasoningModel(name: string): boolean {
  return /^o\d/i.test(name) || /^gpt-5/i.test(name);
}

function buildConversation(): Conversation {
  const modelName = modelInput.value || 'gpt-4o-mini';
  const reasoningEffort = isReasoningModel(modelName)
    ? ((reasoningEffortSelect.value || undefined) as ReasoningEffort | undefined)
    : undefined;
  const adapter =
    apiSelect.value === 'responses'
      ? new OpenAIResponsesAdapter(
          apiKeyInput.value,
          modelName,
          undefined,
          reasoningEffort ? { reasoningEffort } : undefined,
        )
      : new OpenAIChatCompletionsAdapter(
          apiKeyInput.value,
          modelName,
          undefined,
          reasoningEffort ? { reasoningEffort } : undefined,
        );
  const runner = new AgentRunner(adapter, registry);
  return runner.conversation(agentConfig);
}

// Built lazily on first send so an empty API key on page load doesn't
// trip the OpenAI SDK's constructor-time credential check. Invalidated
// whenever the user changes the key, model, or reasoning effort so the
// next send picks up the new settings.
let conversation: Conversation | null = null;

apiKeyInput.addEventListener('change', () => {
  localStorage.setItem(API_KEY_STORAGE, apiKeyInput.value);
  conversation = null;
});
modelInput.addEventListener('change', () => {
  localStorage.setItem(MODEL_STORAGE, modelInput.value);
  conversation = null;
});
reasoningEffortSelect.addEventListener('change', () => {
  localStorage.setItem(REASONING_STORAGE, reasoningEffortSelect.value);
  conversation = null;
});
apiSelect.addEventListener('change', () => {
  localStorage.setItem(API_MODE_STORAGE, apiSelect.value);
  conversation = null;
});

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

function appendSystemMessage(
  content: string,
  type: 'tool' | 'thinking' | 'error' = 'tool',
): HTMLElement {
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
    appendSystemMessage('Set an OpenAI API key in the sidebar before sending.', 'error');
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

  let assistantBubble: HTMLElement | null = null;
  let thinkingBubble: HTMLElement | null = null;

  try {
    if (!conversation) conversation = buildConversation();
    const stream = conversation.runStream(text, controller.signal);

    for await (const event of stream) {
      if (event.type === 'thinking') {
        if (!thinkingBubble) {
          thinkingBubble = appendSystemMessage('🤔 Thinking: ' + event.delta, 'thinking');
        } else {
          thinkingBubble.querySelector('small')!.textContent += event.delta;
        }
      } else if (event.type === 'text_delta') {
        if (!assistantBubble) {
          assistantBubble = appendMessage('assistant', '');
        }
        assistantBubble.textContent += event.delta;
      } else if (event.type === 'tool_call_started') {
        thinkingBubble = null;
        appendSystemMessage(`🔧 Executing: ${event.name}(${JSON.stringify(event.args)})`, 'tool');
      } else if (event.type === 'tool_call_completed') {
        appendSystemMessage(`✅ Result: ${JSON.stringify(event.result)}`, 'tool');
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error(error);
      appendSystemMessage(
        `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
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
