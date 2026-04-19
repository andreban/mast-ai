mod provider;
mod types;

use agent_rig::model::LlmModel;
use agent_rig::models::gemini::GeminiModel;
use axum::{
    extract::State,
    http::{Method, StatusCode},
    routing::post,
    Json, Router,
};
use dotenvy::dotenv;
use geologia::prelude::{ThinkingConfig, ThinkingLevel};
use std::{env, sync::Arc};
use tower_http::cors::{Any, CorsLayer};

use crate::provider::handle_urp_request;
use crate::types::UrpRequest;

use axum::response::Response;

struct AppState {
    model: Arc<dyn LlmModel>,
}

async fn handle_urp(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UrpRequest>,
) -> Result<Response, (StatusCode, String)> {
    let response = handle_urp_request(Arc::clone(&state.model), payload).await?;
    Ok(response)
}

#[tokio::main]
async fn main() {
    let _ = dotenv();

    let api_key = env::var("GEMINI_API_KEY").expect("GEMINI_API_KEY must be set in .env");

    println!("Initializing URP Server with Gemini (gemini-3.1-flash-lite-preview)");
    let model: Arc<dyn LlmModel> = Arc::new(
        GeminiModel::builder(api_key, "gemini-3.1-flash-lite-preview")
            .thinking_config(ThinkingConfig {
                include_thoughts: true,
                thinking_level: Some(ThinkingLevel::High),
                ..Default::default()
            })
            .temperature(0.7)
            .build(),
    );

    let state = Arc::new(AppState { model });

    // Dev-only: allow all origins. Restrict this before any network-accessible deployment.
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
