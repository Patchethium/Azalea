# React + Tauri 2 Integration Patterns

Complete reference for building React frontends in Tauri 2 apps.

## Project Setup

```bash
# Create React + TypeScript + Vite project
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install

# Install Tauri API
npm install @tauri-apps/api
npm install @tauri-apps/plugin-store
npm install @tauri-apps/plugin-dialog
npm install @tauri-apps/plugin-fs
npm install @tauri-apps/plugin-notification
npm install @tauri-apps/plugin-shell
npm install @tauri-apps/plugin-updater

# State management
npm install zustand

# UI
npm install tailwindcss @tailwindcss/vite
```

### tauri.conf.json

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "build": {
    "frontendDist": "../frontend/dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "cd ../frontend && npm run dev",
    "beforeBuildCommand": "cd ../frontend && npm run build"
  },
  "app": {
    "windows": [{
      "title": "My App",
      "width": 1200,
      "height": 800,
      "minWidth": 800,
      "minHeight": 600,
      "resizable": true,
      "center": true,
      "decorations": true,
      "transparent": false
    }]
  },
  "security": {
    "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
  },
  "plugins": {
    "store": { "autosave": true }
  }
}
```

## Core Patterns

### 1. invoke() — Calling Rust Commands

```typescript
import { invoke } from '@tauri-apps/api/core';

// Simple call
const result = await invoke<string>('my_command', { arg1: 'hello', arg2: 42 });

// With error handling
try {
  const data = await invoke<MyType>('get_data', { id: 123 });
  setData(data);
} catch (err) {
  console.error('Command failed:', err);
  showToast(String(err), 'error');
}
```

### 2. TypeScript Types for Rust Commands

```typescript
// src/types/tauri.d.ts
// Mirror your Rust structs here

export interface AppConfig {
  gateway_url: string;
  api_key: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface MediaAsset {
  id: string;
  path: string;
  name: string;
  duration_us: number;
  width: number;
  height: number;
}

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError: boolean;
}

// Tauri command type declarations
declare module '@tauri-apps/api/core' {
  export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}
```

### 3. Zustand Store Pattern

```typescript
// src/store/appStore.ts
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

interface AppState {
  // Connection
  connected: boolean;
  gatewayUrl: string;
  apiKey: string;

  // Chat
  messages: ChatMessage[];
  isLoading: boolean;

  // Actions
  connect: (url: string, key: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  disconnect: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  connected: false,
  gatewayUrl: '',
  apiKey: '',
  messages: [],
  isLoading: false,

  connect: async (url, key) => {
    try {
      await invoke('connect_gateway', { gatewayUrl: url, apiKey: key });
      set({ connected: true, gatewayUrl: url, apiKey: key });
    } catch (err) {
      throw new Error(String(err));
    }
  },

  sendMessage: async (content) => {
    const { messages, gatewayUrl, apiKey } = get();
    const userMsg: ChatMessage = { role: 'user', content };
    set({ messages: [...messages, userMsg], isLoading: true });

    try {
      const response = await invoke<string>('send_chat', {
        messages: [...messages, userMsg],
        gatewayUrl,
        apiKey,
      });
      const assistantMsg: ChatMessage = { role: 'assistant', content: response };
      set({ messages: [...messages, userMsg, assistantMsg], isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  disconnect: () => {
    invoke('disconnect_gateway').catch(() => {});
    set({ connected: false, gatewayUrl: '', apiKey: '', messages: [] });
  },
}));
```

### 4. Custom Hook: useTauriCommand

```typescript
// src/hooks/useTauriCommand.ts
import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function useTauriCommand<TArgs, TResult>(command: string) {
  const [data, setData] = useState<TResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (args?: TArgs) => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<TResult>(command, args as Record<string, unknown>);
      setData(result);
      return result;
    } catch (err) {
      const msg = String(err);
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [command]);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { data, loading, error, execute, reset };
}

// Usage:
const { data, loading, error, execute } = useTauriCommand<{ id: number }, MediaAsset>('get_asset');
await execute({ id: 42 });
```

### 5. Custom Hook: useTauriEvent

```typescript
// src/hooks/useTauriEvent.ts
import { useEffect } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export function useTauriEvent<T>(event: string, handler: (payload: T) => void) {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<T>(event, (e) => handler(e.payload))
      .then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [event]);
}

// Usage:
useTauriEvent<string>('navigate-to-gateway', (url) => {
  window.location.href = url;
});
```

### 6. Streaming Chat with SSE

```typescript
// src/lib/streamChat.ts
export async function streamChat(
  messages: ChatMessage[],
  gatewayUrl: string,
  apiKey: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
): Promise<AbortController> {
  const controller = new AbortController();

  try {
    const resp = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'default',
        messages,
        stream: true,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') { onDone(); return controller; }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) onChunk(delta);
        } catch { /* skip malformed lines */ }
      }
    }
    onDone();
  } catch (err) {
    if ((err as Error).name !== 'AbortError') onError(err as Error);
  }

  return controller;
}
```

### 7. File Dialog (Open/Save)

```typescript
import { open, save } from '@tauri-apps/plugin-dialog';

