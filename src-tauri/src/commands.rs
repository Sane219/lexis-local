use serde::{Deserialize, Serialize};
use surrealdb::engine::local::Db;
use surrealdb::sql::Thing;
use surrealdb::Surreal;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize, Deserialize)]
pub struct DocRecord {
    pub id: Thing,
    pub name: String,
    pub page_count: u32,
    pub raw_text: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct DocInfo {
    pub id: String,
    pub name: String,
    pub page_count: u32,
    pub raw_text: String,
    pub created_at: String,
}

#[derive(Serialize)]
struct NewDocument {
    name: String,
    page_count: u32,
    raw_text: String,
}

#[tauri::command]
pub async fn ingest_pdf(
    db: State<'_, Surreal<Db>>,
    name: String,
    bytes: Vec<u8>,
) -> Result<DocInfo, String> {
    let text = pdf_extract::extract_text_from_mem(&bytes).map_err(|e| e.to_string())?;
    let page_count = text.matches('\x0c').count() as u32 + 1;

    let doc = NewDocument {
        name,
        page_count,
        raw_text: text,
    };

    let created: Option<DocRecord> = db
        .create("documents")
        .content(doc)
        .await
        .map_err(|e| e.to_string())?;

    let record = created.ok_or_else(|| "failed to create document record".to_string())?;

    // Chunk + embed for RAG. ponytail: synchronous, one embed call per chunk —
    // batch the /v1/embeddings input array if ingest latency becomes a problem.
    for chunk in crate::ai::chunk_text(&record.raw_text) {
        let embedding = crate::ai::embed(&chunk.text).await?;
        let _: Option<serde_json::Value> = db
            .create("chunks")
            .content(serde_json::json!({
                "doc": record.id.clone(),
                "text": chunk.text,
                "page": chunk.page,
                "embedding": embedding,
            }))
            .await
            .map_err(|e| e.to_string())?;
    }

    // Phase 3: extract definitions once at ingest. ponytail: best-effort — a
    // failed extraction logs nothing and just leaves the doc without definitions.
    if let Ok(defs) = crate::ai::extract_definitions(&record.raw_text).await {
        for def in defs {
            let _: Option<serde_json::Value> = db
                .create("definitions")
                .content(serde_json::json!({
                    "doc": record.id.clone(),
                    "term": def.term,
                    "explanation": def.explanation,
                }))
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    // Phase 3 (graph edges) + 4.4 (multi-doc merge): link this doc's definitions
    // to same-term definitions in *other* docs via `same_term` edges, both
    // directions so either side can traverse the link regardless of ingest order.
    db
        .query(
            "LET $defs = SELECT * FROM definitions WHERE doc = $doc;
             FOR $d IN $defs {
               LET $matches = SELECT * FROM definitions WHERE doc != $doc AND lower(term) = lower($d.term);
               FOR $m IN $matches {
                 RELATE $d -> same_term -> $m;
                 RELATE $m -> same_term -> $d;
               }
             }",
        )
        .bind(("doc", record.id.clone()))
        .await
        .map_err(|e| e.to_string())?;

    // Phase 3.6: internal section headings + cross-references, pure-regex (no LLM).
    let (sections, references) = crate::ai::extract_sections(&record.raw_text);
    for s in sections {
        let _: Option<serde_json::Value> = db
            .create("sections")
            .content(serde_json::json!({
                "doc": record.id.clone(),
                "label": s.label,
                "page": s.page,
            }))
            .await
            .map_err(|e| e.to_string())?;
    }
    for r in references {
        let _: Option<serde_json::Value> = db
            .create("refs")
            .content(serde_json::json!({
                "doc": record.id.clone(),
                "source_label": r.source_label,
                "target_label": r.target_label,
                "page": r.page,
            }))
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(DocInfo {
        id: record.id.to_string(),
        name: record.name,
        page_count: record.page_count,
        raw_text: record.raw_text,
        created_at: record.created_at,
    })
}

#[tauri::command]
pub async fn list_sections(
    db: State<'_, Surreal<Db>>,
    doc_id: String,
) -> Result<Vec<crate::ai::Section>, String> {
    let id: Thing = doc_id.parse().map_err(|_| "bad doc id".to_string())?;
    let mut response = db
        .query("SELECT label, page FROM sections WHERE doc = $doc")
        .bind(("doc", id))
        .await
        .map_err(|e| e.to_string())?;
    response.take(0).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_references(
    db: State<'_, Surreal<Db>>,
    doc_id: String,
) -> Result<Vec<crate::ai::Reference>, String> {
    let id: Thing = doc_id.parse().map_err(|_| "bad doc id".to_string())?;
    let mut response = db
        .query("SELECT source_label, target_label, page FROM refs WHERE doc = $doc")
        .bind(("doc", id))
        .await
        .map_err(|e| e.to_string())?;
    response.take(0).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct Hit {
    text: String,
    page: u32,
}

#[derive(Serialize)]
pub struct AskResult {
    answer: String,
    page: Option<u32>, // page of the top-matching chunk, for liquid navigation
}

#[tauri::command]
pub async fn ask(db: State<'_, Surreal<Db>>, question: String) -> Result<AskResult, String> {
    let qvec = crate::ai::embed(&question).await?;
    let mut response = db
        .query("SELECT text, page FROM chunks WHERE embedding <|5|> $vec")
        .bind(("vec", qvec))
        .await
        .map_err(|e| e.to_string())?;
    let mut hits: Vec<Hit> = response.take(0).map_err(|e| e.to_string())?;

    // Phase 4.5: full-text fallback when vector search finds nothing relevant.
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
    let answer = crate::ai::chat(&question, &context).await?;
    Ok(AskResult { answer, page })
}

#[tauri::command]
pub async fn list_definitions(
    db: State<'_, Surreal<Db>>,
    doc_id: String,
) -> Result<Vec<crate::ai::Definition>, String> {
    let id: Thing = doc_id.parse().map_err(|_| "bad doc id".to_string())?;
    let mut response = db
        .query("SELECT term, explanation FROM definitions WHERE doc = $doc")
        .bind(("doc", id))
        .await
        .map_err(|e| e.to_string())?;
    response.take(0).map_err(|e| e.to_string())
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

/// Phase 4.4: surface the cross-document definition graph for one doc by
/// traversing the `same_term` edges written at ingest. Returns each term
/// defined here with the matching terms found in other documents.
#[tauri::command]
pub async fn cross_doc_links(
    db: State<'_, Surreal<Db>>,
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

#[tauri::command]
pub async fn detect_anomalies(db: State<'_, Surreal<Db>>, doc_id: String) -> Result<String, String> {
    let id: Thing = doc_id.parse().map_err(|_| "bad doc id".to_string())?;
    let mut response = db
        .query("SELECT * FROM documents WHERE id = $doc")
        .bind(("doc", id))
        .await
        .map_err(|e| e.to_string())?;
    let mut docs: Vec<DocRecord> = response.take(0).map_err(|e| e.to_string())?;
    let doc = docs.pop().ok_or_else(|| "document not found".to_string())?;
    crate::ai::detect_anomalies(&doc.raw_text).await
}

#[tauri::command]
pub async fn simplify_text(text: String) -> Result<String, String> {
    crate::ai::complete_with_system(
        "You are a helpful assistant that simplifies complex text into plain English. \
         Keep all key information but make it concise and easy to understand. \
         Never add information not in the original text.",
        &text,
    )
    .await
}

#[tauri::command]
pub async fn download_model_llmfit(app: AppHandle, query: String) -> Result<String, String> {
    use tauri_plugin_shell::process::CommandEvent;

    let (mut rx, child) = app
        .shell()
        .command("llmfit")
        .args(["download", &query])
        .spawn()
        .map_err(|e| format!("failed to spawn llmfit: {e}"))?;

    let app_ = app.clone();
    tauri::async_runtime::spawn(async move {
        let _child = child;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim().to_string();
                    if !line.is_empty() {
                        let _ = app_.emit("llmfit-progress", line);
                    }
                }
                CommandEvent::Terminated(payload) => {
                    let ok = payload.code == Some(0);
                    if ok {
                        let _ = app_.emit("llmfit-done", "");
                    } else {
                        let _ = app_.emit("llmfit-error", format!("exited with code {:?}", payload.code));
                    }
                    break;
                }
                CommandEvent::Error(e) => {
                    let _ = app_.emit("llmfit-error", e);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(format!("Started downloading {query}"))
}

#[tauri::command]
pub async fn list_documents(db: State<'_, Surreal<Db>>) -> Result<Vec<DocInfo>, String> {
    let mut response = db
        .query("SELECT * FROM documents ORDER BY created_at DESC")
        .await
        .map_err(|e| e.to_string())?;

    let records: Vec<DocRecord> = response.take(0).map_err(|e| e.to_string())?;

    Ok(records
        .into_iter()
        .map(|r| DocInfo {
            id: r.id.to_string(),
            name: r.name,
            page_count: r.page_count,
            raw_text: r.raw_text,
            created_at: r.created_at,
        })
        .collect())
}
