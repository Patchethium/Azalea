---
name: tauri-desktop-builder
description: "Build ANY Tauri 2 desktop app: CRUD, dashboard, chat, utility, media, API client. Auto-triggers on 'desktop build', 'tauri build'. React frontend, optional Python sidecar, CI/CD for all platforms. ALL work parallel via subagents."
version: 4.0.0
author: PeDitXOS
license: Apache-2.0
platforms: [linux, macos, windows]
triggers:
  - desktop build
  - tauri build
  - build desktop
  - build tauri
  - new tauri app
  - new desktop app
prerequisites:
  commands: [node, rust, cargo, npm]
metadata:
  hermes:
    tags: [tauri, desktop, react, python, rust, typescript, ci-cd, parallel]
    related_skills: [tauri-desktop-apps, tauri-desktop-client, github-actions-setup]
    category: software-development
    requires_toolsets: [terminal, file, delegation]
---

# Tauri Desktop Builder — Universal

Build ANY type of desktop app with Tauri 2. Not tied to specific project types.

## Supported App Types

| Type | What It Does |
|------|-------------|
| **Dashboard** | Analytics, monitoring, admin panels with charts/tables |
| **Chat / AI Client** | ChatGPT-like apps, AI assistants, multimodal |
| **CRUD App** | Todo, notes, CRM, inventory — forms + database |
| **Media Tool** | Image editor, video player, audio recorder |
| **Utility** | Clipboard manager, file converter, screenshot tool |
| **API Client** | REST/GraphQL tester, API dashboard |
| **CLI Wrapper** | Git GUI, Docker manager, SSH client |
| **Dev Tool** | DB viewer, log viewer, API mock server |

## When to Use

- ساخت هر نوع اپ دسکتاپ با Tauri 2
- اضافه کردن feature به اپ موجود
- ادغام Python برای پردازش محلی
- GitHub Actions CI/CD cross-platform

**استفاده نکن:** اپ موبایل، اپ وب فقط

---

## PARALLEL EXECUTION (MANDATORY)

### Subagent Roles

| Role | کار | Verify |
|------|-----|--------|
| `rust-backend` | lib.rs, plugins, db, sidecar | `cargo check` |
| `react-frontend` | components, hooks, stores, styles | `npm run typecheck` |
| `python-sidecar` | server.py (if needed) | `python3 -c '...'` |
| `testing` | Rust + Vitest tests | `cargo test && npm run test` |
| `ci-cd` | GitHub Actions workflows | YAML check |

### ساخت اولیه اپ (4 subagent)

```python
delegate_task(tasks=[
    {
        "goal": "Create Rust backend: main.rs + lib.rs + Cargo.toml + tauri.conf.json",
        "context": "Create Tauri 2 Rust backend. VERIFY: cargo check",
        "role": "leaf"
    },
    {
        "goal": "Create React frontend: components + hooks + store + styles",
        "context": "Create React + TS + Vite + Tailwind frontend. VERIFY: npm run typecheck",
        "role": "leaf"
    },
    {
        "goal": "Create Python sidecar (if needed)",
        "context": "FastAPI on 127.0.0.1:8765. VERIFY: python3 -c 'import ast; ...'",
        "role": "leaf"
    },
    {
        "goal": "Create GitHub Actions CI/CD",
        "context": "Matrix build: windows + macos + linux. tauri-action@v1, releaseDraft:false. VERIFY: yamllint",
        "role": "leaf"
    },
])
```

### اضافه کردن feature (3 subagent)

```python
delegate_task(tasks=[
    {
        "goal": "Rust: Add command in lib.rs",
        "context": "VERIFY: cargo check",
        "role": "leaf"
    },
    {
        "goal": "React: Add component + hook + store",
        "context": "VERIFY: npm run typecheck",
        "role": "leaf"
    },
    {
        "goal": "Testing: Add tests",
        "context": "VERIFY: cargo test && npm run test",
        "role": "leaf"
    },
])
```

### Fix مشکل (2 subagent)

```python
delegate_task(tasks=[
    {"goal": "Fix in Rust backend", "context": "VERIFY: cargo check", "role": "leaf"},
    {"goal": "Fix in React frontend", "context": "VERIFY: npm run typecheck", "role": "leaf"},
])
```

