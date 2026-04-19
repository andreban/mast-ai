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
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
pub enum UrpMessageContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_calls")]
    ToolCalls { calls: Vec<UrpToolCall> },
    #[serde(rename = "tool_result")]
    ToolResult {
        id: String,
        name: String,
        result: Value,
    },
}

#[derive(Serialize, Deserialize, Debug)]
pub struct UrpToolCall {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub arguments: Value,
}

#[derive(Serialize, Debug)]
pub struct UrpResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_content: Option<String>,
    pub tool_calls: Vec<agent_rig::model::ToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_metrics: Option<Value>,
}
