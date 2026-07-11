// Deepened ingest pipeline. Previously `ingest_pdf` in commands.rs did six
// concerns inline and discarded each write's result with `let _:`, so partial
// failure was silent. Here each stage is its own function returning a Result;
// the command is now a thin orchestrator. Locality: all ingest logic lives in
// one module. Leverage: one interface (`run`), N call sites.
use serde_json::json;
use surrealdb::engine::local::Db;
use surrealdb::Surreal;

use crate::ai::Llm;
use crate::documents::{DocInfo, DocRecord, NewDocument};
use crate::pipeline;

/// Extract text, chunk+embed, pull definitions, wire cross-doc edges, and scan
/// sections/references — each stage reported through the returned Result.
pub async fn run(
    db: &Surreal<Db>,
    llm: &dyn Llm,
    name: String,
    bytes: Vec<u8>,
) -> Result<DocInfo, String> {
    let text = pdf_extract::extract_text_from_mem(&bytes).map_err(|e| e.to_string())?;
    let page_count = text.matches('\x0c').count() as u32 + 1;

    let created: Option<DocRecord> = db
        .create("documents")
        .content(NewDocument {
            name,
            page_count,
            raw_text: text,
        })
        .await
        .map_err(|e| e.to_string())?;
    let record = created.ok_or_else(|| "failed to create document record".to_string())?;

    embed_chunks(db, llm, &record).await?;
    store_definitions(db, llm, &record).await?;
    wire_same_term_edges(db, &record).await?;
    store_sections(db, &record).await?;

    Ok(DocInfo::from_record(record))
}

/// Create a row and assert it actually landed. The DB `create` returns `None`
/// on a schema rejection even when the transport succeeded — swallowing that
/// was the old `let _:` behaviour. Now a missing row is a real error.
async fn store_row(db: &Surreal<Db>, table: &str, content: serde_json::Value) -> Result<(), String> {
    let created: Option<serde_json::Value> = db
        .create(table)
        .content(content)
        .await
        .map_err(|e| e.to_string())?;
    if created.is_none() {
        return Err(format!("failed to store row in {table}"));
    }
    Ok(())
}

/// Chunk the raw text and store each chunk with its embedding.
async fn embed_chunks(db: &Surreal<Db>, llm: &dyn Llm, record: &DocRecord) -> Result<(), String> {
    // ponytail: synchronous, one embed call per chunk — batch the
    // /v1/embeddings input array if ingest latency becomes a problem.
    for chunk in pipeline::chunk_text(&record.raw_text) {
        let embedding = llm.embed(&chunk.text).await?;
        store_row(
            db,
            "chunks",
            json!({
                "doc": record.id.clone(),
                "text": chunk.text,
                "page": chunk.page,
                "embedding": embedding,
            }),
        )
        .await?;
    }
    Ok(())
}

/// Phase 3: extract definitions once at ingest.
/// ponytail: best-effort — a failed extraction leaves the doc without definitions.
async fn store_definitions(db: &Surreal<Db>, llm: &dyn Llm, record: &DocRecord) -> Result<(), String> {
    if let Ok(defs) = crate::ai::extract_definitions(llm, &record.raw_text).await {
        for def in defs {
            store_row(
                db,
                "definitions",
                json!({
                    "doc": record.id.clone(),
                    "term": def.term,
                    "explanation": def.explanation,
                }),
            )
            .await?;
        }
    }
    Ok(())
}

/// Phase 3 (graph edges) + 4.4 (multi-doc merge): link this doc's definitions
/// to same-term definitions in *other* docs via `same_term` edges, both
/// directions so either side can traverse the link regardless of ingest order.
async fn wire_same_term_edges(db: &Surreal<Db>, record: &DocRecord) -> Result<(), String> {
    db.query(
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
    Ok(())
}

/// Phase 3.6: internal section headings + cross-references, pure-regex (no LLM).
async fn store_sections(db: &Surreal<Db>, record: &DocRecord) -> Result<(), String> {
    let (sections, references) = pipeline::extract_sections(&record.raw_text);
    for s in sections {
        store_row(
            db,
            "sections",
            json!({
                "doc": record.id.clone(),
                "label": s.label,
                "page": s.page,
            }),
        )
        .await?;
    }
    for r in references {
        store_row(
            db,
            "refs",
            json!({
                "doc": record.id.clone(),
                "source_label": r.source_label,
                "target_label": r.target_label,
                "page": r.page,
            }),
        )
        .await?;
    }
    Ok(())
}
