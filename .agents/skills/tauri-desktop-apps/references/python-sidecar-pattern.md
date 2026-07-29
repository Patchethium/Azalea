# Python Sidecar Integration in Tauri 2

Three integration levels from simplest to most powerful.

## Level 1: Subprocess Sidecar (Recommended for most apps)

The official Tauri approach. Python runs as a separate process, communicates via stdin/stdout or HTTP.

### Setup

1. Place Python script in `src-tauri/sidecar/` or bundle via `tauri.conf.json`:

```json
// src-tauri/tauri.conf.json
{
  "bundle": {
    "externalBin": ["sidecar/agent"],
    "resources": ["python/**/*"]
  }
}
```

2. Build Python as standalone executable with PyInstaller:

```bash
pip install pyinstaller
pyinstaller --onefile --name agent src/sidecar/agent.py
cp dist/agent src-tauri/sidecar/agent.exe  # Windows
cp dist/agent src-tauri/sidecar/agent      # Linux/macOS
```

3. Or use a Python venv bundled with the app:

```json
{
  "bundle": {
    "resources": ["python-venv/**/*"]
  }
}
```

### Rust: Launch Sidecar

```rust
// src-tauri/src/sidecar.rs
use tauri::api::process::{Command, CommandChild};
use tauri::Manager;
use std::sync::Mutex;

pub struct SidecarState {
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
pub fn start_sidecar(app: tauri::AppHandle) -> Result<String, String> {
    let sidecar_command = app.shell().sidecar("agent").map_err(|e| e.to_string())?;
    let (mut rx, child) = sidecar_command
        .args(["--port", "8765"])
        .spawn()
        .map_err(|e| e.to_string())?;

    // Read initial output
    let mut output = String::new();
    // rx is a Receiver that yields CommandEvent

    let state = app.state::<SidecarState>();
    *state.child.lock().unwrap() = Some(child);

    Ok("Sidecar started".into())
}

#[tauri::command]
pub fn stop_sidecar(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<SidecarState>();
    if let Some(child) = state.child.lock().unwrap().take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

### Rust: Register State + Commands

```rust
// src-tauri/src/lib.rs
use sidecar::SidecarState;

