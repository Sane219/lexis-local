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
pub struct SourceChunk {
    pub page: u32,
    pub excerpt: String, // first ~200 chars of the chunk, for a citation preview
}

#[derive(Serialize)]
pub struct AskResult {
    pub answer: String,
    pub page: Option<u32>, // page of the top-matching chunk, for liquid navigation
    pub sources: Vec<SourceChunk>, // every chunk fed to the model as context, for citations
}

#[derive(Debug, Serialize, Deserialize)]
struct Hit {
    text: String,
    page: u32,
}

fn excerpt(text: &str) -> String {
    let e: String = text.chars().take(200).collect();
    if text.chars().count() > 200 { format!("{e}…") } else { e }
}

/// Phase4.5: vector search with a BM25 full-text fallback when nothing matches.
/// `doc_id`, when set, scopes both the vector search and the fallback to a
/// single document instead of the whole library.
pub async fn ask(
    db: &Surreal<Db>,
    llm: &dyn Llm,
    question: String,
    doc_id: Option<String>,
) -> Result<AskResult, String> {
    let doc: Option<Thing> = doc_id
        .map(|d| d.parse().map_err(|_| "bad doc id".to_string()))
        .transpose()?;

    let qvec = llm.embed(&question).await?;
    let mut hits: Vec<Hit> = if let Some(doc) = &doc {
        let mut r = db
            .query("SELECT text, page FROM chunks WHERE doc = $doc AND embedding <|5|> $vec")
            .bind(("doc", doc.clone()))
            .bind(("vec", qvec))
            .await
            .map_err(|e| e.to_string())?;
        r.take(0).map_err(|e| e.to_string())?
    } else {
        let mut r = db
            .query("SELECT text, page FROM chunks WHERE embedding <|5|> $vec")
            .bind(("vec", qvec))
            .await
            .map_err(|e| e.to_string())?;
        r.take(0).map_err(|e| e.to_string())?
    };

    if hits.is_empty() {
        hits = if let Some(doc) = &doc {
            let mut r = db
                .query("SELECT text, page FROM chunks WHERE doc = $doc AND text @@ $q LIMIT 5")
                .bind(("doc", doc.clone()))
                .bind(("q", question.clone()))
                .await
                .map_err(|e| e.to_string())?;
            r.take(0).map_err(|e| e.to_string())?
        } else {
            let mut r = db
                .query("SELECT text, page FROM chunks WHERE text @@ $q LIMIT 5")
                .bind(("q", question.clone()))
                .await
                .map_err(|e| e.to_string())?;
            r.take(0).map_err(|e| e.to_string())?
        };
    }
    if hits.is_empty() {
        return Ok(AskResult { answer: "No relevant content found.".into(), page: None, sources: Vec::new() });
    }

    let page = Some(hits[0].page);
    let sources = hits.iter().map(|h| SourceChunk { page: h.page, excerpt: excerpt(&h.text) }).collect();
    let context = hits.iter().map(|h| h.text.as_str()).collect::<Vec<_>>().join("\n---\n");
    let answer = ai::chat(llm, &question, &context).await?;
    Ok(AskResult { answer, page, sources })
}

/// Count all extracted definitions across the whole library (Home's "terms" badge).
pub async fn count_definitions(db: &Surreal<Db>) -> Result<u32, String> {
    #[derive(Deserialize)]
    struct Count { c: u32 }
    let mut r = db
        .query("SELECT count() AS c FROM definitions GROUP ALL")
        .await
        .map_err(|e| e.to_string())?;
    let rows: Vec<Count> = r.take(0).map_err(|e| e.to_string())?;
    Ok(rows.first().map(|c| c.c).unwrap_or(0))
}

/// Count chunks for one document — a cheap "ready for chat" indicator (text was
/// actually embedded, not just extracted).
pub async fn count_chunks(db: &Surreal<Db>, doc_id: String) -> Result<u32, String> {
    let id: Thing = doc_id.parse().map_err(|_| "bad doc id".to_string())?;
    #[derive(Deserialize)]
    struct Count { c: u32 }
    let mut r = db
        .query("SELECT count() AS c FROM chunks WHERE doc = $doc GROUP ALL")
        .bind(("doc", id))
        .await
        .map_err(|e| e.to_string())?;
    let rows: Vec<Count> = r.take(0).map_err(|e| e.to_string())?;
    Ok(rows.first().map(|c| c.c).unwrap_or(0))
}

