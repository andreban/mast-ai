use axum::{
    extract::State,
    http::{Method, StatusCode},
    routing::post,
    Json, Router,
};
use dotenvy::dotenv;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{env, sync::Arc};
use tower_http::cors::{Any, CorsLayer};

// -----------------------------------------------------------------------------
// URP JSON Types
// -----------------------------------------------------------------------------

#[derive(Deserialize, Debug)]
struct UrpRequest {
    messages: Vec<UrpMessage>,
    available_tools: Option<Vec<UrpToolDefinition>>,
    #[allow(dead_code)]
    configuration: Option<Value>,
}

#[derive(Deserialize, Debug)]
struct UrpMessage {
    role: String,
    content: UrpMessageContent,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
enum UrpMessageContent {
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
struct UrpToolCall {
    id: String,
    name: String,
    #[serde(default)]
    arguments: Value,
}

#[derive(Serialize, Deserialize, Debug)]
struct UrpToolDefinition {
    name: String,
    description: String,
    parameters: Value,
}

#[derive(Serialize, Debug)]
struct UrpResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    text_content: Option<String>,
    tool_calls: Vec<UrpToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage_metrics: Option<Value>,
}

// -----------------------------------------------------------------------------
// Server Logic
// -----------------------------------------------------------------------------

struct AppState {
    http_client: Client,
    api_key: Option<String>,
}

async fn handle_urp(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UrpRequest>,
) -> Result<Json<UrpResponse>, (StatusCode, String)> {
    // We will use Gemini API directly if we have an API key, otherwise fallback to local Ollama.
    if let Some(api_key) = &state.api_key {
        handle_gemini(api_key, &state.http_client, payload).await
    } else {
        handle_ollama(&state.http_client, payload).await
    }
}

async fn handle_gemini(
    api_key: &str,
    client: &Client,
    payload: UrpRequest,
) -> Result<Json<UrpResponse>, (StatusCode, String)> {
    // Map URP Messages -> Gemini Contents
    let mut contents = Vec::new();
    let mut system_instruction = None;

    for msg in payload.messages {
        match msg.role.as_str() {
            "system" => {
                if let UrpMessageContent::Text { text } = msg.content {
                    system_instruction = Some(json!({
                        "parts": [{ "text": text }]
                    }));
                }
            }
            "user" => {
                let parts = match msg.content {
                    UrpMessageContent::Text { text } => vec![json!({ "text": text })],
                    UrpMessageContent::ToolResult { name, result, .. } => {
                        vec![json!({
                            "functionResponse": {
                                "name": name,
                                "response": result
                            }
                        })]
                    }
                    _ => vec![],
                };
                contents.push(json!({ "role": "user", "parts": parts }));
            }
            "assistant" => {
                let parts = match msg.content {
                    UrpMessageContent::Text { text } => vec![json!({ "text": text })],
                    UrpMessageContent::ToolCalls { calls } => calls
                        .into_iter()
                        .map(|c| {
                            json!({
                                "functionCall": {
                                    "name": c.name,
                                    "args": c.arguments
                                }
                            })
                        })
                        .collect(),
                    _ => vec![],
                };
                contents.push(json!({ "role": "model", "parts": parts }));
            }
            _ => {}
        }
    }

    // Map URP Tools -> Gemini Tools
    let mut tools = Vec::new();
    if let Some(urp_tools) = payload.available_tools {
        if !urp_tools.is_empty() {
            let function_declarations: Vec<Value> = urp_tools
                .into_iter()
                .map(|t| {
                    json!({
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters
                    })
                })
                .collect();
            tools.push(json!({ "functionDeclarations": function_declarations }));
        }
    }

    let mut request_body = json!({
        "contents": contents,
        "generationConfig": {
            "temperature": 0.7
        }
    });

    if let Some(sys) = system_instruction {
        request_body["systemInstruction"] = sys;
    }
    if !tools.is_empty() {
        request_body["tools"] = json!(tools);
    }

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={}",
        api_key
    );

    let response: Value = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .json()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Parse Gemini Response -> URP Response
    if let Some(error) = response.get("error") {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gemini API Error: {}", error),
        ));
    }

    let candidate = &response["candidates"][0]["content"]["parts"][0];

    let mut urp_tool_calls = Vec::new();
    let mut text_content = None;

    if let Some(func_call) = candidate.get("functionCall") {
        urp_tool_calls.push(UrpToolCall {
            id: format!("call_{}", rand::random::<u32>()), // Generate a mock ID
            name: func_call["name"].as_str().unwrap().to_string(),
            arguments: func_call["args"].clone(),
        });
    } else if let Some(text) = candidate.get("text") {
        text_content = Some(text.as_str().unwrap().to_string());
    }

    Ok(Json(UrpResponse {
        text_content,
        tool_calls: urp_tool_calls,
        usage_metrics: None,
    }))
}

async fn handle_ollama(
    client: &Client,
    payload: UrpRequest,
) -> Result<Json<UrpResponse>, (StatusCode, String)> {
    // Simplified mapping for local Ollama testing
    let mut messages = Vec::new();

    for msg in payload.messages {
        let text = match msg.content {
            UrpMessageContent::Text { text } => text,
            UrpMessageContent::ToolResult { result, .. } => serde_json::to_string(&result).unwrap(),
            _ => continue,
        };
        messages.push(json!({ "role": msg.role, "content": text }));
    }

    let request_body = json!({
        "model": "llama3.2",
        "messages": messages,
        "stream": false,
    });

    let response: Value = client
        .post("http://localhost:11434/api/chat")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .json()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(UrpResponse {
        text_content: Some(response["message"]["content"].as_str().unwrap().to_string()),
        tool_calls: vec![], // Ollama standard API doesn't support structured tools natively exactly like OAI, mock text response
        usage_metrics: None,
    }))
}

#[tokio::main]
async fn main() {
    let _ = dotenv();
    let api_key = env::var("GEMINI_API_KEY").ok();

    if api_key.is_some() {
        println!("Starting URP Server using Google Gemini API");
    } else {
        println!("Starting URP Server using local Ollama (llama3.2)");
    }

    let state = Arc::new(AppState {
        http_client: Client::new(),
        api_key,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::POST])
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/chat", post(handle_urp))
        .layer(cors)
        .with_state(state);

    let addr = "127.0.0.1:3000";
    println!("URP Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
