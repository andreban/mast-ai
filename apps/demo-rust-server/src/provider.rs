use crate::types::{UrpMessageContent, UrpRequest, UrpResponse, UrpStreamChunk, UrpToolCall};
use agent_rig::model::{
    LlmModel, Message, MessageContent, ModelRequest, ModelStreamChunk, Role, ToolCall,
};
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
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

pub async fn handle_urp_request(
    model: Arc<Box<dyn LlmModel>>,
    payload: UrpRequest,
) -> Result<Response, (StatusCode, String)> {
    // 1. Identify the system prompt if present in messages and map URP messages
    let mut rig_messages = Vec::new();
    let mut system_prompt = None;

    let is_streaming = payload.stream;

    for msg in payload.messages {
        let role = match msg.role.as_str() {
            "user" => Role::User,
            "assistant" => Role::Assistant,
            "system" => {
                if let UrpMessageContent::Text { text } = msg.content {
                    system_prompt = Some(text);
                }
                continue; // System prompt handled separately, skip adding to general history
            }
            _ => Role::User, // Fallback
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

    // 2. Build ModelRequest
    let request = ModelRequest {
        messages: rig_messages,
        system: system_prompt,
        tools: payload.available_tools.unwrap_or_default(),
        output_schema: None,
    };

    // 3. Initialize and run generic model
    if is_streaming {
        let (tx, rx) = mpsc::channel(100);

        tokio::spawn(async move {
            let mut response_stream = model.generate_stream(request);

            while let Some(event) = response_stream.next().await {
                let chunk = match event {
                    Ok(ModelStreamChunk::TextDelta(delta)) => {
                        Some(UrpStreamChunk::TextDelta { delta })
                    }
                    Ok(ModelStreamChunk::Thinking(delta)) => {
                        Some(UrpStreamChunk::Thinking { delta })
                    }
                    Ok(ModelStreamChunk::ToolCall(tc)) => Some(UrpStreamChunk::ToolCall {
                        tool_call: UrpToolCall {
                            id: tc.id,
                            name: tc.name,
                            arguments: tc.args,
                        },
                    }),
                    _ => None, // Ignore errors or other types for simplicity
                };
                if let Some(c) = chunk {
                    let json_str = serde_json::to_string(&c).unwrap();
                    if tx
                        .send(Ok::<_, Infallible>(Event::default().data(json_str)))
                        .await
                        .is_err()
                    {
                        break; // Receiver dropped
                    }
                }
            }
            // Signal the end of the stream for the client parser
            let _ = tx
                .send(Ok::<_, Infallible>(Event::default().data("[DONE]")))
                .await;
        });

        Ok(Sse::new(ReceiverStream::new(rx)).into_response())
    } else {
        let response = model.generate(request).await.map_err(|e| {
            eprintln!("Model execution failed: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Model execution failed: {}", e),
            )
        })?;

        let urp_tool_calls: Vec<agent_rig::model::ToolCall> = response
            .tool_calls
            .into_iter()
            .map(|c| agent_rig::model::ToolCall::new(c.id, c.name, c.args))
            .collect();

        // 4. Map Agent-Rig Response -> URP Response
        Ok(Json(UrpResponse {
            text_content: response.text,
            tool_calls: urp_tool_calls,
            usage_metrics: None,
        })
        .into_response())
    }
}
