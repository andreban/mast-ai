# MAST Protocols Reference

## Universal Remote Protocol (URP)

URP is used by remote reasoning engines (e.g., Rust, Python servers) to communicate with the browser `AgentRunner`. It is stateless.

### Request Schema (`POST /`)

```json
{
  "messages": [
    {
      "role": "user",
      "content": { "type": "text", "text": "What is 2 + 2?" }
    }
  ],
  "available_tools": [
    {
      "name": "calculator",
      "description": "Evaluates a mathematical expression.",
      "parameters": {
        "type": "object",
        "properties": { "expression": { "type": "string" } },
        "required": ["expression"]
      }
    }
  ],
  "configuration": {
    "temperature": 0.7,
    "max_tokens": 1024
  }
}
```

### Response Schema

Must return either `text_content` OR `tool_calls`.

**Text Response:**
```json
{
  "text_content": "The answer is 4.",
  "tool_calls": [],
  "usage_metrics": { "input_tokens": 42, "output_tokens": 10 }
}
```

**Tool Call Response:**
```json
{
  "tool_calls": [
    {
      "id": "call_abc123",
      "name": "calculator",
      "arguments": { "expression": "2 + 2" }
    }
  ]
}
```

## Agent Call Protocol (ACP)

ACP is a minimal HTTP convention for server-side *sub-agents*. Unlike URP, it encapsulates its own state and tools. The browser simply sends a string and gets a string back.

### Request
```json
{ "input": "Summarise the following text: ..." }
```

### Response
```json
{ "output": "The document discusses three key themes..." }
```