pub fn run() {
    tauri::Builder::default()
        .manage(SidecarState { child: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            start_sidecar,
            stop_sidecar,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Python Sidecar Script

```python
#!/usr/bin/env python3
"""Sidecar agent — reads JSON from stdin, writes JSON to stdout."""
import sys
import json
import signal

def handle_request(request: dict) -> dict:
    """Process a request and return a response."""
    action = request.get("action")
    if action == "analyze":
        return {"result": "analysis complete", "data": request.get("payload")}
    return {"error": f"unknown action: {action}"}

def main():
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            response = handle_request(request)
        except Exception as e:
            response = {"error": str(e)}
        print(json.dumps(response), flush=True)

if __name__ == "__main__":
    main()
```

### Frontend: Call Sidecar

```typescript
import { invoke } from '@tauri-apps/api/core';

// Start sidecar
await invoke('start_sidecar');

// Stop sidecar
await invoke('stop_sidecar');
```

## Level 2: HTTP Bridge (Python as Local Server)

Python runs a local HTTP server, Rust/Frontend calls it.

### Python Server

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["tauri://localhost", "https://tauri.localhost"],
                   allow_methods=["*"], allow_headers=["*"])

@app.post("/process")
async def process(request: dict):
    # Heavy ML/NLP/media processing here
    return {"result": "processed", "data": request}

@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)
```

### Rust: HTTP Client to Python

```rust
#[tauri::command]
pub async fn call_python(payload: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.post("http://127.0.0.1:8765/process")
        .json(&serde_json::from_str::<serde_json::Value>(&payload).unwrap())
        .send()
        .await
        .map_err(|e| e.to_string())?;

    resp.text().await.map_err(|e| e.to_string())
}
```

### Launch Python Server from Rust

```rust
#[tauri::command]
pub fn start_python_server(app: tauri::AppHandle) -> Result<(), String> {
    // Option A: bundled Python script
    let script_path = app.path().resource_dir()
        .map_err(|e| e.to_string())?
        .join("python").join("server.py");

    std::process::Command::new("python3")
        .arg(script_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

// Option B: PyInstaller bundle (no Python needed on target)
#[tauri::command]
pub fn start_python_server_bundled(app: tauri::AppHandle) -> Result<(), String> {
    let sidecar = app.shell().sidecar("python-server")
        .map_err(|e| e.to_string())?;
    let (_, child) = sidecar.spawn().map_err(|e| e.to_string())?;
    // Store child handle for cleanup
    Ok(())
}
```

## Level 3: PyO3 / Maturin (Rust-Python FFI)

Best performance. Python runs IN the Rust process. No IPC overhead.

### Project Structure

```
my-app/
├── src-tauri/
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs          # Tauri commands
├── src/                    # Frontend
├── python-bridge/          # PyO3 crate
│   ├── Cargo.toml          # pyo3 dependency
│   ├── src/lib.rs          # Rust functions callable from Python
│   └── pyproject.toml      # maturin config
└── python/                 # Python code
    ├── __init__.py
    └── ml_engine.py        # Heavy processing
```

### Cargo.toml for PyO3 Bridge

```toml
# python-bridge/Cargo.toml
[package]
name = "python-bridge"
version = "0.1.0"
edition = "2021"

[lib]
name = "python_bridge"
crate-type = ["cdylib"]

[dependencies]
pyo3 = { version = "0.22", features = ["extension-module"] }
```

### Rust PyO3 Code

```rust
// python-bridge/src/lib.rs
use pyo3::prelude::*;

#[pyfunction]
fn process_data(input: &str) -> PyResult<String> {
    // Call Python functions from Rust
    let result = Python::with_gil(|py| {
        let sys = py.import("sys")?;
        let version: String = sys.getattr("version")?.extract()?;
        Ok::<_, PyErr>(version)
    })?;
    Ok(result)
}

#[pymodule]
fn python_bridge(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(process_data, m)?)?;
    Ok(())
}
```

### Build with Maturin

```bash
cd python-bridge
pip install maturin
maturin develop --release   # Build + install in current venv
maturin build --release     # Build wheel for distribution
```

## Level 4: FFI via JSON (No PyO3, Pure JSON IPC)

Simplest cross-language bridge. Both sides read/write JSON files or pipes.

### Python (stdin/stdout JSON)

```python
import json, sys

for line in sys.stdin:
    req = json.loads(line.strip())
    result = heavy_compute(req)
    print(json.dumps(result), flush=True)
```

### Rust (spawn + pipe)

```rust
use std::io::{BufRead, BufReader, Write};

#[tauri::command]
pub async fn run_python_task(input: String) -> Result<String, String> {
    let mut child = std::process::Command::new("python3")
        .arg("worker.py")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn python: {e}"))?;

    // Write request
    child.stdin.take().unwrap()
        .write_all(format!("{}\n", input).as_bytes())
        .map_err(|e| e.to_string())?;

    // Read response
    let reader = BufReader::new(child.stdout.take().unwrap());
    let response = reader.lines()
        .next()
        .ok_or("no response from python")?
        .map_err(|e| e.to_string())?;

    child.wait().map_err(|e| e.to_string())?;
    Ok(response)
}
```

## Decision Matrix

| Level | Performance | Complexity | Python Needed on Target | Use When |
|-------|-------------|------------|------------------------|----------|
| Subprocess | Medium | Low | Yes (or PyInstaller) | Most apps |
| HTTP Bridge | Medium | Low | Yes | Multiple languages |
| PyO3/Maturin | High | High | No (embedded) | ML inference, tight loops |
| FFI JSON | Medium | Lowest | Yes | Quick scripts, prototyping |

## PyInstaller Bundling for Distribution

```bash
# Create standalone executable
pip install pyinstaller
pyinstaller --onefile --name worker \
  --add-data "models/:models" \
  worker.py

# The binary goes in src-tauri/sidecar/ or resources/
cp dist/worker src-tauri/sidecar/worker.exe  # Windows
cp dist/worker src-tauri/sidecar/worker       # Linux/macOS
```

### Cross-Platform Note

PyInstaller must run on EACH target OS. Use GitHub Actions matrix:

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
steps:
  - name: Build Python sidecar
    run: |
      pip install pyinstaller
      pyinstaller --onefile worker.py
  - name: Copy to sidecar
    run: cp dist/worker* src-tauri/sidecar/
```

## Common Pitfalls

| Problem | Fix |
|---------|-----|
| Sidecar not found at runtime | Bundle via `externalBin` in tauri.conf.json |
| Python not installed on target | Use PyInstaller to create standalone binary |
| CORS errors with HTTP bridge | Add `tauri://localhost` to allowed origins |
| PyO3 build fails | Ensure Rust toolchain + Python dev headers installed |
| Sidecar zombie processes | Always call `child.kill()` on app exit |
| stdin/stdout blocking | Use `BufReader` + non-blocking I/O |
| Python path wrong on packaged app | Use `app.path().resource_dir()` to resolve paths |
