import './style.css'
import {
  VERSION,
  ToolRegistry,
  HttpTransport,
  AgentRunner,
  UrpAdapter,
  createAgent
} from '@mast-ai/core';
import type { Message } from '@mast-ai/core';
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


// --- UI Framework ---
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<div class="app-container">
  <div class="sidebar">
    <h2>MAST Demo <small>v${VERSION}</small></h2>

    <div class="config-panel">
      <label>Remote Endpoint URL</label>
      <input type="text" id="endpoint-url" value="http://127.0.0.1:3000/api/chat" />
    </div>

    <div class="tools-panel">
      <h3>Available Tools</h3>
      <ul>
        ${registry.definitions().map(d => `<li><code>${d.name}</code></li>`).join('')}
      </ul>
    </div>
  </div>

  <div class="chat-container">
    <div class="message-list" id="message-list">
      <div class="message assistant">
        <div class="bubble">Hello! I'm ready to help. I can check the time and do math.</div>
      </div>
    </div>

    <div class="input-area">
      <div class="status-indicator" id="status-indicator">Idle</div>
      <div class="input-group">
        <textarea id="prompt-input" placeholder="Ask something (e.g., 'What time is it?' or 'What is 54 * 23?')"></textarea>
        <button id="send-button">Send</button>
        <button id="stop-button" class="stop-button" hidden>Stop</button>
      </div>
    </div>
  </div>
</div>
`;

// --- Chat Logic ---
const messageList = document.querySelector('#message-list')!;
const promptInput = document.querySelector<HTMLTextAreaElement>('#prompt-input')!;
const sendButton = document.querySelector<HTMLButtonElement>('#send-button')!;
const stopButton = document.querySelector<HTMLButtonElement>('#stop-button')!;
const endpointInput = document.querySelector<HTMLInputElement>('#endpoint-url')!;
const statusIndicator = document.querySelector('#status-indicator')!;

function buildRunner(): AgentRunner {
  return new AgentRunner(new UrpAdapter(new HttpTransport({ url: endpointInput.value })), registry);
}

let runner = buildRunner();
endpointInput.addEventListener('change', () => { runner = buildRunner(); });

let history: Message[] = [];
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
    const stream = runner.runBuilder(agentConfig).history(history).signal(controller.signal).runStream(text);

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
      } else if (event.type === 'done') {
        history = event.history;
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