// Open file
const filePath = await open({
  multiple: false,
  filters: [{
    name: 'Video',
    extensions: ['mp4', 'mov', 'avi', 'mkv'],
  }],
});
if (filePath) {
  await invoke('load_file', { path: filePath });
}

// Save file
const savePath = await save({
  defaultPath: 'output.mp4',
  filters: [{
    name: 'Video',
    extensions: ['mp4'],
  }],
});
```

### 8. File System Operations

```typescript
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';

// Read config
const configDir = await appDataDir();
const configPath = await join(configDir, 'config.json');
if (await exists(configPath)) {
  const content = await readTextFile(configPath);
  const config = JSON.parse(content);
}

// Write config
await writeTextFile(configPath, JSON.stringify(config, null, 2));
```

### 9. Notifications

```typescript
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';

async function notify(title: string, body: string) {
  if (await isPermissionGranted()) {
    sendNotification({ title, body });
  } else {
    const perm = await requestPermission();
    if (perm === 'granted') {
      sendNotification({ title, body });
    }
  }
}
```

### 10. Auto-Updater

```typescript
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

async function checkForUpdates() {
  const update = await check();
  if (update) {
    console.log(`Update available: ${update.version}`);
    // Download and install
    let downloaded = 0;
    let contentLength = 0;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength || 0;
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          break;
        case 'Finished':
          break;
      }
    });

    await relaunch();
  }
}
```

## Component Patterns

### Connection Screen

```tsx
// src/components/ConnectionScreen.tsx
import { useState } from 'react';
import { useAppStore } from '../store/appStore';

