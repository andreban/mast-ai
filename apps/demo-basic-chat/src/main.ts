import './style.css'
import {
  VERSION,
  ToolRegistry,
  HttpTransport,
  AgentRunner,
  UrpAdapter,
  createAgent
} from '@mast-ai/core';
import type { Tool, ToolContext, Message } from '@mast-ai/core';

// --- Tools ---
class GetCurrentTimeTool implements Tool {
  definition() {
    return {
      name: 'getCurrentTime',
      description: 'Returns the current local time as a string.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    };
  }

  async call(_args: unknown, _context: ToolContext): Promise<{ time: string }> {
    return { time: new Date().toISOString() };
  }
}

class CalculatorTool implements Tool {
  definition() {
    return {
      name: 'calculate',
      description: 'Evaluates a mathematical expression (e.g., "2 + 2").',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string' }
        },
        required: ['expression']
      }
    };
  }

  async call(args: any, _context: ToolContext): Promise<{ result: number }> {
    try {
      // Basic safe evaluation for demo purposes
      const result = new Function(`return ${args.expression}`)();
      return { result };
    } catch (err) {
      throw new Error(`Failed to evaluate expression: ${args.expression}`);
    }
  }
}

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
      </div>
    </div>
  </div>
</div>
`;

// --- Chat Logic ---
const messageList = document.querySelector('#message-list')!;
const promptInput = document.querySelector<HTMLTextAreaElement>('#prompt-input')!;
const sendButton = document.querySelector<HTMLButtonElement>('#send-button')!;
const endpointInput = document.querySelector<HTMLInputElement>('#endpoint-url')!;
const statusIndicator = document.querySelector('#status-indicator')!;

let history: Message[] = [];

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
  msgEl.innerHTML = `<small>${content}</small>`;
  messageList.appendChild(msgEl);
  messageList.scrollTop = messageList.scrollHeight;
  return msgEl;
}

async function handleSend() {
  const text = promptInput.value.trim();
  if (!text) return;

  promptInput.value = '';
  promptInput.disabled = true;
  sendButton.disabled = true;

  appendMessage('user', text);

  const transport = new HttpTransport({ url: endpointInput.value });
  const adapter = new UrpAdapter(transport);
  const runner = new AgentRunner(adapter, registry);

  statusIndicator.textContent = 'Running...';
  statusIndicator.className = 'status-indicator running';

  let currentAssistantBubble: HTMLElement | null = null;
  let currentThinkingBubble: HTMLElement | null = null;

  try {
    const stream = runner.runBuilder(agentConfig).history(history).runStream(text);

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
        history.push({ role: 'user', content: { type: 'text', text } });
        // Instead of manually pushing history, ideally the runner yields a final state,
        // but for now we reconstruct it. We will just pass the runner's internal state
        // via a more complete run() method or handle it on the outside.
        // For simplicity in this demo, history is only appended on success.
        history.push({ role: 'assistant', content: { type: 'text', text: event.output } });
      }
    }
  } catch (error) {
    console.error(error);
    appendSystemMessage(`❌ Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    promptInput.disabled = false;
    sendButton.disabled = false;
    promptInput.focus();
    statusIndicator.textContent = 'Idle';
    statusIndicator.className = 'status-indicator';
  }
}

sendButton.addEventListener('click', handleSend);
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});
