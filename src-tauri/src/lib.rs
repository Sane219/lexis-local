mod ai;
mod commands;
mod db;

use std::sync::Mutex;
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

// ponytail: GGUF path is hardcoded for now (the plan's JIT-download is deferred).
// Point this at a local model that supports both chat and the /v1/embeddings endpoint.
const MODEL_PATH: &str = "/home/sanket/.cache/lexis/model.gguf";
const LLAMA_BIN: &str = "llama-server";

/// Holds the spawned llama.cpp child so we can kill it on app exit.
struct Sidecar(Mutex<Option<CommandChild>>);

/// Spawn llama-server on a free port and point ai::base_url at it.
/// Returns None (and logs) if the binary/model is missing — the app still runs,
/// AI calls just fail with a clear "is llama-server running?" error.
fn spawn_llama(app: &AppHandle) -> Option<CommandChild> {
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .ok()?
        .local_addr()
        .ok()?
        .port();

    match app
        .shell()
        .command(LLAMA_BIN)
        .args([
            "-m",
            MODEL_PATH,
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--embeddings",
        ])
        .spawn()
    {
        Ok((mut rx, child)) => {
            ai::set_base_url(format!("http://127.0.0.1:{port}"));
            // Drain the child's stdout/stderr so its pipe never blocks.
            tauri::async_runtime::spawn(async move { while rx.recv().await.is_some() {} });
            eprintln!("llama-server spawned on 127.0.0.1:{port}");
            Some(child)
        }
        Err(e) => {
            eprintln!("could not spawn {LLAMA_BIN} ({e}); falling back to a manual server on :8080");
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("failed to resolve app data dir");
            let db = tauri::async_runtime::block_on(db::init_db(&app_data_dir))
                .expect("failed to initialize database");
            app.manage(db);

            let child = spawn_llama(app.handle());
            app.manage(Sidecar(Mutex::new(child)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ingest_pdf,
            commands::list_documents,
            commands::ask,
            commands::list_definitions,
            commands::detect_anomalies,
            commands::list_sections,
            commands::list_references,
            commands::simplify_text,
            commands::download_model_llmfit
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if let Some(sidecar) = app_handle.try_state::<Sidecar>() {
                    if let Some(child) = sidecar.0.lock().unwrap().take() {
                        let _ = child.kill();
                        eprintln!("llama-server killed on app exit");
                    }
                }
            }
        });
}
