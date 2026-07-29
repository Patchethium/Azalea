---
name: tauri-desktop-apps
description: "UNIVERSAL Tauri 2 skill for ANY desktop app — web apps, CRUD, dashboards, utilities, chat apps, media tools, CLI wrappers, AI apps. Auto-triggers on 'desktop' keyword. Rust backend, React frontend, Python sidecar. ALL work parallel via subagents."
version: 4.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
triggers:
  - desktop
  - tauri
  - tauri app
  - desktop app
  - tauri build
  - tauri dev
  - rust desktop
  - build desktop app
metadata:
  hermes:
    tags: [tauri, rust, react, python, desktop, cross-platform]
    related_skills: [github-actions-setup]
    category: software-development
---

# Tauri 2 Desktop App Development — Universal Reference

Build ANY type of desktop app with Tauri 2. Not tied to any specific project type.

## Supported App Types

| Type | Example | Key Features |
|------|---------|-------------|
| **Dashboard** | Analytics, monitoring, admin panel | Charts, tables, real-time data |
| **Chat / AI** | ChatGPT client, AI assistant | SSE streaming, markdown, multimodal |
| **CRUD** | Todo app, note manager, CRM | Forms, database, search |
| **Media** | Image editor, video tool, audio player | FFmpeg, canvas, playback |
| **Utility** | Clipboard manager, file converter, system monitor | System tray, hotkeys, file I/O |
| **API Client** | REST/GraphQL client, API tester | HTTP requests, auth, history |
| **CLI Wrapper** | Git GUI, Docker manager, SSH client | Process management, terminal |
| **Dev Tool** | Database viewer, log viewer, API mock | SQLite, WebSocket, file watching |

## When to Use

- Building ANY Tauri 2 desktop app
- Adding features to an existing Tauri app
- Setting up cross-platform builds (Windows/Mac/Linux)
- Integrating Python for local processing
- Setting up CI/CD

## Prerequisites

- Rust (stable, 1.75+) + Node >= 20
- `@tauri-apps/cli@2` in devDependencies

---

## PARALLEL EXECUTION PLAYBOOK (MANDATORY)

### Rule: EVERYTHING IS PARALLEL by default

When this skill activates, ALL independent work MUST run via delegate_task subagents concurrently.

### Subagent Roles

| Role | Responsibility | Verify |
|------|---------------|--------|
| `rust-backend` | All Rust code: commands, state, plugins, db, sidecar | `cargo check` |
| `react-frontend` | All React/TypeScript: components, hooks, stores, styles | `npm run typecheck` |
| `python-sidecar` | Python scripts (if needed) | `python3 -c 'import ast; ast.parse(...)'` |
| `testing` | Rust tests + frontend tests | `cargo test && npm run test` |
| `ci-cd` | GitHub Actions workflows | YAML syntax check |

### Pattern 1: New App (4 parallel agents)

```python
delegate_task(tasks=[
    {
        "goal": "Create Rust backend: main.rs + lib.rs + Cargo.toml + tauri.conf.json",
        "context": """Create Tauri 2 Rust backend.
PROJECT: {project_path}/src-tauri/
Create: main.rs (entry), lib.rs (Tauri commands + state).
Cargo.toml: tauri 2, serde, serde_json, reqwest (if needed).
tauri.conf.json: window config, CSP, plugins.
VERIFY: cargo check""",
        "role": "leaf"
    },
    {
        "goal": "Create React frontend: components + hooks + store + styles",
        "context": """Create React + TypeScript + Vite + Tailwind frontend.
PROJECT: {project_path}/src/
Create: App.tsx, components/, hooks/, store/ (Zustand), styles.css.
package.json: @tauri-apps/api, zustand, tailwindcss.
VERIFY: npm run typecheck""",
        "role": "leaf"
    },
    {
        "goal": "Create Python sidecar (if needed for local processing)",
        "context": """Create Python FastAPI sidecar.
PROJECT: {project_path}/python/
server.py (FastAPI on 127.0.0.1:8765, CORS for tauri://localhost).
VERIFY: python3 -c 'import ast; ast.parse(open("server.py").read())'""",
        "role": "leaf"
    },
    {
        "goal": "Create GitHub Actions CI/CD workflows",
        "context": """Create GitHub Actions for Tauri build.
PROJECT: {project_path}/.github/workflows/
build.yml: matrix build (windows, macos, linux), tauri-action@v1, releaseDraft:false.
VERIFY: yamllint""",
        "role": "leaf"
    },
])
```

### Pattern 2: Add Feature (3 parallel agents)

```python
delegate_task(tasks=[
    {
        "goal": "Rust: Add command/feature in lib.rs",
        "context": "Add #[tauri::command] in lib.rs. VERIFY: cargo check",
        "role": "leaf"
    },
    {
        "goal": "React: Add component + hook + store slice",
        "context": "Create component, useTauriCommand hook, Zustand slice. VERIFY: npm run typecheck",
        "role": "leaf"
    },
    {
        "goal": "Add tests for feature",
        "context": "Rust #[cfg(test)] + Vitest. VERIFY: cargo test && npm run test",
        "role": "leaf"
    },
])
```

### Pattern 3: Fix Bug (2 parallel agents)

```python
delegate_task(tasks=[
    {
        "goal": "Debug + fix in Rust backend",
        "context": "Search src-tauri/src/. Fix. VERIFY: cargo check",
        "role": "leaf"
    },
    {
        "goal": "Debug + fix in React frontend",
        "context": "Search src/. Fix. VERIFY: npm run typecheck",
        "role": "leaf"
    },
])
```

### Pattern 4: Full Build (3 parallel agents)

