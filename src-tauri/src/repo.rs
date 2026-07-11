// Read-side queries, extracted from commands.rs so the Tauri commands become
// thin adapters. Every function here is the test surface: tests hit the repo,
// not the IPC layer. Leverage: one error-mapping seam, N call sites.
use serde::{Deserialize, Serialize};
use surrealdb::engine::local::Db;
use surrealdb::sql::Thing;
use surrealdb::Surreal;

use crate::ai::{self, Llm};
use crate::documents::{DocInfo, DocRecord};
use crate::pipeline::{Definition, Reference, Section};

pub async fn list_documents(db: &Surreal<Db>) -> Result<Vec<DocInfo>, String> {
    let mut response = db
        .query("SELECT * FROM documents ORDER BY created_at DESC")
        .await
        .map_err(|e| e.to_string())?;
    let records: Vec<DocRecord> = response.take(0).map_err(|e| e.to_string())?;
    Ok(records.into_iter().map(DocInfo::from_record).collect())
}

pub async fn list_sections(
    db: &Surreal<Db>,
    doc_id: String,
) -> Result<Vec<Section>, String> {
    let id: Thing = doc_id.parse().map_err(|_| "bad doc id".to_string())?;
    let mut response = db
        .query("SELECT label, page FROM sections WHERE doc = $doc")
        .bind(("doc", id))
        .await
        .map_err(|e| e.to_string())?;
    response.take(0).map_err(|e| e.to_string())
}

pub async fn list_references(
    db: &Surreal<Db>,
    doc_id: String,
) -> Result<Vec<Reference>, String> {
    let id: Thing = doc_id.parse().map_err(|_| "bad doc id".to_string())?;
    let mut response = db
        .query("SELECT source_label, target_label, page FROM refs WHERE doc = $doc")
        .bind(("doc", id))
        .await
        .map_err(|e| e.to_string())?;
    response.take(0).map_err(|e| e.to_string())
}

pub async fn list_definitions(
    db: &Surreal<Db>,
    doc_id: String,
) -> Result<Vec<Definition>, String> {
    let id: Thing = doc_id.parse().map_err(|_| "bad doc id".to_string())?;
    let mut response = db
        .query("SELECT term, explanation FROM definitions WHERE doc = $doc")
        .bind(("doc", id))
        .await
        .map_err(|e| e.to_string())?;
    response.take(0).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct AskResult {
    pub answer: String,
    pub page: Option<u32>, // page of the top-matching chunk, for liquid navigation
}

#[derive(Debug, Serialize, Deserialize)]
struct Hit {
    text: String,
    page: u32,
}

/// Phase4.5: vector search with a BM25 full-text fallback when nothing matches.
pub async fn ask(
    db: &Surreal<Db>,
    llm: &dyn Llm,
    question: String,
) -> Result<AskResult, String> {
    let qvec = llm.embed(&question).await?;
    let mut response = db
        .query("SELECT text, page FROM chunks WHERE embedding <|5|> $vec")
        .bind(("vec", qvec))
        .await
        .map_err(|e| e.to_string())?;
    let mut hits: Vec<Hit> = response.take(0).map_err(|e| e.to_string())?;

    if hits.is_empty() {
        let mut r = db
            .query("SELECT text, page FROM chunks WHERE text @@ $q LIMIT 5")
            .bind(("q", question.clone()))
            .await
            .map_err(|e| e.to_string())?;
        hits = r.take(0).map_err(|e| e.to_string())?;
    }
    if hits.is_empty() {
        return Ok(AskResult { answer: "No relevant content found.".into(), page: None });
    }

    let page = Some(hits[0].page);
    let context = hits.iter().map(|h| h.text.as_str()).collect::<Vec<_>>().join("\n---\n");
    let answer = ai::chat(llm, &question, &context).await?;
    Ok(AskResult { answer, page })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OtherDef {
    pub term: String,
    pub explanation: String,
    pub doc_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CrossLink {
    pub term: String,
    pub explanation: String,
    pub matches: Vec<OtherDef>,
}

/// Phase4.4: surface the cross-document definition graph for one doc by
/// traversing the `same_term` edges written at ingest.
pub async fn cross_doc_links(
    db: &Surreal<Db>,
    doc_id: String,
) -> Result<Vec<CrossLink>, String> {
    let id: Thing = doc_id.parse().map_err(|_| "bad doc id".to_string())?;
    let mut response = db
        .query(
            "SELECT term, explanation,
                    (->same_term->definitions.{ term, explanation, doc_name: doc.name }) AS matches
             FROM definitions WHERE doc = $doc",
        )
        .bind(("doc", id))
        .await
        .map_err(|e| e.to_string())?;
    response.take(0).map_err(|e| e.to_string())
}

/// Fetch raw text for a doc, then run anomaly detection through the LLM.
pub async fn detect_anomalies(
    db: &Surreal<Db>,
    llm: &dyn Llm,
    doc_id: String,
) -> Result<String, String> {
    let id: Thing = doc_id.parse().map_err(|_| "bad doc id".to_string())?;
    let mut response = db
        .query("SELECT * FROM documents WHERE id = $doc")
        .bind(("doc", id))
        .await
        .map_err(|e| e.to_string())?;
    let mut docs: Vec<DocRecord> = response.take(0).map_err(|e| e.to_string())?;
    let doc = docs.pop().ok_or_else(|| "document not found".to_string())?;
    ai::detect_anomalies(llm, &doc.raw_text).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::tests::FakeLlm;
    use crate::db;
    use serde_json::json;

    // Drives the full ask orchestration (embed -> KNN -> context -> chat)
    // through the Llm seam against a real in-memory SurrealKv — no server.
    #[tokio::test]
    async fn ask_through_seam_hits_stored_chunk() {
        #[derive(serde::Deserialize)]
        struct ChunkRow {
            id: surrealdb::sql::Thing,
        }

        let dir = std::env::temp_dir().join(format!("lexis-integ-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let db = db::init_db(&dir).await.expect("init db");
        let llm = FakeLlm;

        let mut r = db
            .query("CREATE documents SET name = 't', page_count = 1, raw_text = 'x'")
            .await
            .expect("create document");
        let docs: Vec<DocRecord> = r.take(0).expect("take document");
        let id = docs[0].id.clone();
        let emb = llm.embed("seed chunk text").await.unwrap();

        let mut r2 = db
            .query(
                "CREATE chunks SET doc = $id, text = 'seed chunk text', page = 3, embedding = $emb",
            )
            .bind(("id", id))
            .bind(("emb", emb))
            .await
            .expect("create chunk");
        let chunks: Vec<ChunkRow> = r2.take(0).expect("take chunk");
        assert!(!chunks.is_empty());

        let res = ask(&db, &llm, "seed chunk text".to_string()).await.unwrap();
        assert_eq!(res.page, Some(3));
        assert!(res.answer.starts_with("ans:"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
