import { 
  ToolRegistry, 
  HttpTransport, 
  UrpAdapter, 
  AgentRunner,
  AgentConfig
} from '@mast-ai/core';

// 1. Define a browser-native tool
const registry = new ToolRegistry().register({
  definition: () => ({
    name: 'getScreenResolution',
    description: 'Returns the user\'s current screen width and height.',
    parameters: { type: 'object', properties: {}, required: [] }
  }),
  call: async () => ({ width: window.innerWidth, height: window.innerHeight })
});

// 2. Define the Agent Configuration
const agent: AgentConfig = {
  name: 'BrowserAssistant',
  instructions: 'You are a helpful UI assistant. Use tools to answer questions about the screen.',
  tools: ['getScreenResolution']
};

// 3. Setup the runner (Hybrid Mode example)
const transport = new HttpTransport({ url: 'http://localhost:3000/api/chat' });
const adapter = new UrpAdapter(transport);
const runner = new AgentRunner(adapter, registry);

// 4. Run the conversation
async function main() {
  const conv = runner.conversation(agent);
  
  try {
    const result = await conv.run('How big is my screen?');
    console.log('Agent:', result.output);
  } catch (error) {
    console.error('Agent failed:', error);
  }
}

main();