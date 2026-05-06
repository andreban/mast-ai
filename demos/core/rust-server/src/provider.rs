// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

use crate::types::{UrpMessageContent, UrpRequest, UrpResponse, UrpStreamChunk, UrpToolCall};
use agent_rig::model::{
    LlmModel, Message, MessageContent, ModelRequest, ModelStreamChunk, Role, ToolCall,
};
use async_stream::stream;
use axum::{
    http::StatusCode,
    response::{
        sse::{Event, Sse},
        IntoResponse, Response,
    },
    Json,
};
use futures_util::StreamExt;
use std::convert::Infallible;
use std::sync::Arc;

pub async fn handle_urp_request(
    model: Arc<dyn LlmModel>,
    payload: UrpRequest,
) -> Result<Response, (StatusCode, String)> {
    let (request, is_streaming) = build_model_request(payload)?;

    if is_streaming {
        handle_streaming(model, request).await
    } else {
        handle_non_streaming(model, request).await
    }
}

fn build_model_request(payload: UrpRequest) -> Result<(ModelRequest, bool), (StatusCode, String)> {
    let mut rig_messages = Vec::new();
    let mut system_prompt = None;

    for msg in payload.messages {
        let role = match msg.role.as_str() {
            "user" => Role::User,
            "assistant" => Role::Assistant,
            "system" => {
                if let UrpMessageContent::Text { text } = msg.content {
                    system_prompt = Some(text);
                }
                continue;
            }
            other => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!("Unknown message role: {other}"),
                ));
            }
        };

        match msg.content {
            UrpMessageContent::Text { text } => {
                rig_messages.push(Message {
                    role,
                    content: MessageContent::Text(text),
                });
            }
            UrpMessageContent::ToolCalls { calls } => {
                let rig_calls = calls
                    .into_iter()
                    .map(|c| ToolCall::new(c.id, c.name, c.arguments))
                    .collect();
                rig_messages.push(Message {
                    role,
                    content: MessageContent::ToolCalls(rig_calls),
                });
            }
            UrpMessageContent::ToolResult { id, name, result } => {
                rig_messages.push(Message::tool_result(id, name, result, None));
            }
        }
    }

    let request = ModelRequest {
        messages: rig_messages,
        system: system_prompt,
        tools: payload.available_tools.unwrap_or_default(),
        output_schema: None,
    };

    Ok((request, payload.stream))
}

async fn handle_streaming(
    model: Arc<dyn LlmModel>,
    request: ModelRequest,
) -> Result<Response, (StatusCode, String)> {
    let sse_stream = stream! {
        let mut response_stream = model.generate_stream(request);

        while let Some(event) = response_stream.next().await {
            let chunk = match event {
                Ok(ModelStreamChunk::TextDelta(delta)) => UrpStreamChunk::TextDelta { delta },
                Ok(ModelStreamChunk::Thinking(delta)) => UrpStreamChunk::Thinking { delta },
                Ok(ModelStreamChunk::ToolCall(tc)) => UrpStreamChunk::ToolCall {
                    tool_call: UrpToolCall {
                        id: tc.id,
                        name: tc.name,
                        arguments: tc.args,
                    },
                },
                Err(e) => {
                    eprintln!("Stream error: {:?}", e);
                    UrpStreamChunk::Error { message: e.to_string() }
                }
            };

            match serde_json::to_string(&chunk) {
                Ok(json) => yield Ok::<_, Infallible>(Event::default().data(json)),
                Err(e) => eprintln!("Failed to serialize stream chunk: {:?}", e),
            }
        }

        yield Ok::<_, Infallible>(Event::default().data("[DONE]"));
    };

    Ok(Sse::new(sse_stream).into_response())
}

async fn handle_non_streaming(
    model: Arc<dyn LlmModel>,
    request: ModelRequest,
) -> Result<Response, (StatusCode, String)> {
    let response = model.generate(request).await.map_err(|e| {
        eprintln!("Model execution failed: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Model execution failed: {}", e),
        )
    })?;

    Ok(Json(UrpResponse {
        text_content: response.text,
        tool_calls: response.tool_calls,
        usage_metrics: None,
    })
    .into_response())
}
