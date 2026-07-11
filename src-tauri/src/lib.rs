mod ai;
mod commands;
mod db;
mod documents;
mod ingest;
mod models;
mod pipeline;
mod repo;

use std::sync::Mutex;
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

// The model llama-server loads: an explicit LEXIS_MODEL_PATH override wins,
// otherwise the user's chosen active model (downloaded via the Model Library).
// None means no model is installed yet — the server simply doesn't start.
fn model_path(app: &AppHandle) -> Option<String> {
    if let Ok(p) = std::env::var("LEXIS_MODEL_PATH") {
        return Some(p);
    }
    models::get_active_model(app).map(|p| p.to_string_lossy().to_string())
}
const LLAMA_BIN: &str = "llama-server";

/// Holds the spawned llama.cpp child so we can kill it on app exit.
struct Sidecar(Mutex<Option<CommandChild>>);

/// Spawn llama-server on a free port and point ai::base_url at it.
/// Returns None (and logs) if the binary/model is missing — the app still runs,
/// AI calls just fail with a clear "is llama-server running?" error.
fn spawn_llama(app: &AppHandle) -> Option<CommandChild> {
    let model = match model_path(app) {
        Some(m) => m,
        None => {
            eprintln!("no active model set; llama-server not started (download one to enable AI)");
            return None;
        }
    };
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
            &model,
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--embeddings",
        ])
        .envs(crate::models::tool_env(app))
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

/// Set the active model and restart llama-server so it takes effect.
#[tauri::command]
fn set_active_model(app: AppHandle, path: String) -> Result<(), String> {
    models::set_active_model_path(&app, &path)?;
    if let Some(sidecar) = app.try_state::<Sidecar>() {
        let mut guard = sidecar.0.lock().unwrap();
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
        *guard = spawn_llama(&app);
    }
    Ok(())
}

/// Delete a downloaded model file. If it was the active model, kill
/// llama-server rather than leave it serving a now-deleted file.
#[tauri::command]
fn delete_model(app: AppHandle, path: String) -> Result<(), String> {
    let was_active = models::delete_model(&app, path)?;
    if was_active {
        if let Some(sidecar) = app.try_state::<Sidecar>() {
            let mut guard = sidecar.0.lock().unwrap();
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK's DMABUF renderer spams libEGL/MESA/ZINK errors and can fail to
    // create a screen on Linux boxes without working hardware GL (VMs, software
    // rendering). Disabling it forces the stable fallback path. Harmless
    // no-op on macOS/Windows.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

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
            commands::cross_doc_links,
            commands::simplify_text,
            commands::download_model_llmfit,
            models::tool_status,
            models::install_dependency,
            models::llmfit_recommend,
            models::llmfit_model_info,
            models::llmfit_search,
            models::llmfit_catalog_providers,
            models::list_downloaded_models,
            set_active_model,
            delete_model,
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
