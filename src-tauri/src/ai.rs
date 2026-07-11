// Talks to a local llama.cpp server (OpenAI-compatible endpoints) through an
// `Llm` adapter. The concrete `HttpLlm` is the production adapter; tests can
// pass any `Llm` implementation, so orchestration is exercisable without a
// live server. ponytail: only one adapter exists today (HTTP) — the trait is
// the seam that makes the second (in-memory fake) real, not speculative.
use crate::pipeline::{Definition, parse_json_array};
use std::future::Future;
use std::pin::Pin;

pub const EMBED_DIM: usize = 768; // nomic-embed-text-v1.5; must match the M-TREE index

// Base URL of the llama.cpp server. Set once at boot to the auto-spawned
// sidecar's port (lib.rs); falls back to :8080 for a manually-run server.
static BASE_URL: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub fn set_base_url(url: String) {
    let _ = BASE_URL.set(url);
}

fn base_url() -> String {
    BASE_URL
        .get()
        .cloned()
        .unwrap_or_else(|| "http://localhost:8080".into())
}

/// The LLM seam. Every backend call that touches llama-server goes through
/// this, so a fake can stand in for tests.
pub trait Llm: Send + Sync {
    fn embed<'a>(
        &'a self,
        text: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<f32>, String>> + Send + 'a>>;
    fn complete<'a>(
        &'a self,
        prompt: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>>;
    fn complete_with_system<'a>(
        &'a self,
        system: &'a str,
        user: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>>;
}

/// Production adapter: HTTP to a llama.cpp server.
pub struct HttpLlm;

impl Llm for HttpLlm {
    fn embed<'a>(
        &'a self,
        text: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<f32>, String>> + Send + 'a>> {
        Box::pin(async move {
            #[derive(serde::Deserialize)]
            struct EmbedResp {
                data: Vec<EmbedData>,
            }
            #[derive(serde::Deserialize)]
            struct EmbedData {
                embedding: Vec<f32>,
            }
            let resp: EmbedResp = reqwest::Client::new()
                .post(format!("{}/v1/embeddings", base_url()))
                .json(&serde_json::json!({ "input": text }))
                .send()
                .await
                .map_err(|e| format!("embed request failed (is llama-server running?): {e}"))?
                .json()
                .await
                .map_err(|e| e.to_string())?;
            resp.data
                .into_iter()
                .next()
                .map(|d| d.embedding)
                .ok_or_else(|| "empty embedding response".into())
        })
    }

    fn complete<'a>(
        &'a self,
        prompt: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
        Box::pin(complete_http(vec![("role", prompt)]))
    }

    fn complete_with_system<'a>(
        &'a self,
        system: &'a str,
        user: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
        Box::pin(complete_http(vec![("role", system), ("role", user)]))
    }
}

#[derive(serde::Deserialize)]
struct ChatResp {
    choices: Vec<Choice>,
}
#[derive(serde::Deserialize)]
struct Choice {
    message: Message,
}
#[derive(serde::Deserialize)]
struct Message {
    content: String,
}

async fn complete_http(messages: Vec<(&str, &str)>) -> Result<String, String> {
    let body: Vec<serde_json::Value> = messages
        .iter()
        .map(|(role, content)| serde_json::json!({ "role": role, "content": content }))
        .collect();
    let resp: ChatResp = reqwest::Client::new()
        .post(format!("{}/v1/chat/completions", base_url()))
        .json(&serde_json::json!({ "messages": body, "stream": false }))
        .send()
        .await
        .map_err(|e| format!("chat request failed (is llama-server running?): {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    resp.choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or_else(|| "empty chat response".into())
}

/// One-shot RAG answer from a question + assembled context.
pub async fn chat(llm: &dyn Llm, question: &str, context: &str) -> Result<String, String> {
    llm.complete(&format!(
        "Answer the question using only the context below. If the answer isn't there, say so.\n\nContext:\n{context}\n\nQuestion: {question}"
    ))
    .await
}

/// Ask the LLM to pull key term definitions out of the document text.
/// ponytail: one call over the first 6k chars, best-effort JSON parse — a doc
/// that buries definitions past 6k or returns junk just yields fewer/none.
pub async fn extract_definitions(
    llm: &dyn Llm,
    text: &str,
) -> Result<Vec<Definition>, String> {
    let head: String = text.chars().take(6000).collect();
    let prompt = format!(
        "Extract key terms and their definitions from this text. Reply with ONLY a JSON array of {{\"term\",\"explanation\"}} objects, no prose.\n\n{head}"
    );
    let raw = llm.complete(&prompt).await?;
    Ok(parse_json_array(&raw))
}

pub async fn detect_anomalies(llm: &dyn Llm, text: &str) -> Result<String, String> {
    let head: String = text.chars().take(8000).collect();
    llm.complete(&format!(
        "Review this document for contradictions, missing clauses, or unusual language. List concise bullet points; say 'None found' if clean.\n\n{head}"
    ))
    .await
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    // In-memory fake: deterministic embeddings + canned chat, so orchestration
    // (ingest, ask) can be exercised without a llama-server.
    pub(crate) struct FakeLlm;
    impl Llm for FakeLlm {
        fn embed<'a>(
            &'a self,
            text: &'a str,
        ) -> Pin<Box<dyn Future<Output = Result<Vec<f32>, String>> + Send + 'a>> {
            // Match the schema's EMBED_DIM so stored vectors pass the M-TREE index.
            Box::pin(async move { Ok(vec![text.len() as f32; EMBED_DIM]) })
        }
        fn complete<'a>(
            &'a self,
            prompt: &'a str,
        ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
            Box::pin(async move { Ok(format!("ans:{prompt}")) })
        }
        fn complete_with_system<'a>(
            &'a self,
            _system: &'a str,
            user: &'a str,
        ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
            Box::pin(async move { Ok(format!("sys:{user}")) })
        }
    }

    #[tokio::test]
    async fn fake_llm_seam_works() {
        let llm = FakeLlm;
        let v = llm.embed("hi").await.unwrap();
        assert_eq!(v.len(), EMBED_DIM);
        let a = chat(&llm, "q", "ctx").await.unwrap();
        assert!(a.starts_with("ans:"));
    }
}
