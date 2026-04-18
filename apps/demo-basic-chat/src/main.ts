import './style.css'
import { VERSION, ToolRegistry } from '@mast-ai/core';
import type { Tool, ToolContext } from '@mast-ai/core';

// 1. Stub out a basic tool
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

// 2. Initialize the registry
const registry = new ToolRegistry();
registry.register(new GetCurrentTimeTool());

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<div style="padding: 2rem; max-width: 800px; margin: 0 auto; font-family: system-ui, sans-serif;">
  <h1>MAST Demo: Basic Chat</h1>

  <div style="background: #f4f4f5; padding: 1rem; border-radius: 8px; margin-bottom: 2rem; border: 1px solid #e4e4e7;">
    <h2 style="margin-top: 0; font-size: 1.25rem;">Core Status</h2>
    <p><strong>@mast-ai/core Version:</strong> <span style="font-family: monospace; background: #e4e4e7; padding: 0.2rem 0.4rem; border-radius: 4px;">${VERSION}</span></p>
    <p><strong>Status:</strong> <span style="color: green;">✓ Loaded Successfully</span></p>
  </div>

  <div style="background: #f4f4f5; padding: 1rem; border-radius: 8px; border: 1px solid #e4e4e7;">
    <h2 style="margin-top: 0; font-size: 1.25rem;">Tool Registry Test</h2>
    <p>Registered Tools: <strong>${registry.definitions().length}</strong></p>
    <pre style="background: #27272a; color: #f4f4f5; padding: 1rem; border-radius: 4px; overflow-x: auto;">
${JSON.stringify(registry.definitions(), null, 2)}
    </pre>
    <button id="test-tool" style="padding: 0.5rem 1rem; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 1rem;">
      Test getCurrentTime
    </button>
    <div id="tool-result" style="margin-top: 1rem; font-family: monospace;"></div>
  </div>
</div>
`;

document.querySelector('#test-tool')?.addEventListener('click', async () => {
  const tool = registry.get('getCurrentTime');
  const resultElement = document.querySelector('#tool-result');

  if (tool && resultElement) {
    resultElement.textContent = 'Executing...';
    try {
      const result = await tool.call({}, {});
      resultElement.innerHTML = `<span style="color: green;">Result:</span> ${JSON.stringify(result)}`;
    } catch (error) {
      resultElement.innerHTML = `<span style="color: red;">Error:</span> ${error}`;
    }
  }
});
