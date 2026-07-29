# Client-Mode Tauri App (Gateway URL + API Key Input)

This reference documents the **Client Mode** pattern built in this session — a Tauri v2 app that connects to a user-provided Hermes Gateway (no local agent, no Python sidecar).

## Project: `peditxos/hermes-desktop-client`

Fork of `tuan3w/hermes-webui-desktop` (archived), converted from **local agent mode** to **gateway client mode**.

## Key Differences from Main Skill

| Main Skill Pattern | Client Mode Pattern |
|--------------------|---------------------|
| Bundles Python + `hermes-webui` + local agent | Pure webview — no Python, no local agent |
| Runs local FastAPI server on random port | Loads gateway URL directly in webview |
| Auto-installs `hermes-agent` via `uv` | User provides Gateway URL + API Key |
| Single-instance local server | Multi-user, connects to remote gateway |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Hermes Desktop Client (Tauri v2 + Rust)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Connection   │  │  System      │  │  Auto-updater    │  │
│  │  Screen      │──│  Tray        │──│  (GitHub Releases)│  │
│  │  (Gateway    │  │  (Open,      │  └──────────────────┘  │
│  │   URL + Key) │  │   Disconnect)│                        │
│  └──────┬───────┘  └──────────────┘                         │
│         │                                                  │
│         ▼                                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Webview → loads https://gateway.example.com          │  │
│  │ Injects API Key via localStorage on page load        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │ HTTPS + Bearer Token
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Hermes Gateway (user-hosted or Nous Cloud)                 │
└─────────────────────────────────────────────────────────────┘
```

## Tauri Config (`src-tauri/tauri.conf.json`)

```json
{
  "productName": "Hermes Desktop Client",
  "identifier": "com.peditxos.hermes-desktop-client",
  "build": { "frontendDist": "../desktop" },
  "plugins": {
    "updater": {
      "pubkey": "RWRGSiyCnCULFan9LJpL8w8i3DffC7x3OWg+Tblwst1ehHCK48SZ1AQt",
      "endpoints": ["https://github.com/peditxos/hermes-desktop-client/releases/latest/download/latest.json"]
    },
    "store": {}, "keyring": {}
  },
  "bundle": { "targets": "all", "externalBin": [], "resources": [] }
}
```

## Cargo Dependencies (`src-tauri/Cargo.toml`)

```toml
tauri = { version = "2", features = ["tray-icon", "devtools"] }
tauri-plugin-store = "2"
tauri-plugin-keyring = "0.1"
tauri-plugin-updater = "2"
tauri-plugin-opener = "2"
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["net", "time"] }
```

## Core Commands (`src-tauri/src/lib.rs`)

| Command | Purpose |
|---------|---------|
| `connect_gateway(url, api_key)` | Validates gateway `/health`, saves creds, navigates webview |
| `disconnect_gateway()` | Clears keyring/store, returns to connection screen |
| `get_stored_config()` | Returns saved gateway URL (key stays in keyring) |
| `get_connection_status()` | Returns `{ connected, gateway_url, has_api_key }` |
| `check_update()` / `install_update()` | Auto-updater via GitHub Releases |
| `open_external(url)` | Opens gateway dashboard in browser |

## Credential Storage

- **Gateway URL** → `tauri-plugin-store` (`config.dat`, plaintext)
- **API Key** → `tauri-plugin-keyring` (OS keychain: Windows Credential Manager, macOS Keychain, Linux Secret Service)

## Frontend (`desktop/index.html`)

Single-page connection screen with:
- Saved config display (auto-connect button)
- Gateway URL input (auto-prepends `https://`)
- API Key input (password field)
- Connect / Disconnect actions
- "Open Gateway Dashboard" button
- Update banner injection via `window.__TAURI__.core.invoke`

## Auto-connect Flow

1. App starts → loads `index.html`
2. Backend reads store + keyring
3. If both exist → emits `auto-connect` event
4. Frontend calls `connect_gateway` with saved URL + empty key (backend uses stored key)
5. On success → backend emits `navigate-to-gateway` with URL
6. Frontend `window.location.href = gatewayUrl`
7. On gateway page load → injects API key into `localStorage`, reloads

## GitHub Actions (`.github/workflows/build-release.yml`)

Matrix build on tag push (`v*`):
- `ubuntu-latest` → AppImage + .deb
- `macos-latest` (x64 + ARM64) → .dmg
- `windows-latest` → .msi (NSIS)

`generate-update-manifest.py` creates `latest.json` for auto-updater.

## Build Commands

```bash
# Prerequisites: Rust stable, Node.js 18+, cargo install tauri-cli
cd hermes-desktop-client
cargo tauri build

# Output: src-tauri/target/release/bundle/
#   linux/   hermes-desktop-client_*.AppImage, *_amd64.deb
#   macos/   Hermes Desktop Client_*.dmg
#   windows/ hermes-desktop-client_*_x64.msi
```

## Testing Checklist

- [ ] First launch: shows connection screen
- [ ] Valid gateway URL + API key → connects, loads gateway UI
- [ ] API key stored in OS keyring (verify: Credential Manager / Keychain / `secret-tool`)
- [ ] Gateway URL stored in `config.dat`
- [ ] Restart app → auto-connects, navigates to gateway
- [ ] Tray menu: Open / Disconnect / Check Updates / Quit
- [ ] Close window → hides to tray (not quit)
- [ ] Disconnect → clears creds, returns to connection screen
- [ ] Update check works (on tag push)
- [ ] Build artifacts produced for all 3 platforms

## Relationship to Main Skill

This pattern **replaces** the "local agent + Python sidecar" approach when:
- User wants a dedicated installed app (not browser)
- User connects to ANY Hermes Gateway (not just 9Router-backed)
- No local agent installation desired

The main skill's "Hermes Desktop Remote Connection" section describes connecting the official Hermes desktop to a gateway. This reference describes a **purpose-built client-mode app** for the same workflow.