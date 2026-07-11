use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

/// Emit a `log` event the frontend log console subscribes to. Every notable
/// backend action (install steps, download failures, command errors) goes here
/// so nothing fails silently. Also printed to the terminal (tauri dev) so the
/// same line is visible in both places.
fn log(app: &AppHandle, level: &str, msg: &str) {
    eprintln!("[lexis][{level}] {msg}");
    let _ = app.emit("log", json!({ "level": level, "msg": msg }));
}

// ponytail: we install llmfit + llama.cpp prebuilt binaries into
// <app_data>/bin and prepend that dir to PATH for every shell we spawn, so the
// rest of the app (llmfit download, llama-server) finds them without touching
// the user's system PATH.

/// Dir we drop installed binaries into (and put on PATH for spawns).
pub fn bin_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("lexis-local"))
        .join("bin")
}

/// Env map that puts our install dir on PATH (+ LLAMA_CPP_PATH) for spawns.
pub fn tool_env(app: &AppHandle) -> HashMap<String, String> {
    let dir = bin_dir(app);
    let mut map = HashMap::new();
    let existing = std::env::var("PATH").unwrap_or_default();
    let new_path = if existing.is_empty() {
        dir.to_string_lossy().to_string()
    } else {
        format!("{}:{existing}", dir.to_string_lossy())
    };
    map.insert("PATH".into(), new_path);
    map.insert("LLAMA_CPP_PATH".into(), dir.to_string_lossy().to_string());
    map
}

#[derive(Serialize)]
pub struct ToolStatus {
    pub llmfit_installed: bool,
    pub llama_cpp_installed: bool,
    pub llmfit_version: Option<String>,
    pub llama_cpp_version: Option<String>,
}

/// Report which dependencies are present (system PATH or our install dir).
#[tauri::command]
pub fn tool_status(app: AppHandle) -> ToolStatus {
    let llmfit = detect_tool(&app, "llmfit", "llmfit");
    let llama = detect_tool(&app, "llama-server", "llama-server");
    ToolStatus {
        llmfit_installed: llmfit.is_some(),
        llama_cpp_installed: llama.is_some(),
        llmfit_version: llmfit,
        llama_cpp_version: llama,
    }
}

/// Run `<bin> --version` with our install dir on PATH; return version if ok.
fn detect_tool(app: &AppHandle, bin: &str, win_bin: &str) -> Option<String> {
    let target = if std::env::consts::OS == "windows" {
        win_bin
    } else {
        bin
    };
    let out = Command::new(target)
        .arg("--version")
        .envs(tool_env(app))
        .output()
        .ok()?;
    if out.status.success() {
        Some(
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string(),
        )
    } else {
        None
    }
}

#[derive(Serialize, Clone)]
struct InstallProgress {
    dependency: String,
    stage: String,
    detail: String,
    percent: Option<u8>,
}

struct RepoMeta {
    repo: &'static str,
    bin: &'static str,
    win_bin: &'static str,
}

const LLAMA: RepoMeta = RepoMeta {
    repo: "ggml-org/llama.cpp",
    bin: "llama-server",
    win_bin: "llama-server.exe",
};
const LLMFIT: RepoMeta = RepoMeta {
    repo: "AlexsJones/llmfit",
    bin: "llmfit",
    win_bin: "llmfit.exe",
};

/// Auto-download a prebuilt binary for the current OS/arch into <app_data>/bin.
/// Emits `dependency-install` progress events. Runs the heavy work off the
/// async runtime so the UI stays responsive.
#[tauri::command]
pub async fn install_dependency(app: AppHandle, dependency: String) -> Result<(), String> {
    let meta = match dependency.as_str() {
        "llama_cpp" => LLAMA,
        "llmfit" => LLMFIT,
        other => return Err(format!("unknown dependency: {other}")),
    };
    let meta_repo = meta.repo;
    let bin = meta.bin;
    let win_bin = meta.win_bin;
    let dep = dependency.clone();

    tauri::async_runtime::spawn(async move {
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            install_blocking(&app, meta_repo, bin, win_bin, &dep)
        }));
        let (stage, detail, percent) = match res {
            Ok(Ok(())) => ("done", "Installed successfully".to_string(), Some(100)),
            Ok(Err(e)) => ("error", e, None),
            Err(_) => ("error", "install panicked".to_string(), None),
        };
        let _ = app.emit(
            "dependency-install",
            InstallProgress {
                dependency: dep.clone(),
                stage: stage.into(),
                detail: detail.clone(),
                percent,
            },
        );
        log(
            &app,
            if stage == "error" { "error" } else { "info" },
            &format!("[{dep}] {stage}: {detail}"),
        );
    });
    Ok(())
}

