# Session Reference: Building hermes-desktop-client From Scratch

## Project Overview
Created a new Tauri v2 + React TypeScript desktop client for Hermes Gateway from scratch (not a fork).
Location: `/root/hermes-desktop-client`

## Architecture Decisions

### Technology Stack
- **Frontend**: React 19 + TypeScript + Vite 6
- **Backend**: Tauri 2.11.3 (Rust 2021 edition)
- **State/Config**: `tauri-plugin-store` for config persistence
- **HTTP Client**: `reqwest` with streaming support (`futures-util`)
- **UI**: Custom CSS with dark theme (Hermes branding)

### Key Design Choices
1. **Client-mode only** — User provides Gateway URL + API Key; no local agent/bundled gateway
2. **Config screen first** — App starts with gateway configuration form before chat
3. **Streaming chat** — SSE (Server-Sent Events) via `send_chat_stream` Tauri command emitting `chat-stream-chunk` / `chat-stream-end` events
4. **Self-signed TLS support** — Reqwest client uses `danger_accept_invalid_certs(true)` for local dev gateways
5. **Clean separation** — Frontend in `frontend/`, backend in `src-tauri/`

## Project Structure
```
hermes-desktop-client/
├── src-tauri/
│   ├── Cargo.toml           # edition = "2021", rust-version = "1.75"
│   ├── tauri.conf.json      # Window 1200x800, plugins: store, opener
│   ├── build.rs
│   ├── capabilities/
│   ├── icons/
│   └── src/
│       └── lib.rs           # Commands: save/load config, test connection, chat (streaming)
├── frontend/
│   ├── package.json         # React 19, Vite 6, @tauri-apps/api, @tauri-apps/plugin-store
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx          # Config screen + chat interface
│       ├── App.css          # Dark theme styling
│       └── vite-env.d.ts
```

## Backend Commands (Rust)

### `save_gateway_config(config: GatewayConfig)`
Persists gateway URL + API key to `config.dat` via `tauri-plugin-store`.

### `load_gateway_config() -> Option<GatewayConfig>`
Loads saved config on startup.

### `test_gateway_connection(config: GatewayConfig) -> GatewayResponse`
Health check: `GET {url}/api/v1/health` with Bearer auth.

### `send_chat_stream(config: GatewayConfig, request: ChatRequest, window: Window)`
SSE streaming to `POST {url}/api/v1/chat/completions` with `stream: true`.
Emits:
- `chat-stream-chunk` — each token chunk
- `chat-stream-end` — stream complete

## Frontend Flow
1. **Load config** → if saved, auto-test connection → show chat
2. **Config form** → user enters URL + API Key → test → save → enter chat
3. **Chat** → send message → streaming tokens appear → complete message added to history
4. **Settings button** → re-open config modal to change gateway

## Build Status
- `cargo check` passes (after fixing edition to 2021)
- `npm run build` in frontend works
- Ready for `cargo tauri dev` / `cargo tauri build`

## Key Fixes Applied
1. **Rust edition mismatch** — Changed `edition = "2024"` → `"2021"` in Cargo.toml (Rust 1.75 doesn't support 2024)
2. **Dependencies added** — `reqwest` (json, stream, rustls-tls), `futures-util`, `tokio(full)`
3. **Store plugin config** — Added `"store": { "autosave": true }` to tauri.conf.json plugins
4. **Frontend paths** — `frontendDist: "../frontend/dist"`, commands use `cd ../frontend`

## Next Steps for Production
1. Add `tauri-plugin-keyring` for secure API key storage (OS keychain)
2. Add app icons (replace placeholder icons in `src-tauri/icons/`)
3. Configure GitHub Actions matrix build (Linux .deb/.AppImage, macOS .dmg, Windows .msi)
4. Add Tauri auto-updater (`latest.json` generation)
5. Handle TLS certificate pinning for production gateways