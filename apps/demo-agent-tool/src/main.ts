// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import {
  VERSION,
  ToolRegistry,
  HttpTransport,
  AgentRunner,
  UrpAdapter,
  createAgent,
  createAgentTool,
  Conversation,
} from '@mast-ai/core';
import { BuiltInAIAdapter, checkAvailability } from '@mast-ai/built-in-ai';

document.querySelector<HTMLElement>('#version')!.textContent = `v${VERSION}`;

// --- Child agent: runs on-device via the Prompt API. -------------------------
const childAgent = createAgent({
  name: 'Rewriter',
  instructions:
    'You are a text rewriter. The input you receive is JSON of the form {"text": string, "style": string}. ' +
    'Return only the rewritten text in the requested style — no preamble, no explanation, no quotes around the result.',
});

const childRunner = new AgentRunner(new BuiltInAIAdapter());

const rewriteTool = createAgentTool(childRunner, childAgent, {
  name: 'rewrite_text',
  description:
    'Rewrites a piece of text in the requested style. Use this whenever the user asks to rephrase, reword, or transform text.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to rewrite.' },
      style: {
        type: 'string',
        description: 'The target style (e.g. "formal", "haiku", "shakespearean").',
      },
    },
    required: ['text', 'style'],
  },
  buildInput: (args) => JSON.stringify(args),
});

// --- Parent agent: hits a remote URP backend with one tool. ------------------
const registry = new ToolRegistry().register(rewriteTool);

const parentAgent = createAgent({
  name: 'RewriteOrchestrator',
  instructions:
    'You help the user rewrite text in different styles. When the user provides text and a target style, ' +
    'always call the rewrite_text tool — never attempt to rewrite text yourself. Return the tool result verbatim.',
  tools: ['rewrite_text'],
});

const endpointInput = document.querySelector<HTMLInputElement>('#endpoint-url')!;

function buildConversation(): Conversation {
  const runner = new AgentRunner(
    new UrpAdapter(new HttpTransport({ url: endpointInput.value })),
    registry,
  );
  return runner.conversation(parentAgent);
}

let conversation = buildConversation();
endpointInput.addEventListener('change', () => {
  conversation = buildConversation();
});

// --- Availability check for the child adapter. -------------------------------
checkAvailability()
  .then((status) => {
    if (status !== 'readily') {
      appendSystemMessage(
        `On-device model status: ${status}. The rewrite_text tool will fail until the model is "readily" available.`,
        'error',
      );
    }
  })
  .catch(() => {
    appendSystemMessage(
      'The Prompt API (LanguageModel) is not supported in this browser — the child agent cannot run.',
      'error',
    );
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

function appendChildBlock(toolName: string): HTMLElement {
  const msgEl = document.createElement('div');
  msgEl.className = 'message system child';
  const header = document.createElement('strong');
  header.textContent = `↳ child events from ${toolName}`;
  const body = document.createElement('pre');
  body.className = 'child-body';
  msgEl.appendChild(header);
  msgEl.appendChild(body);
  messageList.appendChild(msgEl);
  messageList.scrollTop = messageList.scrollHeight;
  return body;
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

  let parentBubble: HTMLElement | null = null;
  // Tracks one child-events block per tool invocation so concurrent calls don't interleave.
  const childBlocks = new Map<string, HTMLElement>();

  try {
    const stream = conversation.runStream(text, controller.signal, (toolName, event) => {
      if (event.type === 'text_delta' || event.type === 'thinking') {
        let body = childBlocks.get(toolName);
        if (!body) {
          body = appendChildBlock(toolName);
          childBlocks.set(toolName, body);
        }
        body.textContent += event.delta;
      }
    });

    for await (const event of stream) {
      if (event.type === 'text_delta') {
        if (!parentBubble) parentBubble = appendMessage('assistant', '');
        parentBubble.textContent += event.delta;
      } else if (event.type === 'tool_call_started') {
        appendSystemMessage(`Calling ${event.name}(${JSON.stringify(event.args)})`, 'tool');
      } else if (event.type === 'tool_call_completed') {
        appendSystemMessage(`Result: ${JSON.stringify(event.result)}`, 'tool');
        // Reset so the next tool invocation gets a fresh block.
        childBlocks.delete(event.name);
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
