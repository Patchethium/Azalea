# Session: PeDitXOS hermes-desktop-client Build & Deploy

## Context
- User: PeDram (PeDitXOS)
- Repo: `peditxos/hermes-desktop-client` (fork of `tuan3w/hermes-webui-desktop`)
- Goal: Cross-platform Tauri v2 desktop client for Hermes Gateway
- Architecture: Client-mode — user provides Gateway URL + API Key, app connects to their self-hosted gateway

## Key Technical Decisions

### 1. Manual Credential Entry (No Auto-Connect)
- User must enter Gateway URL + API Key **every session**
- No saved-config section, no auto-connect, no auto-load on startup
- Credentials saved **only after successful connect** (URL → store, API Key → OS keyring)
- Privacy/security choice — explicit user consent each time

### 2. Self-Signed TLS Support
```rust
// Required for local gateway with self-signed certs
let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(10))
    .danger_accept_invalid_certs(true)  // ← Critical for local HTTPS
    .build()?;
```

### 3. Submodule Handling (hermes-webui)
```bash
# Submodule: hermes-webui → https://github.com/tuan3w/hermes-webui
# If corrupted .git file (points to missing ../.git/modules/):
rm -rf hermes-webui
git submodule add https://github.com/tuan3w/hermes-webui hermes-webui
# Or if already in .gitmodules:
git submodule update --init --recursive
```

### 4. GitHub Actions — Complete Upstream CI/CD
Copied from `tuan3w/hermes-webui-desktop`:
- `.github/workflows/build-release.yml` — Matrix builds (Linux deb/AppImage, macOS dmg x64/arm64, Windows NSIS) + signing + `latest.json`
- `.github/workflows/sync-upstream.yml` — Daily hermes-webui submodule sync to upstream master
- `.github/scripts/generate-update-manifest.py` — Auto-updater manifest generator

### 5. Tauri Config — Static HTML (No Vite Build)
```json
// src-tauri/tauri.conf.json
{
  "build": {
    "frontendDist": "../desktop",     // ← Direct static files, no dist/
    "devUrl": "http://localhost:5173"
  }
}
```
**No** `beforeDevCommand` / `beforeBuildCommand` — static `index.html` served directly.

### 6. Windows Build Setup (Tauri v2)
```powershell
winget install Rustlang.Rust.GNU
winget install OpenJS.NodeJS.LTS
cargo install tauri-cli --version "^2.0"
$env:PATH += ";$env:USERPROFILE\.cargo\bin"
cargo tauri build
# Output: src-tauri\target\release\bundle\msi\hermes-desktop-client_*.msi
```

### 7. Credential Storage Pattern
| Credential | Storage | Reason |
|------------|---------|--------|
| Gateway URL | `tauri-plugin-store` (`config.dat`) | Plaintext, user-readable |
| API Key | `tauri-plugin-keyring` (OS keychain) | Encrypted, platform-native |

### 8. Hermes Gateway API Key Source
From `~/.hermes/config.yaml`:
```yaml
platforms:
  api_server:
    api_key: "7lrVRQLESGBwWneJ96Y_khApNAXAzOtnNm5JHoILZW0"
    enabled: true
```

### 9. Tag-Based Release Workflow
```bash
git tag v0.1.1 && git push origin v0.1.1
# Triggers: build-release.yml → matrix build → GitHub Release with artifacts
```

## Fixes Applied This Session

| Issue | Fix |
|-------|-----|
| `cd: can't cd to ../desktop` in CI | Added `actions/setup-node@v4` to all 3 build jobs; fixed `tauri.conf.json` frontendDist |
| Node.js not installed on runners | `setup-node` with npm cache |
| Vite build step failing (static HTML) | Removed `beforeDevCommand`/`beforeBuildCommand`; set `frontendDist: ../desktop` |
| Submodule `.git` corruption | `rm -rf hermes-webui && git submodule add ...` |
| Auto-connect on startup | Removed — user enters credentials every session |
| Self-signed cert rejection | Added `danger_accept_invalid_certs(true)` to reqwest client |

## Verification Commands
```bash
# Local build test
cd hermes-desktop-client
npm install --prefix desktop
cd desktop && npm run build
cargo tauri build

# Check CI status
gh run list --repo PeDitXOS/hermes-desktop-client --limit 3
gh run view <run-id> --repo PeDitXOS/hermes-desktop-client --log-failed
```

## Current State
- Tag: `v0.1.1` pushed, build queued (GitHub runners busy)
- Repo: `https://github.com/PeDitXOS/hermes-desktop-client`
- Gateway: `https://10.1.1.215:8642` (user's local)
- API Key: Stored in Telegram Saved Messages (msg 2834)