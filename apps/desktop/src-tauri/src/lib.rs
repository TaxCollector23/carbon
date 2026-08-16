use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};


/// A running `carbon emulate` child process.
struct Emulator {
    child: Child,
}

struct AppState {
    emulator: Mutex<Option<Emulator>>,
}

/// Resolve the `carbon` CLI binary: prefer a Tauri sidecar bundled next to
/// this executable, then fall back to `carbon` on PATH (dev mode).
fn resolve_carbon() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            #[cfg(windows)]
            let candidate = dir.join("carbon.exe");
            #[cfg(not(windows))]
            let candidate = dir.join("carbon");
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    PathBuf::from("carbon")
}

/// Extract `http://…` from a CLI line, tolerating ANSI color codes and
/// trailing prose ("Runtime ready at http://127.0.0.1:8787\x1b[0m").
fn parse_url(line: &str) -> Option<String> {
    let start = line.find("http://")?;
    let rest = &line[start..];
    let end = rest
        .char_indices()
        .find(|(_, c)| {
            !matches!(
                c,
                'A'..='Z' | 'a'..='z' | '0'..='9' | '.' | ':' | '/' | '_' | '-'
            )
        })
        .map(|(i, _)| i)
        .unwrap_or(rest.len());
    let url = &rest[..end];
    (url.len() > "http://".len()).then(|| url.to_string())
}

fn stop_emulator(state: &AppState) {
    if let Ok(mut guard) = state.emulator.lock() {
        if let Some(mut emu) = guard.take() {
            let _ = emu.child.kill();
            let _ = emu.child.wait();
        }
    }
}

/// Blocking work for `emulate`: stop the previous child, spawn `carbon
/// emulate`, and return once the CLI reports its URL.
fn start_emulator(state: &Arc<AppState>, spec: &str, port: u16) -> Result<String, String> {
    if let Ok(mut guard) = state.emulator.lock() {
        if let Some(mut emu) = guard.take() {
            let _ = emu.child.kill();
            let _ = emu.child.wait();
        }
    }

    let mut child = Command::new(resolve_carbon())
        .args([
            "emulate",
            "--from",
            spec,
            "--port",
            &port.to_string(),
            "--host",
            "127.0.0.1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!("failed to launch the bundled `carbon` CLI: {e}. Install it with `npm i -g carbon-api`.")
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture carbon stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture carbon stderr".to_string())?;

    // Drain stderr on a background thread so a chatty child can't deadlock on
    // a full pipe; keep the last 20 lines to surface in the error message.
    let tail: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let tail_clone = Arc::clone(&tail);
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            if let Ok(text) = line {
                let mut buf = tail_clone.lock().unwrap();
                buf.push(text);
                if buf.len() > 20 {
                    buf.remove(0);
                }
            }
        }
    });

    let mut url: Option<String> = None;
    let deadline = Instant::now() + Duration::from_secs(30);
    for line in BufReader::new(stdout).lines() {
        match line {
            Ok(text) => {
                if let Some(found) = parse_url(&text) {
                    url = Some(found);
                    break;
                }
            }
            Err(_) => break,
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("timed out waiting for the emulator to boot".into());
        }
    }

    match url {
        Some(url) => {
            *state.emulator.lock().unwrap() = Some(Emulator { child });
            Ok(url)
        }
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let stderr_tail = tail.lock().unwrap().join("\n");
            let suffix = if stderr_tail.is_empty() {
                String::new()
            } else {
                format!(": {stderr_tail}")
            };
            Err(format!("carbon exited before reporting a URL{suffix}"))
        }
    }
}

fn http_json(url: &str, path: &str) -> Result<serde_json::Value, String> {
    ureq::get(&format!("{url}{path}"))
        .call()
        .map_err(|e| e.to_string())?
        .into_json::<serde_json::Value>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn emulate(
    state: tauri::State<'_, Arc<AppState>>,
    spec: String,
    port: u16,
) -> Result<String, String> {
    let state = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || start_emulator(&state, &spec, port))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn stop(state: tauri::State<'_, Arc<AppState>>) {
    stop_emulator(&state);
}

#[tauri::command]
async fn inspect(url: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || http_json(&url, "/__carbon/inspect"))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn history(url: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || http_json(&url, "/__carbon/state/history"))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(AppState {
            emulator: Mutex::new(None),
        }))
        .invoke_handler(tauri::generate_handler![emulate, stop, inspect, history])
        .run(tauri::generate_context!())
        .expect("error while running carbon desktop");
}
