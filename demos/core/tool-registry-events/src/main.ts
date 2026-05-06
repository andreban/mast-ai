// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { VERSION, ToolRegistry } from '@mast-ai/core';
import type { Tool, ToolDefinition } from '@mast-ai/core';

document.querySelector<HTMLElement>('#version')!.textContent = `v${VERSION}`;

// --- Sample tools (mixed scopes) ---

function makeTool(def: ToolDefinition, run: (args: unknown) => unknown): Tool {
  return {
    definition: () => def,
    call: async (args) => run(args),
  };
}

const SAMPLE_TOOLS: Tool[] = [
  makeTool(
    {
      name: 'clock',
      description: 'Returns the current time.',
      parameters: { type: 'object', properties: {} },
      scope: 'read',
    },
    () => new Date().toISOString(),
  ),
  makeTool(
    {
      name: 'searchWeb',
      description: 'Searches the web for a query.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      scope: 'read',
    },
    (args) => `Results for "${(args as { query: string }).query}"`,
  ),
  makeTool(
    {
      name: 'addNote',
      description: 'Saves a note to local storage.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      scope: 'write',
    },
    (args) => `Saved: ${(args as { text: string }).text}`,
  ),
];

// --- Registry + read-only view ---

const registry = new ToolRegistry();
const readOnlyView = registry.readOnly();

// --- DOM elements ---

const fullList = document.querySelector<HTMLUListElement>('#full-list')!;
const readOnlyList = document.querySelector<HTMLUListElement>('#readonly-list')!;
const eventLog = document.querySelector<HTMLOListElement>('#event-log')!;
const toolControls = document.querySelector<HTMLUListElement>('#tool-controls')!;

// --- Tool controls (register / unregister buttons) ---

for (const tool of SAMPLE_TOOLS) {
  const def = tool.definition();
  const li = document.createElement('li');
  li.className = 'tool-control';
  li.dataset.tool = def.name;
  li.innerHTML = `
    <div class="tool-control-info">
      <span class="tool-control-name">${def.name}</span>
      <span class="scope-badge scope-${def.scope}">${def.scope}</span>
    </div>
    <button class="toggle-button" type="button">Register</button>
  `;
  const button = li.querySelector<HTMLButtonElement>('.toggle-button')!;
  button.addEventListener('click', () => {
    if (registry.getTool(def.name)) {
      registry.unregister(def.name);
    } else {
      registry.register(tool);
    }
  });
  toolControls.appendChild(li);
}

function refreshControls(): void {
  for (const li of toolControls.querySelectorAll<HTMLLIElement>('.tool-control')) {
    const name = li.dataset.tool!;
    const button = li.querySelector<HTMLButtonElement>('.toggle-button')!;
    const registered = registry.getTool(name) !== undefined;
    li.classList.toggle('registered', registered);
    button.textContent = registered ? 'Unregister' : 'Register';
  }
}

// --- Bulk buttons ---

document.querySelector('#register-all')!.addEventListener('click', () => {
  for (const tool of SAMPLE_TOOLS) {
    if (!registry.getTool(tool.definition().name)) registry.register(tool);
  }
});

document.querySelector('#unregister-all')!.addEventListener('click', () => {
  for (const tool of SAMPLE_TOOLS) {
    registry.unregister(tool.definition().name);
  }
});

// --- List rendering ---

function renderToolList(target: HTMLUListElement, definitions: ToolDefinition[]): void {
  target.innerHTML = '';
  if (definitions.length === 0) {
    const li = document.createElement('li');
    li.className = 'placeholder';
    li.textContent =
      target === readOnlyList ? 'No read-scope tools registered.' : 'No tools registered.';
    target.appendChild(li);
    return;
  }
  for (const def of definitions) {
    const li = document.createElement('li');
    li.className = 'tool-row';
    li.innerHTML = `
      <div class="tool-row-head">
        <span class="tool-row-name">${def.name}</span>
        <span class="scope-badge scope-${def.scope}">${def.scope}</span>
      </div>
      <p class="tool-row-desc">${def.description}</p>
    `;
    target.appendChild(li);
  }
}

// --- Event log ---

let logCleared = true;
function logEvent(source: 'registry' | 'view', type: string, detail: string): void {
  if (logCleared) {
    eventLog.innerHTML = '';
    logCleared = false;
  }
  const li = document.createElement('li');
  li.className = `log-entry source-${source} type-${type}`;
  const time = new Date().toLocaleTimeString();
  li.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-source">${source}</span>
    <span class="log-type">${type}</span>
    <span class="log-detail">${detail}</span>
  `;
  eventLog.prepend(li);
}

document.querySelector('#clear-log')!.addEventListener('click', () => {
  eventLog.innerHTML = '<li class="placeholder">Events will appear here.</li>';
  logCleared = true;
});

// --- Wire listeners (the whole point of the demo) ---

registry.addEventListener('tool-registered', ({ tool }) => {
  const def = tool.definition();
  logEvent('registry', 'tool-registered', def.name);
  renderToolList(fullList, registry.getTools());
  refreshControls();
});

registry.addEventListener('tool-unregistered', ({ name }) => {
  logEvent('registry', 'tool-unregistered', name);
  renderToolList(fullList, registry.getTools());
  refreshControls();
});

readOnlyView.addEventListener('tool-registered', ({ tool }) => {
  logEvent('view', 'tool-registered', tool.definition().name);
  renderToolList(readOnlyList, readOnlyView.getTools());
});

readOnlyView.addEventListener('tool-unregistered', ({ name }) => {
  logEvent('view', 'tool-unregistered', name);
  renderToolList(readOnlyList, readOnlyView.getTools());
});

// --- Initial paint (no events fire on an empty registry) ---

renderToolList(fullList, registry.getTools());
renderToolList(readOnlyList, readOnlyView.getTools());
refreshControls();
