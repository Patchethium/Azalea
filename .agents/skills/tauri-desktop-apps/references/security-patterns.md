# Security Patterns in Tauri 2

## Overview

Tauri's security model is built on three pillars:
1. **CSP (Content Security Policy)** — Controls what resources the webview can load
2. **IPC Permissions** — Controls what Tauri commands the frontend can call
3. **IPC Scope** — Controls which files/URLs the frontend can access

## 1. Content Security Policy (CSP)

### Basic CSP (tauri.conf.json)

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; img-src 'self' data: blob:; font-src 'self'"
    }
  }
}
```

### CSP Directives Reference

| Directive | Purpose | Example |
|-----------|---------|---------|
| `default-src` | Fallback for all resource types | `'self'` |
| `script-src` | JavaScript execution | `'self'` |
| `style-src` | CSS loading | `'self' 'unsafe-inline'` |
| `connect-src` | Fetch/WebSocket/XHR | `'self' http://127.0.0.1:* ws://127.0.0.1:*` |
| `img-src` | Image loading | `'self' data: blob:` |
| `font-src` | Font loading | `'self'` |
| `media-src` | Audio/video | `'self' blob:` |
| `frame-src` | iframes | `'none'` |

### CSP for AI Apps (with external API)

```json
{
  "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:* https://api.openai.com https://api.anthropic.com https://9router.peditx.ir; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'"
}
```

### CSP for MCP Server (local HTTP)

```json
{
  "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:*; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
}
```

## 2. IPC Permissions (Capabilities)

### Capabilities File

`src-tauri/capabilities/default.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "identifier": "default",
  "description": "Main window permissions",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "store:default",
    "dialog:default",
    "fs:default",
    "shell:allow-open",
    "notification:allow-send-notification",
    "process:default"
  ]
}
```

### Permission Granularity

```json
{
  "permissions": [
    "fs:default",
    "fs:allow-read",
    "fs:allow-write",
    {
      "identifier": "fs:scope",
      "allow": [
        { "path": "$APPDATA/**" },
        { "path": "$DOCUMENT/**" }
      ]
    }
  ]
}
```

### Per-Window Capabilities

```json
{
  "identifier": "chat-window",
  "windows": ["chat"],
  "permissions": [
    "core:default",
    "shell:allow-open"
  ]
}
```

## 3. API Key / Secret Storage

### Option A: OS Keyring (Recommended)

```toml
# Cargo.toml
tauri-plugin-keyring = "0.1"
```

```rust
// Store API key
use keyring::Entry;

let entry = Entry::new("my-app", "gateway-api-key")
    .map_err(|e| e.to_string())?;
entry.set_password(&api_key).map_err(|e| e.to_string())?;

// Retrieve API key
let key = entry.get_password().map_err(|e| e.to_string())?;
```

### Option B: Tauri Plugin Store (Plaintext)

```rust
use tauri_plugin_store::StoreExt;

let store = app.store("config.dat").map_err(|e| e.to_string())?;
store.set("gateway_url", serde_json::json!(url));
// API keys should NOT go here — use keyring
```

### Option C: Encrypted Store

```rust
// For high-security apps, encrypt before storing
use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::Aead;

let key = Key::<Aes256Gcm>::from_slice(encryption_key);
let cipher = Aes256Gcm::new(&key);
let nonce = Nonce::from_slice(&random_nonce);
let ciphertext = cipher.encrypt(nonce, api_key.as_bytes())
    .map_err(|e| e.to_string())?;
```

## 4. Self-Signed TLS

```rust
// For local development with self-signed certs
let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(10))
    .danger_accept_invalid_certs(true)  // Only for dev/LAN
    .build()
    .map_err(|e| e.to_string())?;
```

### Production: Pin Certificate

```rust
let cert = reqwest::Certificate::from_pem(include_bytes!("ca.pem"))
    .map_err(|e| e.to_string())?;
let client = reqwest::Client::builder()
    .add_root_certificate(cert)
    .build()
    .map_err(|e| e.to_string())?;
```

## 5. IPC Security Rules

### Never Trust Frontend Input