/// Delete a document and everything derived from it. `same_term` edges pointing
/// at its definitions are left dangling — ponytail: harmless (edges are only
/// ever traversed from a definitions row, and this doc's are gone), clean up if
/// cross-doc links ever need edge-count accuracy.
pub async fn delete_document(db: &Surreal<Db>, doc_id: String) -> Result<(), String> {
    let id: Thing = doc_id.parse().map_err(|_| "bad doc id".to_string())?;
    db.query(
        "DELETE chunks WHERE doc = $doc;
         DELETE definitions WHERE doc = $doc;
         DELETE sections WHERE doc = $doc;
         DELETE refs WHERE doc = $doc;
         DELETE chat_messages WHERE doc = $doc;
         DELETE simplifications WHERE doc = $doc;
         DELETE $doc;",
    )
    .bind(("doc", id))
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
struct SearchRow {
    text: String,
    page: u32,
    doc_id: Thing,
    doc_name: String,
}

#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub doc_id: String,
    pub doc_name: String,
    pub page: u32,
    pub excerpt: String,
}

/// Library-wide full-text search over every ingested document's chunks, via the
/// BM25 index already built for `ask`'s fallback path.
pub async fn search_chunks(
    db: &Surreal<Db>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let lim = limit.unwrap_or(20).min(100);
    let mut r = db
        .query("SELECT text, page, doc.id AS doc_id, doc.name AS doc_name FROM chunks WHERE text @@ $q LIMIT $lim")
        .bind(("q", query))
        .bind(("lim", lim))
        .await
        .map_err(|e| e.to_string())?;
    let rows: Vec<SearchRow> = r.take(0).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| SearchHit {
            doc_id: row.doc_id.to_string(),
            doc_name: row.doc_name,
            page: row.page,
            excerpt: excerpt(&row.text),
        })
        .collect())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessageRow {
    pub question: String,
    pub answer: String,
    pub page: Option<u32>,
}

/// Persist one chat turn. `doc_id` scopes history per-document; `None` files it
/// under the global (no-document-selected) thread.
pub async fn save_chat_message(
    db: &Surreal<Db>,
    doc_id: Option<String>,
    question: String,
    answer: String,
    page: Option<u32>,
) -> Result<(), String> {
    let doc: Option<Thing> = doc_id.map(|d| d.parse().map_err(|_| "bad doc id".to_string())).transpose()?;
    db.query("CREATE chat_messages SET doc = $doc, question = $question, answer = $answer, page = $page")
        .bind(("doc", doc))
        .bind(("question", question))
        .bind(("answer", answer))
        .bind(("page", page))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn list_chat_messages(db: &Surreal<Db>, doc_id: Option<String>) -> Result<Vec<ChatMessageRow>, String> {
    let doc: Option<Thing> = doc_id.map(|d| d.parse().map_err(|_| "bad doc id".to_string())).transpose()?;
    let mut r = if let Some(doc) = doc {
        db.query("SELECT question, answer, page FROM chat_messages WHERE doc = $doc ORDER BY created_at ASC")
            .bind(("doc", doc))
            .await
            .map_err(|e| e.to_string())?
    } else {
        db.query("SELECT question, answer, page FROM chat_messages WHERE doc IS NONE ORDER BY created_at ASC")
            .await
            .map_err(|e| e.to_string())?
    };
    r.take(0).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SimplificationRow {
    pub page: u32,
    pub original: String,
    pub simplified: String,
}

pub async fn save_simplification(
    db: &Surreal<Db>,
    doc_id: String,
    page: u32,
    original: String,
    simplified: String,
) -> Result<(), String> {
    let doc: Thing = doc_id.parse().map_err(|_| "bad doc id".to_string())?;
    db.query("CREATE simplifications SET doc = $doc, page = $page, original = $original, simplified = $simplified")
        .bind(("doc", doc))
        .bind(("page", page))
        .bind(("original", original))
        .bind(("simplified", simplified))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn list_simplifications(db: &Surreal<Db>, doc_id: String) -> Result<Vec<SimplificationRow>, String> {
    let doc: Thing = doc_id.parse().map_err(|_| "bad doc id".to_string())?;
    let mut r = db
        .query("SELECT page, original, simplified FROM simplifications WHERE doc = $doc ORDER BY created_at ASC")
        .bind(("doc", doc))
        .await
        .map_err(|e| e.to_string())?;
    r.take(0).map_err(|e| e.to_string())
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

        let res = ask(&db, &llm, "seed chunk text".to_string(), None).await.unwrap();
        assert_eq!(res.page, Some(3));
        assert!(res.answer.starts_with("ans:"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