export function ConnectionScreen() {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const connect = useAppStore(s => s.connect);

  const handleConnect = async () => {
    setTesting(true);
    setError('');
    try {
      await connect(url, key);
    } catch (err) {
      setError(String(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg0">
      <div className="card w-[400px] p-6 space-y-4">
        <h1 className="text-lg font-semibold text-ink">Connect to Gateway</h1>
        <input
          className="input"
          placeholder="http://10.1.1.20:9119"
          value={url}
          onChange={e => setUrl(e.target.value)}
        />
        <input
          className="input"
          type="password"
          placeholder="API Key"
          value={key}
          onChange={e => setKey(e.target.value)}
        />
        {error && <p className="text-danger text-sm">{error}</p>}
        <button
          className="btn-primary w-full"
          onClick={handleConnect}
          disabled={testing || !url || !key}
        >
          {testing ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </div>
  );
}
```

### Chat Interface

```tsx
// src/components/Chat.tsx
import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { streamChat } from '../lib/streamChat';

export function Chat() {
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { messages, isLoading, gatewayUrl, apiKey, sendMessage } = useAppStore();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg = input.trim();
    setInput('');

    // Streaming mode
    const controller = await streamChat(
      [...messages, { role: 'user', content: userMsg }],
      gatewayUrl,
      apiKey,
      (chunk) => setStreaming(prev => prev + chunk),
      () => {
        const final = streaming;
        setStreaming('');
        useAppStore.setState(s => ({
          messages: [...s.messages,
            { role: 'user', content: userMsg },
            { role: 'assistant', content: final },
          ],
        }));
      },
      (err) => { setStreaming(''); console.error(err); },
    );
  };

  return (
    <div className="flex h-screen flex-col bg-bg0">
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`rounded-lg px-4 py-2 max-w-[80%] ${
            msg.role === 'user' ? 'ml-auto bg-accent text-white' : 'bg-bg2 text-ink'
          }`}>
            {msg.content}
          </div>
        ))}
        {streaming && (
          <div className="rounded-lg bg-bg2 text-ink px-4 py-2 max-w-[80%]">
            {streaming}<span className="animate-pulse">▌</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="border-t border-line p-4 flex gap-2">
        <input
          className="input flex-1"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Type a message..."
          disabled={isLoading}
        />
        <button className="btn-primary" onClick={handleSend} disabled={isLoading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
```

### Settings Panel

```tsx
// src/components/Settings.tsx
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Settings {
  aiProvider: string;
  aiModel: string;
  apiUrl: string;
  apiKey: string;
}

export function Settings({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings>({
    aiProvider: 'openai',
    aiModel: 'gpt-4o',
    apiUrl: '',
    apiKey: '',
  });

  useEffect(() => {
    invoke<Settings>('get_settings').then(setSettings).catch(() => {});
  }, []);

  const handleSave = async () => {
    await invoke('save_settings', { settings });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="card w-[500px] max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-ink font-semibold">Settings</h2>
          <button onClick={onClose} className="text-ink-dim hover:text-ink">✕</button>
        </div>
        <div className="p-4 space-y-4">
          <label className="block">
            <span className="text-ink-dim text-sm">AI Provider</span>
            <select
              className="input mt-1"
              value={settings.aiProvider}
              onChange={e => setSettings(s => ({ ...s, aiProvider: e.target.value }))}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="9router">9Router</option>
              <option value="ollama">Ollama (Local)</option>
            </select>
          </label>
          <label className="block">
            <span className="text-ink-dim text-sm">Model</span>
            <input
              className="input mt-1"
              value={settings.aiModel}
              onChange={e => setSettings(s => ({ ...s, aiModel: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="text-ink-dim text-sm">API URL</span>
            <input
              className="input mt-1"
              placeholder="https://api.openai.com/v1"
              value={settings.apiUrl}
              onChange={e => setSettings(s => ({ ...s, apiUrl: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="text-ink-dim text-sm">API Key</span>
            <input
              className="input mt-1"
              type="password"
              value={settings.apiKey}
              onChange={e => setSettings(s => ({ ...s, apiKey: e.target.value }))}
            />
          </label>
          <button className="btn-primary w-full" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
```

## CSS: Tailwind + Dark Theme

```css
/* src/styles.css */
@import "tailwindcss";

:root {
  --bg0: #1a1a1e;
  --bg1: #1e1e22;
  --bg2: #252529;
  --bg3: #2c2c31;
  --line: #2a2a2e;
  --ink: #c8c8cc;
  --ink-dim: #888890;
  --ink-faint: #55555a;
  --accent: #0a84ff;
  --success: #30d158;
  --danger: #ff453a;
}

@theme {
  --color-bg0: var(--bg0);
  --color-bg1: var(--bg1);
  --color-bg2: var(--bg2);
  --color-bg3: var(--bg3);
  --color-line: var(--line);
  --color-ink: var(--ink);
  --color-ink-dim: var(--ink-dim);
  --color-ink-faint: var(--ink-faint);
  --color-accent: var(--accent);
  --color-success: var(--success);
  --color-danger: var(--danger);
}

body {
  background: var(--bg0);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.card {
  background: var(--bg1);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.input {
  background: var(--bg2);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px 12px;
  color: var(--ink);
  width: 100%;
  outline: none;
}
.input:focus { border-color: var(--accent); }

.btn-primary {
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
  font-weight: 500;
}
.btn-primary:hover { opacity: 0.9; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

/* Custom scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--ink-faint); border-radius: 3px; }
```

## Pitfalls

| Problem | Fix |
|---------|-----|
| `invoke` returns wrong type | Add explicit TypeScript generics: `invoke<T>('cmd')` |
| Zustand store not updating UI | Ensure state mutations create new objects (immutability) |
| SSE streaming stops mid-response | Check `reader.read()` loop handles `done: true` correctly |
| File dialog blocks UI | Use `await` — Tauri file dialogs are async |
| CSP blocks fetch to localhost | Add `connect-src 'self' http://127.0.0.1:*` to CSP |
| `@tauri-apps/api` not found | Install `@tauri-apps/api` in frontend package.json |
| Settings not persisting | Use `tauri-plugin-store` or `invoke('save_settings')` |
| Window decorations look wrong | Check `decorations` in tauri.conf.json |
| Dark mode flash on startup | Set `background` in tauri.conf.json window config |
