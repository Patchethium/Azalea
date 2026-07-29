# Session Reference: Building hermes-desktop-client From Scratch (Complete)

## Project Overview
Created `peditxos/hermes-desktop-client` from scratch — fork of `tuan3w/hermes-webui-desktop` adapted for PeDitXOS organization.
Location: `/root/hermes-desktop-client` (Linux build env), built on Windows for release.

## Architecture Decisions

### Technology Stack
- **Frontend**: Static HTML + Vite 5 (no React/TSX — simplified)
- **Backend**: Tauri 2.11.3 (Rust 2021 edition)
- **Config/State**: `tauri-plugin-store` (gateway URL) + `tauri-plugin-keyring` (API Key)
- **HTTP Client**: `reqwest` with `danger_accept_invalid_certs(true)` for self-signed TLS
- **UI**: Custom CSS dark theme (Hermes branding)

### Key Design Choices
1. **Client-mode only** — User provides Gateway URL + API Key; no local agent/bundled gateway
2. **Manual credential entry every session** — **No auto-load, no auto-connect** (privacy/security preference)
3. **Self-signed TLS support** — Local Hermes Gateway uses self-signed certs
4. **Clean separation** — `desktop/` for frontend, `src-tauri/` for backend
5. **Submodule retained** — `hermes-webui` from `tuan3w/hermes-webui` for future integration

## Project Structure
```
hermes-desktop-client/
├── src-tauri/
│   ├── Cargo.toml              # edition = "2021", rust-version = "1.75"
│   ├── tauri.conf.json         # frontendDist: "../desktop/dist", identifier: com.peditxos.hermes-desktop-client
│   ├── build.rs
│   ├── capabilities/default.json
│   ├── icons/                  # 32x32, 128x128, 128x128@2x, icns, ico
│   └── src/
│       └── lib.rs              # Commands: connect_gateway, disconnect_gateway, get_stored_config, check_update, install_update
├── desktop/
│   ├── package.json            # Vite 5, scripts: dev/build
│   ├── vite.config.js          # outDir: 'dist', emptyOutDir: true
│   └── index.html              # Simple form: Gateway URL + API Key + Connect
├── .github/workflows/
│   ├── build-release.yml       # Matrix build (Linux deb/AppImage, macOS dmg x64/arm64, Windows NSIS)
│   └── sync-upstream.yml       # Daily hermes-webui submodule sync
├── scripts/
│   └── generate-update-manifest.py  # Auto-updater latest.json generator
└── hermes-webui/               # Submodule (tuan3w/hermes-webui)
```

## Backend Commands (Rust) — src-tauri/src/lib.rs

