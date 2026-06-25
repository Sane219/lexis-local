// Talks to a local llama.cpp server (OpenAI-compatible endpoints).
// ponytail: assumes one `llama-server` is already running and serving both
// /v1/embeddings and /v1/chat/completions. Sidecar spawn + GGUF auto-download
// is deferred — add a tauri-plugin-shell sidecar in lib.rs setup() when bundling.
use serde::Deserialize;
use std::sync::OnceLock;

pub const EMBED_DIM: usize = 768; // nomic-embed-text-v1.5; must match the M-TREE index

// Base URL of the llama.cpp server. Set once at boot to the auto-spawned
// sidecar's port (lib.rs); falls back to :8080 for a manually-run server.
static BASE_URL: OnceLock<String> = OnceLock::new();

pub fn set_base_url(url: String) {
    let _ = BASE_URL.set(url);
}

fn base_url() -> String {
    BASE_URL
        .get()
        .cloned()
        .unwrap_or_else(|| "http://localhost:8080".into())
}

#[derive(Deserialize)]
struct EmbedResp {
    data: Vec<EmbedData>,
}
#[derive(Deserialize)]
struct EmbedData {
    embedding: Vec<f32>,
}

pub async fn embed(text: &str) -> Result<Vec<f32>, String> {
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
}

#[derive(Deserialize)]
struct ChatResp {
    choices: Vec<Choice>,
}
#[derive(Deserialize)]
struct Choice {
    message: Message,
}
#[derive(Deserialize)]
struct Message {
    content: String,
}

/// One-shot chat completion for an arbitrary prompt.
pub async fn complete(prompt: &str) -> Result<String, String> {
    let resp: ChatResp = reqwest::Client::new()
        .post(format!("{}/v1/chat/completions", base_url()))
        .json(&serde_json::json!({
            "messages": [{ "role": "user", "content": prompt }],
            "stream": false
        }))
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

pub async fn chat(question: &str, context: &str) -> Result<String, String> {
    complete(&format!(
        "Answer the question using only the context below. If the answer isn't there, say so.\n\nContext:\n{context}\n\nQuestion: {question}"
    ))
    .await
}

#[derive(Deserialize, serde::Serialize)]
pub struct Definition {
    pub term: String,
    pub explanation: String,
}

/// Ask the LLM to pull key term definitions out of the document text.
/// ponytail: one call over the first 6k chars, best-effort JSON parse — a doc
/// that buries definitions past 6k or returns junk just yields fewer/none.
pub async fn extract_definitions(text: &str) -> Result<Vec<Definition>, String> {
    let head: String = text.chars().take(6000).collect();
    let prompt = format!(
        "Extract key terms and their definitions from this text. Reply with ONLY a JSON array of {{\"term\",\"explanation\"}} objects, no prose.\n\n{head}"
    );
    let raw = complete(&prompt).await?;
    Ok(parse_json_array(&raw))
}

pub async fn detect_anomalies(text: &str) -> Result<String, String> {
    let head: String = text.chars().take(8000).collect();
    complete(&format!(
        "Review this document for contradictions, missing clauses, or unusual language. List concise bullet points; say 'None found' if clean.\n\n{head}"
    ))
    .await
}

/// Tolerant parse of an LLM JSON-array reply: strips ``` fences and slices to
/// the outermost [ ... ]. Returns empty on anything unparseable.
fn parse_json_array<T: serde::de::DeserializeOwned>(raw: &str) -> Vec<T> {
    let trimmed = raw.trim().trim_start_matches("```json").trim_matches('`');
    let slice = match (trimmed.find('['), trimmed.rfind(']')) {
        (Some(a), Some(b)) if b > a => &trimmed[a..=b],
        _ => return Vec::new(),
    };
    serde_json::from_str(slice).unwrap_or_default()
}

pub struct Chunk {
    pub text: String,
    pub page: u32, // 1-based; pages are delimited by form-feed (\x0c) from pdf-extract
}

/// Split text into overlapping char windows (1024 chars, 128 overlap), tagging
/// each with the page it starts on (form-feeds seen before its start + 1).
pub fn chunk_text(raw: &str) -> Vec<Chunk> {
    let chars: Vec<char> = raw.chars().collect();
    let (size, overlap) = (1024, 128);
    let mut out = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let end = (start + size).min(chars.len());
        let text: String = chars[start..end].iter().collect();
        if !text.trim().is_empty() {
            let page = chars[..start].iter().filter(|&&c| c == '\x0c').count() as u32 + 1;
            out.push(Chunk { text, page });
        }
        if end == chars.len() {
            break;
        }
        start += size - overlap;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::chunk_text;
    #[test]
    fn chunks_overlap_cover_and_track_pages() {
        let text = format!("{}\x0c{}", "a".repeat(1500), "b".repeat(1000));
        let chunks = chunk_text(&text);
        assert_eq!(chunks[0].page, 1);
        assert_eq!(chunks[0].text.chars().count(), 1024);
        // a later chunk starts after the form-feed -> page 2
        assert!(chunks.iter().any(|c| c.page == 2));
    }
}
