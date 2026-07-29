---
name: tauri-desktop-client
description: "Build Tauri v2 desktop CLIENTS for ANY remote API — not just Gateway. Works with OpenAI, 9Router, any REST/GraphQL API. Auto-triggers on 'desktop client', 'api client', 'connect desktop'. Streaming chat, credential storage, auto-updater. ALL work parallel."
version: 4.0.0
author: PeDitXOS
license: Apache-2.0
platforms: [linux, macos, windows]
triggers:
  - desktop client
  - tauri client
  - api client desktop
  - connect desktop
  - hermes desktop
  - desktop connect
  - chat client
metadata:
  hermes:
    tags: [tauri, rust, react, desktop-client, api-client, streaming, parallel]
    related_skills: [tauri-desktop-apps, tauri-desktop-builder, github-actions-setup]
    category: software-development
    requires_toolsets: [terminal, file, delegation]
---

# Tauri Desktop Client — Universal

Build desktop clients for ANY remote API backend. Not tied to specific APIs.

## Supported Backend Types

| Backend | Auth | Streaming |
|---------|------|-----------|
| **OpenAI API** | Bearer token | SSE |
| **Anthropic API** | Bearer token | SSE |
| **Any REST API** | Custom headers | Optional |
| **GraphQL API** | Bearer token | Optional |
| **WebSocket API** | Token in URL | Native WS |
| **Self-hosted Gateway** | Bearer token | SSE |
| **Local API (Ollama)** | None | SSE |

## When to Use

- اتصال دسکتاپ اپ به یک API backend ریموت
- کاربر URL + API Key خودش رو وارد کنه
- نیاز به streaming chat
- نیاز به Python برای پردازش محلی
- انتشار cross-platform

## When NOT to Use

- اپ وب فقط
- اپ موبایل
- Backend محلی نمی‌خوای (از tauri-desktop-builder استفاده کن)

---

## PARALLEL EXECUTION (MANDATORY)

### Subagent Roles

| Role | کار | Verify |
|------|-----|--------|
| `rust-backend` | lib.rs, api_client.rs, config.rs | `cargo check` |
| `react-frontend` | ConnectionScreen, Chat, Settings, store | `npm run typecheck` |
| `python-sidecar` | server.py (optional) | `python3 -c '...'` |
| `ci-cd` | build-release.yml | YAML check |

### ساخت اولیه (4 subagent)

```python
delegate_task(tasks=[
    {
        "goal": "Create Rust backend: config + API client + Tauri commands",
        "context": """Create Tauri v2 Rust backend.
Create: main.rs, lib.rs (connect, chat, stream, config),
api_client.rs (reqwest with Bearer auth).
VERIFY: cargo check""",
        "role": "leaf"
    },
    {
        "goal": "Create React frontend: ConnectionScreen + Chat + Settings",
        "context": """Create React frontend.
ConnectionScreen.tsx (URL + API Key form),
Chat.tsx (SSE streaming),
Settings.tsx (provider, model, theme),
appStore.ts (Zustand).
VERIFY: npm run typecheck""",
        "role": "leaf"
    },
    {
        "goal": "Create Python sidecar (optional)",
        "context": "FastAPI on 127.0.0.1:8765. VERIFY: python3 -c 'import ast; ast.parse(open(\"server.py\").read())'",
        "role": "leaf"
    },
    {
        "goal": "Create CI/CD matrix build",
        "context": "GitHub Actions: windows + macos + linux. tauri-action@v1, releaseDraft:false.",
        "role": "leaf"
    },
])
```

---

## Project Structure

```
my-desktop-client/
├── src/
│   ├── components/
│   │   ├── ConnectionScreen.tsx   # URL + API Key form
│   │   ├── Chat.tsx               # SSE streaming
│   │   └── Settings.tsx           # Provider/model/theme
│   ├── hooks/
│   │   └── useTauriCommand.ts
│   ├── store/
│   │   └── appStore.ts            # Zustand
│   └── styles.css
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs                 # Commands
│   │   ├── api_client.rs          # HTTP client (reqwest)
│   │   └── config.rs              # Config persistence
│   ├── Cargo.toml
│   └── tauri.conf.json
└── .github/workflows/
```

