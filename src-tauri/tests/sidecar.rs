// Verifies the process-management mechanics the llama.cpp sidecar relies on:
// tauri-plugin-shell spawns a child process, and CommandChild::kill() terminates
// it. lib.rs uses exactly this path — spawn in setup(), kill on RunEvent::Exit.
// (We spawn `sleep` rather than llama-server so the test needs no model/binary.)
use tauri_plugin_shell::ShellExt;

#[test]
fn shell_plugin_spawns_and_kills_child() {
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_shell::init())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");

    let (_rx, child) = app
        .shell()
        .command("sleep")
        .args(["600"])
        .spawn()
        .expect("sidecar-style spawn should succeed");

    let pid = child.pid();
    let proc = format!("/proc/{pid}");
    assert!(
        std::path::Path::new(&proc).exists(),
        "child process should be running after spawn"
    );

    child.kill().expect("kill should succeed");

    // Wait for the OS to reap the killed child.
    let mut gone = false;
    for _ in 0..40 {
        if !std::path::Path::new(&proc).exists() {
            gone = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    assert!(gone, "child must be terminated after kill()");
}
