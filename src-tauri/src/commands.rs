use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::ShellExt;
use serde_json::json;

use surrealdb::engine::local::Db;
use surrealdb::Surreal;

/// Emit a `log` event the frontend log console subscribes to. Also printed to
/// the terminal (tauri dev).
fn log(app: &AppHandle, level: &str, msg: &str) {
    eprintln!("[lexis][{level}] {msg}");
    let _ = app.emit("log", json!({ "level": level, "msg": msg }));
}

use crate::ai;
use crate::ai::Llm;
use crate::documents::DocInfo;
use crate::repo;

#[tauri::command]
pub async fn ingest_pdf(
    db: State<'_, Surreal<Db>>,
    name: String,
    bytes: Vec<u8>,
) -> Result<DocInfo, String> {
    let llm = ai::HttpLlm;
    crate::ingest::run(&db, &llm, name, bytes).await
}

#[tauri::command]
pub async fn list_documents(db: State<'_, Surreal<Db>>) -> Result<Vec<DocInfo>, String> {
    repo::list_documents(&db).await
}

#[tauri::command]
pub async fn list_sections(
    db: State<'_, Surreal<Db>>,
    doc_id: String,
) -> Result<Vec<crate::pipeline::Section>, String> {
    repo::list_sections(&db, doc_id).await
}

#[tauri::command]
pub async fn list_references(
    db: State<'_, Surreal<Db>>,
    doc_id: String,
) -> Result<Vec<crate::pipeline::Reference>, String> {
    repo::list_references(&db, doc_id).await
}

#[tauri::command]
pub async fn ask(
    db: State<'_, Surreal<Db>>,
    question: String,
) -> Result<repo::AskResult, String> {
    let llm = ai::HttpLlm;
    repo::ask(&db, &llm, question).await
}

#[tauri::command]
pub async fn list_definitions(
    db: State<'_, Surreal<Db>>,
    doc_id: String,
) -> Result<Vec<crate::pipeline::Definition>, String> {
    repo::list_definitions(&db, doc_id).await
}

#[tauri::command]
pub async fn cross_doc_links(
    db: State<'_, Surreal<Db>>,
    doc_id: String,
) -> Result<Vec<repo::CrossLink>, String> {
    repo::cross_doc_links(&db, doc_id).await
}

#[tauri::command]
pub async fn detect_anomalies(
    db: State<'_, Surreal<Db>>,
    doc_id: String,
) -> Result<String, String> {
    let llm = ai::HttpLlm;
    repo::detect_anomalies(&db, &llm, doc_id).await
}

#[tauri::command]
pub async fn simplify_text(text: String) -> Result<String, String> {
    let llm = ai::HttpLlm;
    llm.complete_with_system(
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
        .envs(crate::models::tool_env(&app))
        .spawn()
        .map_err(|e| format!("failed to spawn llmfit: {e}"))?;
    log(&app, "info", &format!("downloading model: {query}"));

    let app_ = app.clone();
    let q = query.clone();
    tauri::async_runtime::spawn(async move {
        let _child = child;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim().to_string();
                    if !line.is_empty() {
                        let _ = app_.emit("llmfit-progress", json!({ "query": q, "line": line }));
                    }
                }
                CommandEvent::Terminated(payload) => {
                    let ok = payload.code == Some(0);
                    if ok {
                        log(&app_, "info", &format!("model {q} download finished"));
                        let _ = app_.emit("llmfit-done", json!({ "query": q }));
                    } else {
                        let msg = format!("model {q} download failed (exit {:?})", payload.code);
                        log(&app_, "error", &msg);
                        let _ = app_.emit(
                            "llmfit-error",
                            json!({ "query": q, "error": msg }),
                        );
                    }
                    break;
                }
                CommandEvent::Error(e) => {
                    log(&app_, "error", &format!("model {q} download error: {e}"));
                    let _ = app_.emit("llmfit-error", json!({ "query": q, "error": e }));
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(format!("Started downloading {query}"))
}