fn install_blocking(
    app: &AppHandle,
    repo: &str,
    bin: &str,
    win_bin: &str,
    dep: &str,
) -> Result<(), String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    log(app, "info", &format!("installing {dep} from {repo}"));
    emit(app, dep, "resolving", format!("Finding latest {repo} release"), None);
    let assets = fetch_release_assets(repo)?;
    let asset = pick_asset(&assets, os, arch)
        .ok_or_else(|| format!("no {os}/{arch} prebuilt asset found in {repo}"))?;
    log(app, "info", &format!("[{dep}] resolved asset {}", asset.name));

    let tmp = std::env::temp_dir().join(format!("lexis-{dep}"));
    let _ = std::fs::create_dir_all(&tmp);
    let archive_path = tmp.join(&asset.name);

    emit(app, dep, "downloading", format!("Downloading {}", asset.name), Some(0));
    download_with_progress(app, dep, &asset.url, &archive_path)?;
    log(app, "info", &format!("[{dep}] download complete"));

    emit(app, dep, "extracting", "Extracting archive".into(), Some(80));
    let extract_dir = tmp.join("extracted");
    let _ = std::fs::remove_dir_all(&extract_dir);
    std::fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;
    let target = if os == "windows" { win_bin } else { bin };
    let extracted = extract(&archive_path, &extract_dir, target, os)?;
    log(app, "info", &format!("[{dep}] extracted -> {}", extracted.display()));

    let dest_dir = bin_dir(app);
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let dest_bin = dest_dir.join(target);
    std::fs::copy(&extracted, &dest_bin).map_err(|e| format!("install failed: {e}"))?;
    if os != "windows" {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dest_bin, std::fs::Permissions::from_mode(0o755));
    }

    emit(app, dep, "verifying", "Verifying binary".into(), Some(95));
    Command::new(&dest_bin)
        .arg("--version")
        .output()
        .map_err(|e| format!("installed binary won't run: {e}"))?;
    log(app, "info", &format!("[{dep}] verified, installed at {}", dest_bin.display()));

    let _ = std::fs::remove_dir_all(&tmp);
    Ok(())
}

fn emit(app: &AppHandle, dep: &str, stage: &str, detail: String, percent: Option<u8>) {
    let _ = app.emit(
        "dependency-install",
        InstallProgress {
            dependency: dep.into(),
            stage: stage.into(),
            detail,
            percent,
        },
    );
}

