# Tauri v2 Project Setup Reference

## Creating a New Tauri v2 Project from Scratch

### Prerequisites
- Rust 1.75+ (via rustup)
- Node.js 20+ (via nvm or system package)
- Tauri CLI: `cargo install tauri-cli`

### Initialize Project
```bash
# Create project directory
mkdir hermes-desktop-client
cd hermes-desktop-client

# Initialize Cargo workspace
cargo init --name hermes-desktop-client

# Initialize Tauri project (non-interactive)
cargo tauri init --ci --force \
  --app-name "Hermes Desktop Client" \
  --window-title "Hermes Desktop Client" \
  --frontend-dist "../frontend/dist" \
  --dev-url "http://localhost:5173"
```

### Configure Frontend (React + TypeScript + Vite)
```bash
# Create frontend with Vite React TS template
npm create vite@latest frontend -- --template react-ts

# Install dependencies
cd frontend && npm install

# Install Tauri API plugins
npm install @tauri-apps/api @tauri-apps/plugin-store @tauri-apps/plugin-opener
```

### Update Tauri Config (tauri.conf.json)
```json
{
  "build": {
    "frontendDist": "../frontend/dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "cd ../frontend && npm run dev",
    "beforeBuildCommand": "cd ../frontend && npm run build"
  },
  "app": {
    "windows": [{
      "title": "Hermes Desktop Client",
      "width": 1200,
      "height": 800,
      "minWidth": 900,
      "minHeight": 600,
      "resizable": true,
      "center": true
    }]
  },
  "plugins": {
    "store": { "autosave": true }
  }
}
```

### Update Cargo.toml
```toml
[package]
name = "hermes-desktop-client"
version = "0.1.0"
edition = "2021"
rust-version = "1.75"

[dependencies]
tauri = { version = "2.11.3" }
tauri-plugin-log = "2"
tauri-plugin-store = "2"
tauri-plugin-opener = "2"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
reqwest = { version = "0.12", features = ["json", "stream", "rustls-tls"] }
futures-util = "0.3"
tokio = { version = "1", features = ["full"] }
```

### Backend Commands Structure (lib.rs)
```rust
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GatewayConfig {
    pub url: String,
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GatewayResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub stream: Option<bool>,
}

// Tauri commands: save_gateway_config, load_gateway_config,
// test_gateway_connection, send_chat_stream (SSE streaming)

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![...])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Development Commands
```bash
# Run in development mode
cargo tauri dev

# Build for production
cargo tauri build

# Check for errors
cargo check

# Build frontend only
cd frontend && npm run build
```

## Key Differences from Tauri v1
- Tauri 2 uses `tauri-plugin-store` instead of manual file I/O
- Commands are async by default
- `tauri.conf.json` v2 schema (`$schema: "https://schema.tauri.app/config/2"`)
- Frontend built to `dist/` directory (not `build/`)
- Window config includes `minWidth`/`minHeight`
