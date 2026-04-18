# Implementing a MAST-Compatible URP Server

This guide explains how to build a custom backend (in any language) that can act as the reasoning engine for a MAST (Modular Agent State Toolkit) agent running in the browser. 

MAST communicates with remote backends using the **Universal Remote Protocol (URP)**. 

## Core Concepts

1. **Statelessness:** Your server does not need to remember conversation history, maintain sessions, or execute tools. The MAST client (in the browser) holds the state.
2. **The Loop:** Every time the browser makes a request, it sends the *entire* conversation history along with a list of tools it knows how to execute.
3. **Your Server's Job:** Receive the prompt, pass it to an LLM (OpenAI, Anthropic, local Llama, etc.), and map the LLM's response back into the URP response format. If the LLM wants to call a tool, your server simply forwards that *intent* back to the client.

## Transport

By default, MAST uses HTTP `POST`. 

- **Endpoint:** Any URL you choose (configured on the client via `HttpTransport`).
- **Content-Type:** `application/json`

---

## 1. The Request Schema

When the browser needs the LLM to generate the next response, it sends a JSON payload looking like this:

```json
{
  "messages": [
    {
      "role": "user",
      "content": {
        "type": "text",
        "text": "What is the weather in London?"
      }
    }
  ],
  "available_tools": [
    {
      "name": "get_weather",
      "description": "Fetches the current weather for a given city.",
      "parameters": {
        "type": "object",
        "properties": {
          "location": { "type": "string" }
        },
        "required": ["location"]
      }
    }
  ],
  "configuration": {
    "temperature": 0.7,
    "max_tokens": 1024
  }
}
```

### Request Fields

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `messages` | `Array` | Yes | The full conversation history. Roles are `user` or `assistant`. Content can be text, tool calls, or tool results. |
| `available_tools` | `Array` | Yes | JSON Schema metadata for tools the browser can execute. Your server should feed this to your LLM so it knows what tools are available. |
| `configuration` | `Object` | No | Optional LLM settings (like temperature). Your server can safely ignore this if you prefer hardcoded defaults. |

---

## 2. The Response Schema

Your server must return a 200 OK with a JSON body. The response must contain *either* text output OR a list of tool calls.

### Scenario A: Text Response
If the LLM just wants to speak to the user, return `text_content` and an empty `tool_calls` array.

```json
{
  "text_content": "I can help with that! Let me check the weather.",
  "tool_calls": [],
  "usage_metrics": {
    "input_tokens": 45,
    "output_tokens": 12
  }
}
```

### Scenario B: Tool Call Request
If the LLM decides it needs to use a tool, **omit** `text_content` (or send undefined) and provide the tool call details.

```json
{
  "tool_calls": [
    {
      "id": "call_abc123",
      "name": "get_weather",
      "arguments": {
        "location": "London"
      }
    }
  ],
  "usage_metrics": {
    "input_tokens": 45,
    "output_tokens": 15
  }
}
```

### Response Fields

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `text_content` | `string` | No | The text to display to the user. Omit if returning tool calls. |
| `tool_calls` | `Array` | Yes | A list of tools the LLM wants to execute. Must be an empty array `[]` if returning text. |
| `usage_metrics`| `Object` | No | Optional token counting data. |

---

## 3. How Tool Execution Works (The Client Loop)

It's vital to understand what happens *after* you return a tool call:

1. **Server returns `tool_calls`.**
2. The MAST browser client receives this.
3. The browser looks up the tool locally and runs the TypeScript/JavaScript function.
4. The browser makes a **new** HTTP POST request to your server, appending the result.

The next request your server sees will look like this:

```json
{
  "messages": [
    {
      "role": "user",
      "content": { "type": "text", "text": "What is the weather in London?" }
    },
    {
      "role": "assistant",
      "content": {
        "type": "tool_calls",
        "calls": [
          { "id": "call_abc123", "name": "get_weather", "arguments": { "location": "London" } }
        ]
      }
    },
    {
      "role": "user",
      "content": {
        "type": "tool_result",
        "id": "call_abc123",
        "name": "get_weather",
        "result": { "temp": "15C", "condition": "Cloudy" }
      }
    }
  ],
  "available_tools": [ ... ]
}
```

Notice the new `tool_result` message. Your server just passes this entire array back into the LLM, which will now see the weather data and generate a final `text_content` response.

---

## 4. Example: A Simple Node.js / Express Server

Here is a pseudo-code example of what a simple URP server looks like wrapping the OpenAI API:

```javascript
import express from 'express';
import OpenAI from 'openai';

const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/api/urp', async (req, res) => {
  const { messages, available_tools, configuration } = req.body;

  // 1. Map URP messages to OpenAI's expected format
  const oaiMessages = messages.map(msg => {
    // Note: You will need a mapper function here to convert URP's `tool_calls` 
    // and `tool_result` shapes into OpenAI's native message formats.
    return mapUrpMessageToOpenAI(msg);
  });

  // 2. Map URP tools to OpenAI format
  const oaiTools = available_tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));

  // 3. Call the LLM
  const completion = await openai.chat.completions.create({
    model: "gpt-4-turbo",
    messages: oaiMessages,
    tools: oaiTools.length > 0 ? oaiTools : undefined,
    temperature: configuration?.temperature || 0.7,
  });

  const choice = completion.choices[0].message;

  // 4. Map the response back to URP
  const urpResponse = {
    tool_calls: [],
    usage_metrics: {
      input_tokens: completion.usage.prompt_tokens,
      output_tokens: completion.usage.completion_tokens
    }
  };

  if (choice.tool_calls) {
    // Map OpenAI tool calls to URP tool calls
    urpResponse.tool_calls = choice.tool_calls.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments)
    }));
  } else {
    // Map text
    urpResponse.text_content = choice.content;
  }

  // 5. Send back to the browser
  res.json(urpResponse);
});

app.listen(3000, () => console.log('URP Server running on port 3000'));
```

## Troubleshooting
- **CORS:** Remember, if your server runs on a different domain/port than the browser app, you *must* enable Cross-Origin Resource Sharing (CORS) on your server.
- **IDs:** Always echo the `id` from a `tool_call` back to the LLM exactly as the LLM provided it, as the client will use this ID to match the result.