```python
delegate_task(tasks=[
    {
        "goal": "Rust: cargo check + cargo test",
        "context": "Run cargo check, fix errors, then cargo test.",
        "role": "leaf"
    },
    {
        "goal": "React: npm run typecheck + npm run build",
        "context": "Fix TS errors, then build.",
        "role": "leaf"
    },
    {
        "goal": "CI/CD: validate all workflows",
        "context": "Check .github/workflows/*.yml syntax.",
        "role": "leaf"
    },
])
```

### When Sequential (NOT Parallel)
- Two agents edit the SAME file → sequential or merge after
- Agent B needs output from Agent A
- Build ordering dependency

---

## Project Structure (Generic)

```
YourApp/
├── src/                          # React/TypeScript frontend
│   ├── components/               # UI components
│   ├── hooks/                    # Custom hooks
│   ├── lib/                      # Utility libraries
│   ├── store/                    # Zustand state
│   ├── types/                    # TypeScript types
│   └── styles.css                # Tailwind + theme
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   ├── lib.rs                # Tauri commands + state
│   │   ├── db.rs                 # Optional: SQLite
│   │   └── error.rs              # Optional: custom errors
│   ├── capabilities/
│   │   └── default.json          # IPC permissions
│   ├── Cargo.toml
│   └── tauri.conf.json
├── python/                       # Optional: Python sidecar
└── .github/workflows/            # CI/CD
```

---

## Reference Files

All in [references/](references/):

| File | Topic |
|------|-------|
| [react-tauri-patterns.md](references/react-tauri-patterns.md) | React + Tauri: hooks, stores, SSE, components |
| [python-sidecar-pattern.md](references/python-sidecar-pattern.md) | Python integration: subprocess, HTTP, PyO3, FFI |
| [cross-platform-patterns.md](references/cross-platform-patterns.md) | Matrix builds, macOS/Linux/Windows specifics |
| [streaming-patterns.md](references/streaming-patterns.md) | SSE, WebSocket, Tauri events |
| [security-patterns.md](references/security-patterns.md) | CSP, IPC permissions, keyring |
| [database-patterns.md](references/database-patterns.md) | SQLite with rusqlite or tauri-plugin-sql |
| [testing-patterns.md](references/testing-patterns.md) | Rust unit tests, Vitest, E2E |
| [tauri-v2-plugins.md](references/tauri-v2-plugins.md) | Plugin catalog, custom plugins |
| [auto-updater-pattern.md](references/auto-updater-pattern.md) | Signing, latest.json, update UI |
| [error-handling-patterns.md](references/error-handling-patterns.md) | Rust Result, custom errors |
| [multi-window-tray.md](references/multi-window-tray.md) | System tray, multi-window |

---

## Quick Reference: Core Patterns

### Tauri Command (Rust)
```rust
#[tauri::command]
fn my_command(param: String) -> Result<String, String> {
    // Do work
    Ok(format!("result: {param}"))
}
```

### Invoke from React
```typescript
import { invoke } from '@tauri-apps/api/core';
const result = await invoke<string>('my_command', { param: 'hello' });
```

### Zustand Store
```typescript
import { create } from 'zustand';
const useStore = create<AppState>((set) => ({
  data: null,
  fetch: async () => {
    const data = await invoke('get_data');
    set({ data });
  },
}));
```

### Custom Hook
```typescript
const { data, loading, error, execute } = useTauriCommand<Args, Result>('cmd');
```

---

## Cross-Platform Build Matrix

| Platform | Runner | System Deps | Bundles |
|----------|--------|-------------|---------|
| **Windows** | `windows-latest` | `choco install ffmpeg` (if media) | NSIS + MSI |
| **macOS** | `macos-latest` | None (WebKit native) | DMG |
| **Linux** | `ubuntu-22.04` | `libwebkit2gtk-4.1-dev` + 4 deps | AppImage + deb |

### CI/CD Workflow (All 3 Platforms)

```yaml
name: Release
on: { push: { tags: ['v*'] } }
permissions: { contents: write }
jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            args: '--bundles nsis,msi'
          - os: macos-latest
            args: '--bundles dmg'
          - os: ubuntu-22.04
            args: '--bundles appimage,deb'
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - name: Install deps (Linux)
        if: runner.os == 'Linux'
        run: sudo apt-get update && sudo apt-get install -y \
          libwebkit2gtk-4.1-dev libgtk-3-dev libappindicator3-dev librsvg2-dev patchelf
      - run: npm ci && npm run build
      - uses: tauri-apps/tauri-action@v1
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
        with:
          tagName: ${{ github.ref_name }}
          releaseDraft: false
          args: ${{ matrix.args }}
```

---

## Security (Quick Reference)

1. **CSP** in tauri.conf.json: `default-src 'self'; connect-src 'self' http://127.0.0.1:*`
2. **IPC Permissions** in `capabilities/default.json`
3. **API Keys** in OS keyring (NOT plaintext)
4. **Input validation** on all `#[tauri::command]` parameters

---

## Database (Quick Reference)

```rust
use rusqlite::Connection;
let conn = Connection::open(&db_path)?;
conn.execute_batch("PRAGMA journal_mode=WAL;")?;
```

---

## Error Handling (Quick Reference)

```rust
fn cmd() -> Result<Data, String> {
    let val = operation().map_err(|e| format!("failed: {e}"))?;
    Ok(val)
}
```

---

## User Preference: Functionality First

CRITICAL: Do NOT create UI without wiring to actual logic.
Every UI element MUST read/write state and trigger real actions.

---

## Related Skills

- `tauri-desktop-builder` — Building apps with specific integrations (MCP, AI, MIDI)
- `tauri-desktop-client` — Client apps connecting to remote APIs
- `github-actions-setup` — CI/CD pipeline patterns