```rust
#[tauri::command]
fn dangerous_command(path: String) -> Result<String, String> {
    // BAD: Frontend can read ANY file
    // std::fs::read_to_string(&path)

    // GOOD: Validate path is in allowed directory
    let allowed_dir = dirs::data_local_dir()
        .ok_or("no data dir")?
        .join("my-app");

    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("invalid path: {e}"))?;

    if !canonical.starts_with(&allowed_dir) {
        return Err("access denied: path outside allowed directory".into());
    }

    std::fs::read_to_string(&canonical)
        .map_err(|e| e.to_string())
}
```

### Input Validation Pattern

```rust
#[tauri::command]
fn save_config(key: String, value: String) -> Result<(), String> {
    // Validate key
    if key.len() > 64 || !key.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err("invalid key format".into());
    }

    // Validate value length
    if value.len() > 1_000_000 {
        return Err("value too large".into());
    }

    // Sanitize
    let key = key.trim().to_lowercase();
    let value = value.trim().to_string();

    // Save
    Ok(())
}
```

## 6. CORS for Local Servers

If your app runs a local HTTP server (MCP, Python sidecar):

```rust
// Add CORS headers to your tiny_http / axum / actix server
// For MCP server using tiny_http:
if let Some(req) = server.recv() {
    let mut response = tiny_http::Response::from_string(body)
        .with_header(
            tiny_http::Header::from_bytes(
                &b"Access-Control-Allow-Origin"[..],
                &b"tauri://localhost"[..]
            ).unwrap()
        )
        .with_header(
            tiny_http::Header::from_bytes(
                &b"Access-Control-Allow-Methods"[..],
                &b"POST, OPTIONS"[..]
            ).unwrap()
        );
    req.respond(response).ok();
}
```

## 7. File System Scoping

### Scope Configuration

```json
{
  "permissions": [
    {
      "identifier": "fs:scope",
      "allow": [
        { "path": "$APPDATA/**" },
        { "path": "$DOCUMENT/my-app/**" },
        { "path": "$DOWNLOAD/**" }
      ],
      "deny": [
        { "path": "$HOME/.ssh/**" },
        { "path": "$HOME/.gnupg/**" }
      ]
    }
  ]
}
```

### Scope Variables

| Variable | Resolves To |
|----------|-------------|
| `$APPDATA` | App data directory |
| `$DOCUMENT` | User documents folder |
| `$DOWNLOAD` | User downloads folder |
| `$DESKTOP` | User desktop |
| `$HOME` | User home directory |
| `$TEMP` | System temp directory |

## 8. Secure IPC Patterns

### Command State Validation

```rust
use std::sync::Mutex;

pub struct AppState {
    pub authenticated: Mutex<bool>,
    pub user_id: Mutex<Option<String>>,
}

#[tauri::command]
fn protected_action(
    state: State<'_, AppState>,
    data: String,
) -> Result<String, String> {
    // Check authentication
    if !*state.authenticated.lock().unwrap() {
        return Err("not authenticated".into());
    }

    // Process data
    Ok(format!("processed: {data}"))
}
```

## Security Checklist

- [ ] CSP configured with minimal permissions
- [ ] API keys stored in OS keyring (not plaintext store)
- [ ] IPC commands validate all inputs
- [ ] File paths validated against allowed directories
- [ ] Self-signed TLS only for development
- [ ] No `unsafe` blocks without justification
- [ ] Capabilities file covers only needed permissions
- [ ] No secrets in frontend code or logs
- [ ] Remote MCP server requires auth token
- [ ] Auto-updater verifies signature

## Common Security Pitfalls

| Problem | Risk | Fix |
|---------|------|-----|
| API key in localStorage | XSS exposure | Use OS keyring |
| `fs:scope` too broad | File system access | Restrict to app dirs |
| `'unsafe-inline'` in CSP | XSS via inline scripts | Remove if possible |
| `danger_accept_invalid_certs` in prod | MITM attacks | Use real certs |
| No input validation | Path traversal, injection | Validate all Rust command inputs |
| Secrets in git history | Credential leak | Use .env + .gitignore |
| CORS `*` on local server | Unauthorized access | Restrict to `tauri://localhost` |