### `connect_gateway(request: ConnectRequest) -> ConnectResponse`
- Normalizes URL (adds https://, strips trailing slash)
- Health check: `GET {url}/health` with `Authorization: Bearer {api_key}`
- Self-signed TLS: `reqwest::Client::danger_accept_invalid_certs(true)`
- On success: saves URL to store, API Key to keyring, emits `navigate-to-gateway` event

### `disconnect_gateway()`
- Clears stored credentials (store + keyring)
- Emits `show-connection-screen` event

### `get_stored_config() -> StoredConfig`
- Returns only gateway_url from store (API Key in keyring, not returned)

### `check_update()` / `install_update()`
- Tauri auto-updater integration

## Frontend Flow (desktop/index.html)
1. **Form shown**: Gateway URL (text) + API Key (password) + Connect button
2. **Submit** → `connect_gateway` invoke
3. **Success** → `navigate-to-gateway` event → `window.location.href = gatewayUrl`
4. **No auto-connect on startup** — form always shown first
5. **No saved-config UI** — removed per privacy requirement

## Credential Storage Pattern
| Credential | Storage | Security |
|------------|---------|----------|
| Gateway URL | `tauri-plugin-store` (`config.dat`) | Plaintext (non-sensitive) |
| API Key | `tauri-plugin-keyring` | OS keychain (Windows Credential Manager, macOS Keychain, Linux Secret Service) |

## GitHub Actions CI/CD (Copied from Upstream)

### build-release.yml
- **Matrix**: Ubuntu (deb+AppImage), macOS (dmg x64/arm64), Windows (NSIS)
- **Signing**: `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- **Version**: Stamped from git tag (`v*`)
- **Artifacts**: All platform bundles + signatures + `latest.json`
- **Release**: `softprops/action-gh-release` on tag push

### sync-upstream.yml
- **Schedule**: Daily 06:00 UTC
- **Action**: `git submodule update --remote --merge hermes-webui`
- **Trigger**: Push on change → fires build-release

### generate-update-manifest.py
- Reads artifacts from `artifacts/` directory
- Generates `latest.json` for Tauri auto-updater
- Maps: linux-x86_64 → .AppImage, darwin-x86_64 → .dmg, darwin-aarch64 → .dmg, windows-x86_64 → .exe

## Hermes Gateway Connection

### API Key Retrieval
From running Hermes instance (`~/.hermes/config.yaml`):
```yaml
platforms:
  api_server:
    api_key: "7lrVRQLESGBwWneJ96Y_khApNAXAzOtnNm5JHoILZW0"
    enabled: true
```

### Tested Endpoints
```bash
# Health
curl https://10.1.1.215:8642/health
# → {"status":"ok","platform":"hermes-agent","version":"0.18.0"}

# Models
curl -H "Authorization: Bearer 7lrVRQLESGBwWneJ96Y_khApNAXAzOtnNm5JHoILZW0" \
  https://10.1.1.215:8642/v1/models
# → {"object":"list","data":[{"id":"hermes-agent",...}]}

# Chat
curl -X POST https://10.1.1.215:8642/v1/chat/completions \
  -H "Authorization: Bearer 7lrVRQLESGBwWneJ96Y_khApNAXAzOtnNm5JHoILZW0" \
  -H "Content-Type: application/json" \
  -d '{"model":"Hermes","messages":[{"role":"user","content":"سلام"}]}'
# → Full chat completion response
```

## Windows Build Setup (Tauri v2)

```powershell
# 1. Prerequisites (run in PowerShell Admin)
winget install Rustlang.Rust.GNU
winget install OpenJS.NodeJS.LTS

# 2. Restart terminal, verify
rustc --version      # 1.75+
cargo --version      # 1.75+
node --version       # v26+
npm --version        # 11+

# 3. Install Tauri CLI v2
cargo install tauri-cli --version "^2.0" --force

# 4. Add cargo bin to PATH (current session)
$env:PATH += ";$env:USERPROFILE\.cargo\bin"
# OR: Close and reopen PowerShell

# 5. Verify
cargo tauri --version  # tauri-cli 2.x.x

# 6. Clone & Build
git clone --recursive https://github.com/PeDitXOS/hermes-desktop-client.git
cd hermes-desktop-client
cargo tauri build

# 7. Output
# src-tauri\target\release\bundle\msi\hermes-desktop-client_*.msi
```

## Files Changed in This Session

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Added `danger_accept_invalid_certs(true)`, removed auto-load/auto-connect logic |
| `desktop/index.html` | Simplified to manual-only credential form |
| `src-tauri/tauri.conf.json` | Fixed `frontendDist` to `../desktop/dist`, identifier `com.peditxos.hermes-desktop-client` |
| `desktop/vite.config.js` | `outDir: 'dist'`, `emptyOutDir: true`, input `index.html` |
| `.github/workflows/build-release.yml` | Complete upstream CI/CD |
| `.github/workflows/sync-upstream.yml` | Daily submodule sync |
| `scripts/generate-update-manifest.py` | Auto-updater manifest generator |

## Gotchas Encountered & Fixes

| Issue | Fix |
|-------|-----|
| `tauri.conf.json` pointed to `../frontend/dist` (didn't exist) | Changed to `../desktop/dist` |
| Submodule `.git` file pointed to missing `../.git/modules/hermes-webui` | `rm -rf hermes-webui && git submodule add https://github.com/tuan3w/hermes-webui hermes-webui` |
| Windows: `cargo tauri` not found | `$env:PATH += ";$env:USERPROFILE\.cargo\bin"` or restart terminal |
| Linux build fails: missing `pkg-config`, `webkit2gtk`, `glib` | Expected — build on Windows/macOS runners |
| Rust edition lint errors (2015) | Pre-existing, `edition = "2021"` in Cargo.toml is correct |

## Architecture Diagram

```
┌─────────────────────────────────────────────┐
│         hermes-desktop-client               │
├─────────────────────────────────────────────┤
│  Frontend: desktop/index.html (Vite + HTML) │
│  - Gateway URL input                        │
│  - API Key input (password)                 │
│  - Connect button                           │
├─────────────────────────────────────────────┤
│  Backend: src-tauri/src/lib.rs (Rust)       │
│  - connect_gateway: /health + save creds    │
│  - disconnect_gateway: clear + return form  │
│  - Self-signed TLS: danger_accept_invalid   │
│  - Store (URL) + Keyring (API Key)          │
├─────────────────────────────────────────────┤
│  Submodule: hermes-webui (tuan3w)           │
│  - Available for future webview integration │
└─────────────────────────────────────────────┘
          │
          ▼ HTTPS + Bearer Token
┌─────────────────────────────────────────────┐
│      Hermes Gateway (10.1.1.215:8642)       │
│  - /health (GET)                            │
│  - /v1/models (GET)                         │
│  - /v1/chat/completions (POST)              │
│  - Self-signed TLS                          │
└─────────────────────────────────────────────┘
```

## Next Steps for Production

1. **App icons** — Replace placeholder icons in `src-tauri/icons/`
2. **Code signing** — Configure `TAURI_SIGNING_PRIVATE_KEY` secrets in GitHub
3. **Auto-updater** — Test `latest.json` with actual releases
4. **Windows App SDK** — Ensure WebView2 runtime (included in NSIS bundle)
5. **macOS notarization** — Add `apple-id` / `apple-password` secrets
6. **Linux** — Test AppImage on target distros (Ubuntu 22.04+, Arch, Fedora)

## Related Skills
- `hermes-agent` — Hermes Gateway configuration, CLI, Gateway setup
- `loopkit` — Planning/verification loop for complex builds
- `github-actions-setup` — CI/CD pipeline patterns
- `passwall-build` — GitHub Actions patterns for signed releases