fn fetch_release_assets(repo: &str) -> Result<Vec<Asset>, String> {
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let out = Command::new("curl")
        .args([
            "-sL",
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            "User-Agent: lexis-local",
            &url,
        ])
        .output()
        .map_err(|e| format!("curl failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "github api error: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    let json: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("bad github json: {e}"))?;
    let assets = json["assets"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|x| Asset {
                    name: x["name"].as_str().unwrap_or("").to_string(),
                    url: x["browser_download_url"].as_str().unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(assets)
}

/// Pick the asset matching the current OS/arch from a release's asset list,
/// preferring the plain CPU build over GPU/vendor variants. Handles both
/// llama.cpp (`ubuntu-x64`, `win-cpu-x64`, `macos-arm64`) and llmfit
/// (`unknown-linux-gnu`, `pc-windows-msvc`, `apple-darwin`) naming.
fn pick_asset(assets: &[Asset], os: &str, arch: &str) -> Option<Asset> {
    let os_kw: &[&str] = match os {
        "linux" => &["linux", "ubuntu"],
        "macos" => &["macos", "apple-darwin", "darwin"],
        "windows" => &["windows", "win"],
        other => &[other],
    };
    let arch_kw: &[&str] = match arch {
        "x86_64" => &["x86_64", "x64", "amd64"],
        "aarch64" => &["aarch64", "arm64"],
        other => &[other],
    };
    // GPU/vendor variants we should not pick by default.
    let variant_kw = [
        "vulkan", "rocm", "sycl", "openvino", "cuda", "cudart", "hip", "adreno", "opencl", "rpc",
        "android", "s390x", "ui", "xcframework",
    ];

    let mut best: Option<&Asset> = None;
    let mut best_score: i32 = i32::MIN;
    for a in assets {
        let n = a.name.to_lowercase();
        if n.contains(".sha256") || n.contains(".sig") || n.contains(".yml") {
            continue;
        }
        let os_ok = os_kw.iter().any(|k| n.contains(*k));
        let arch_ok = arch_kw.iter().any(|k| n.contains(*k));
        if !os_ok || !arch_ok {
            continue;
        }
        let is_archive = n.ends_with(".zip") || n.ends_with(".tar.gz") || n.ends_with(".tgz");
        if !is_archive {
            continue;
        }
        // Plain CPU build (no variant keyword) scores highest.
        let penalty: i32 = variant_kw.iter().filter(|k| n.contains(*k)).count() as i32 * 100;
        let score = 1000 - penalty;
        if score > best_score {
            best_score = score;
            best = Some(a);
        }
    }
    best.cloned()
}

/// Download a URL to `dest`, emitting percentage progress while streaming.
fn download_with_progress(
    app: &AppHandle,
    dep: &str,
    url: &str,
    dest: &Path,
) -> Result<(), String> {
    let total: u64 = {
        let head = Command::new("curl").args(["-sIL", url]).output().ok();
        head.and_then(|o| {
            let txt = String::from_utf8_lossy(&o.stdout);
            txt.lines().find_map(|l| {
                let l = l.to_lowercase();
                if l.starts_with("content-length:") {
                    l.split(':').nth(1)?.trim().parse::<u64>().ok()
                } else {
                    None
                }
            })
        })
        .unwrap_or(0)
    };

    let partial = dest.with_extension("part");
    // `-f` makes curl exit non-zero on HTTP errors (404 etc.) instead of
    // writing an empty/error body. Stderr is piped so we can surface the real
    // reason a download failed instead of failing cryptically at extract time.
    let mut child = Command::new("curl")
        .args(["-fsSL", "-o", &partial.to_string_lossy(), url])
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("curl spawn failed: {e}"))?;

    let start = std::time::Instant::now();
    loop {
        if let Ok(meta) = std::fs::metadata(&partial) {
            let got = meta.len();
            let pct = if total > 0 {
                Some(((got as f64 / total as f64) * 100.0).min(100.0) as u8)
            } else {
                None
            };
            emit(
                app,
                dep,
                "downloading",
                if let Some(p) = pct {
                    format!("Downloading… {p}%")
                } else {
                    format!("Downloading… {} MB", got / 1_000_000)
                },
                pct,
            );
        }
        if let Ok(Some(_)) = child.try_wait() {
            break;
        }
        if start.elapsed() > Duration::from_secs(600) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("download timed out".into());
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    let status = child
        .wait()
        .map_err(|e| format!("curl wait failed: {e}"))?;
    if !status.success() {
        let mut stderr = String::new();
        if let Some(mut s) = child.stderr.take() {
            let _ = std::io::Read::read_to_string(&mut s, &mut stderr);
        }
        let _ = std::fs::remove_file(&partial);
        let msg = format!(
            "download failed (curl {}): {}",
            status.code().unwrap_or(-1),
            stderr.trim().lines().last().unwrap_or("unknown error")
        );
        log(app, "error", &msg);
        return Err(msg);
    }
    let _ = std::fs::rename(&partial, dest);
    Ok(())
}

/// Extract `archive` into `dest`, returning the path to `target` inside.
fn extract(archive: &Path, dest: &Path, target: &str, os: &str) -> Result<PathBuf, String> {
    let a = archive.to_string_lossy();
    let d = dest.to_string_lossy();
    let status = if a.ends_with(".zip") {
        if os == "windows" {
            Command::new("tar").args(["-xf", &a, "-C", &d]).status()
        } else {
            Command::new("unzip").args(["-o", &a, "-d", &d]).status()
        }
    } else {
        Command::new("tar").args(["-xzf", &a, "-C", &d]).status()
    }
    .map_err(|e| format!("extract spawn failed: {e}"))?;
    if !status.success() {
        return Err("extraction failed".into());
    }
    find_file(dest, target).ok_or_else(|| format!("could not find {target} in archive"))
}

fn find_file(dir: &Path, name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            if let Some(f) = find_file(&p, name) {
                return Some(f);
            }
        } else if p.file_name().map(|n| n == name).unwrap_or(false) {
            return Some(p);
        }
    }
    None
}

// ---- llmfit catalog / recommend / info -----------------------------------

fn llmfit_json(app: &AppHandle, args: &[&str]) -> Result<serde_json::Value, String> {
    let out = Command::new("llmfit")
        .args(args)
        .envs(tool_env(app))
        .output()
        .map_err(|e| format!("failed to run llmfit: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "llmfit {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    serde_json::from_slice(&out.stdout).map_err(|e| format!("failed to parse llmfit json: {e}"))
}

/// Full, unlimited model catalog from `llmfit list --json` (embedded DB, no
/// network). Frontend does search/sort/filter client-side.
#[tauri::command]
pub fn llmfit_catalog(app: AppHandle) -> Result<serde_json::Value, String> {
    llmfit_json(&app, &["list", "--json"])
}

/// Hardware-fit recommendations from `llmfit recommend --json`.
#[tauri::command]
pub fn llmfit_recommend(app: AppHandle) -> Result<serde_json::Value, String> {
    llmfit_json(&app, &["recommend", "--json"])
}

/// Full spec + fit analysis for one model from `llmfit info <name> --json`.
#[tauri::command]
pub fn llmfit_model_info(app: AppHandle, name: String) -> Result<serde_json::Value, String> {
    llmfit_json(&app, &["info", &name, "--json"])
}

#[derive(Clone)]
struct Asset {
    name: String,
    url: String,
}