### Rebrand (2 subagent)

```python
delegate_task(tasks=[
    {"goal": "Rebrand Rust: OldName → NewName in .rs, .toml, .json", "context": "VERIFY: cargo check", "role": "leaf"},
    {"goal": "Rebrand Frontend: OldName → NewName in .tsx, .ts, .json", "context": "VERIFY: npm run typecheck", "role": "leaf"},
])
```

---

## Project Structure

```
YourApp/
├── src/                          # React + TypeScript
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   ├── store/                    # Zustand
│   └── styles.css                # Tailwind
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs                # Tauri commands
│   │   └── ...
│   ├── capabilities/default.json
│   ├── Cargo.toml
│   └── tauri.conf.json
├── python/                       # Optional
└── .github/workflows/
```

---

## Key Patterns

### Tauri Command

```rust
// src-tauri/src/lib.rs
#[tauri::command]
fn greet(name: String) -> Result<String, String> {
    Ok(format!("Hello, {name}!"))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error");
}
```

### React invoke

```typescript
import { invoke } from '@tauri-apps/api/core';
const result = await invoke<string>('greet', { name: 'World' });
```

### Zustand Store

```typescript
import { create } from 'zustand';
const useStore = create<AppState>((set) => ({
  items: [],
  addItem: async (item) => {
    await invoke('add_item', { item });
    set((s) => ({ items: [...s.items, item] }));
  },
}));
```

### Custom Hook

```typescript
function useTauriCommand<TArgs, TResult>(cmd: string) {
  const [data, setData] = useState<TResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const execute = useCallback(async (args?: TArgs) => {
    setLoading(true); setError(null);
    try {
      const r = await invoke<TResult>(cmd, args as any);
      setData(r); return r;
    } catch (e) { setError(String(e)); throw e; }
    finally { setLoading(false); }
  }, [cmd]);
  return { data, loading, error, execute };
}
```

### SQLite Database

```rust
use rusqlite::Connection;
let conn = Connection::open("app.db")?;
conn.execute_batch("PRAGMA journal_mode=WAL;")?;
conn.execute("INSERT INTO t (col) VALUES (?1)", params![value])?;
```

### Streaming (SSE)

```typescript
const resp = await fetch(url, { method: 'POST', body: JSON.stringify({ stream: true }) });
const reader = resp.body!.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  // Parse SSE lines
}
```

### System Tray

```rust
use tauri::tray::TrayIconBuilder;
TrayIconBuilder::new()
    .icon(app.default_window_icon().unwrap().clone())
    .on_menu_event(|app, event| { /* handle */ })
    .build(app)?;
```

---

## GitHub Actions CI/CD — All 3 Platforms

```yaml
name: Build
on: [workflow_dispatch, push]
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

## GitHub Actions Pitfalls

| مشکل | راه حل |
|------|--------|
| `startup_failure` | `default_workflow_permissions: "write"` |
| `tauri-action@v0` not found | Use `@v1` |
| `releaseDraft: true` (default) | ALWAYS set `releaseDraft: false` |
| FFmpeg action fail | `choco install ffmpeg -y` on Windows |
| Icon not found | `src-tauri/icons/icon.ico` + `icon.png` |

---

## Fork & Rebrand Checklist

1. `gh repo create You/YourApp --fork upstream/repo`
2. Replace `OldName` → `NewName` in all files
3. Update: tauri.conf.json, package.json, Cargo.toml
4. Replace icons in `src-tauri/icons/`
5. `npm run typecheck && cargo check`

---

## Security

- CSP minimal in tauri.conf.json
- IPC permissions in capabilities/default.json (least privilege)
- API keys in OS keyring, not plaintext
- Input validation on all commands

---

## User Preference: Functionality First

Do NOT create UI without wiring to actual logic.
Every element MUST read/write state and trigger real actions.

---

## References

Full patterns: `tauri-desktop-apps` → references/

---

## Related Skills

- `tauri-desktop-apps` — Complete Tauri 2 reference (all patterns)
- `tauri-desktop-client` — Client apps connecting to remote APIs
- `github-actions-setup` — CI/CD pipeline patterns