---

## Core Implementation

### Config Persistence (Rust)

```rust
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ClientConfig {
    pub api_url: String,
    pub api_key: String,
}

impl ClientConfig {
    fn path(app: &AppHandle) -> std::path::PathBuf {
        app.path().app_config_dir().expect("no config dir").join("config.json")
    }
    pub fn load(app: &AppHandle) -> Self {
        let p = Self::path(app);
        if p.exists() {
            std::fs::read_to_string(&p).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
        } else { Self::default() }
    }
    pub fn save(&self, app: &AppHandle) -> Result<(), String> {
        let p = Self::path(app);
        if let Some(parent) = p.parent() { std::fs::create_dir_all(parent).ok(); }
        std::fs::write(&p, serde_json::to_string_pretty(self).unwrap()).map_err(|e| e.to_string())
    }
}
```

### API Client (Rust)

```rust
use reqwest::Client;

pub struct ApiClient {
    client: Client,
    base_url: String,
}

impl ApiClient {
    pub fn new(base_url: String, api_key: String) -> Result<Self, String> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .danger_accept_invalid_certs(true) // For local/self-signed
            .build().map_err(|e| e.to_string())?;
        Ok(Self { client, base_url })
    }

    pub async fn health_check(&self) -> Result<bool, String> {
        let r = self.client.get(format!("{}/health", self.base_url)).send().await.map_err(|e| e.to_string())?;
        Ok(r.status().is_success())
    }

    pub async fn chat(&self, messages: Vec<ChatMessage>, api_key: &str) -> Result<String, String> {
        let url = format!("{}/v1/chat/completions", self.base_url.trim_end_matches('/'));
        let r = self.client.post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .json(&serde_json::json!({"model":"default","messages":messages}))
            .send().await.map_err(|e| e.to_string())?;
        if !r.status().is_success() { return Err(format!("HTTP {}", r.status())); }
        let data: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
        Ok(data["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string())
    }
}
```

### Streaming Chat (Rust → Frontend via Tauri Events)

```rust
#[tauri::command]
pub async fn stream_chat(
    messages: Vec<ChatMessage>,
    api_url: String,
    api_key: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let client = ApiClient::new(api_url.clone(), api_key.clone())?;
    let url = format!("{}/v1/chat/completions", api_url.trim_end_matches('/'));
    let resp = client.client.post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&serde_json::json!({"model":"default","messages":messages,"stream":true}))
        .send().await.map_err(|e| e.to_string())?;

    let mut full = String::new();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();

    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].to_string();
            buf = buf[pos+1..].to_string();
            if line.starts_with("data: ") {
                let data = &line[6..];
                if data == "[DONE]" { return Ok(full); }
                if let Ok(p) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(c) = p["choices"][0]["delta"]["content"].as_str() {
                        full.push_str(c);
                        app.emit("chat-chunk", c).ok();
                    }
                }
            }
        }
    }
    Ok(full)
}
```

### Tauri Commands

```rust
#[tauri::command]
async fn connect(app: AppHandle, api_url: String, api_key: String) -> Result<(), String> {
    let client = ApiClient::new(api_url.clone(), api_key.clone())?;
    client.health_check().await.map_err(|_| "Cannot reach API")?;
    ClientConfig { api_url, api_key }.save(&app)
}

#[tauri::command]
fn get_status(app: AppHandle) -> ClientConfig {
    ClientConfig::load(&app)
}

#[tauri::command]
fn disconnect(app: AppHandle) -> Result<(), String> {
    ClientConfig::default().save(&app)
}
```

### React ConnectionScreen

```tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/appStore';

export function ConnectionScreen() {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const connect = useAppStore(s => s.connect);

  const handleConnect = async () => {
    setTesting(true); setError('');
    try { await connect(url, key); }
    catch (e) { setError(String(e)); }
    finally { setTesting(false); }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg0">
      <div className="card w-[400px] p-6 space-y-4">
        <h1 className="text-lg font-semibold text-ink">Connect to API</h1>
        <input className="input" placeholder="https://api.openai.com/v1"
          value={url} onChange={e => setUrl(e.target.value)} />
        <input className="input" type="password" placeholder="API Key"
          value={key} onChange={e => setKey(e.target.value)} />
        {error && <p className="text-danger text-sm">{error}</p>}
        <button className="btn-primary w-full" onClick={handleConnect}
          disabled={testing || !url || !key}>
          {testing ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </div>
  );
}
```

### React Streaming Chat

```tsx
import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/appStore';

export function Chat() {
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const { messages, isLoading, apiUrl, apiKey } = useAppStore();

  useEffect(() => {
    const unlisten = listen<string>('chat-chunk', (e) => setStreaming(p => p + e.payload));
    return () => { unlisten.then(fn => fn()); };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streaming]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg = input.trim(); setInput(''); setStreaming('');
    useAppStore.setState(s => ({ messages: [...s.messages, { role: 'user', content: userMsg }], isLoading: true }));
    try {
      const full = await invoke<string>('stream_chat', {
        messages: [...messages, { role: 'user', content: userMsg }], apiUrl, apiKey,
      });
      useAppStore.setState(s => ({
        messages: [...s.messages, { role: 'user', content: userMsg }, { role: 'assistant', content: full }],
        isLoading: false,
      }));
      setStreaming('');
    } catch { useAppStore.setState({ isLoading: false }); setStreaming(''); }
  };

  return (
    <div className="flex h-screen flex-col bg-bg0">
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`rounded-lg px-4 py-2 max-w-[80%] ${
            m.role === 'user' ? 'ml-auto bg-accent text-white' : 'bg-bg2 text-ink'
          }`}>{m.content}</div>
        ))}
        {streaming && <div className="rounded-lg bg-bg2 text-ink px-4 py-2 max-w-[80%]">{streaming}▌</div>}
        <div ref={endRef} />
      </div>
      <div className="border-t border-line p-4 flex gap-2">
        <input className="input flex-1" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()} placeholder="Message..." disabled={isLoading} />
        <button className="btn-primary" onClick={handleSend} disabled={isLoading || !input.trim()}>Send</button>
      </div>
    </div>
  );
}
```

---

## Credential Storage

- **API URL** → `tauri-plugin-store` (plaintext config)
- **API Key** → OS keyring via `keyring` crate (Windows Credential Manager, macOS Keychain, Linux Secret Service)

```rust
let entry = keyring::Entry::new("my-app", "api-key").unwrap();
entry.set_password(&api_key).unwrap();
let key = entry.get_password().unwrap();
```

---

## Self-Signed TLS

```rust
let client = reqwest::Client::builder()
    .danger_accept_invalid_certs(true)
    .build().map_err(|e| e.to_string())?;
```

---

## Auto-Updater

```typescript
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const update = await check();
if (update) {
  await update.downloadAndInstall();
  await relaunch();
}
```

---

## CI/CD — Matrix Build (All 3 Platforms)

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
        with: tagName: ${{ github.ref_name }}, releaseDraft: false, args: ${{ matrix.args }}
```

---

## Security

- CSP minimal in tauri.conf.json
- IPC permissions in capabilities/default.json
- API key in OS keyring (NOT plaintext)
- Input validation on all commands

---

## Testing Checklist

- [ ] Connection screen works
- [ ] API connection succeeds
- [ ] Streaming chat works
- [ ] Settings persist
- [ ] Disconnect clears credentials
- [ ] Auto-updater works
- [ ] Build artifacts for all 3 platforms

---

## User Preference: Functionality First

Do NOT create UI without wiring to actual logic.

---

## Related Skills

- `tauri-desktop-apps` — Complete Tauri 2 reference
- `tauri-desktop-builder` — Building apps with specific integrations
- `github-actions-setup` — CI/CD pipeline patterns
