// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

use agent_rig::tool::ToolDefinition;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize, Debug)]
pub struct UrpRequest {
    pub messages: Vec<UrpMessage>,
    pub available_tools: Option<Vec<ToolDefinition>>,
    // Accepted for protocol compatibility but not used by this backend.
    #[allow(dead_code)]
    pub configuration: Option<Value>,
    #[serde(default)]
    pub stream: bool,
}

#[derive(Serialize, Debug)]
#[serde(tag = "type")]
pub enum UrpStreamChunk {
    #[serde(rename = "text_delta")]
    TextDelta { delta: String },
    #[serde(rename = "thinking")]
    Thinking { delta: String },
    #[serde(rename = "tool_call")]
    ToolCall { tool_call: UrpToolCall },
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(Deserialize, Debug)]
pub struct UrpMessage {
    pub role: String,
    pub content: UrpMessageContent,
    // Accepted for protocol compatibility but not used by this backend: the
    // pinned agent-rig `Message` has no message-level metadata to carry it.
    #[allow(dead_code)]
    #[serde(default)]
    pub provider_metadata: Option<Value>,
}

/// Adjacently tagged to match agent-rig's `MessageContent` wire shape.
#[derive(Deserialize, Debug)]
#[serde(tag = "type", content = "content", rename_all = "snake_case")]
pub enum UrpMessageContent {
    Text(String),
    ToolCalls(Vec<UrpToolCall>),
    ToolResult(UrpToolResult),
}

#[derive(Deserialize, Debug)]
pub struct UrpToolResult {
    pub tool_call: UrpToolCall,
    pub result: Value,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct UrpToolCall {
    pub id: String,
    pub name: String,
    // Required by the URP spec. Deliberately has no `#[serde(default)]` so a
    // client that omits (or misnames) the field fails loudly with a 422
    // instead of silently degrading the model's context.
    pub arguments: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_metadata: Option<Value>,
}

impl From<agent_rig::model::ToolCall> for UrpToolCall {
    fn from(tc: agent_rig::model::ToolCall) -> Self {
        Self {
            id: tc.id,
            name: tc.name,
            arguments: tc.args,
            provider_metadata: tc.provider_metadata,
        }
    }
}

impl From<UrpToolCall> for agent_rig::model::ToolCall {
    fn from(tc: UrpToolCall) -> Self {
        Self {
            id: tc.id,
            name: tc.name,
            args: tc.arguments,
            provider_metadata: tc.provider_metadata,
        }
    }
}

#[derive(Serialize, Debug)]
pub struct UrpResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_content: Option<String>,
    pub tool_calls: Vec<UrpToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_metrics: Option<Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_adjacently_tagged_messages() {
        let json = serde_json::json!([
            { "role": "user", "content": { "type": "text", "content": "Hello" } },
            {
                "role": "assistant",
                "content": {
                    "type": "tool_calls",
                    "content": [{ "id": "call_1", "name": "search", "arguments": { "q": "x" } }]
                }
            },
            {
                "role": "user",
                "content": {
                    "type": "tool_result",
                    "content": {
                        "tool_call": {
                            "id": "call_1",
                            "name": "search",
                            "arguments": { "q": "x" },
                            "provider_metadata": "sig"
                        },
                        "result": { "items": [] }
                    }
                }
            }
        ]);

        let messages: Vec<UrpMessage> = serde_json::from_value(json).unwrap();

        assert!(matches!(&messages[0].content, UrpMessageContent::Text(t) if t == "Hello"));
        assert!(
            matches!(&messages[1].content, UrpMessageContent::ToolCalls(c) if c[0].arguments["q"] == "x")
        );
        let UrpMessageContent::ToolResult(tr) = &messages[2].content else {
            panic!("expected tool_result");
        };
        assert_eq!(tr.tool_call.id, "call_1");
        assert_eq!(tr.tool_call.provider_metadata, Some(Value::from("sig")));
        assert_eq!(tr.result["items"], serde_json::json!([]));
    }
}
