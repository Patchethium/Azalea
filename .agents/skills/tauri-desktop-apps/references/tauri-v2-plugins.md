# Tauri v2 Plugin System — Complete Reference

## Plugin Architecture

Tauri 2 plugins extend both Rust backend and JavaScript frontend. Every plugin follows the same pattern:

```
Plugin
├── Rust side:    Provides Tauri commands + managed state
├── JS side:      Provides typed wrappers around invoke()
└── Permissions:  Define IPC scope (what frontend can access)
```

## Official Plugins (Curated List)

### Core (Almost Always Needed)

| Plugin | Purpose | Install |
|--------|---------|---------|
| `tauri-plugin-store` | Key-value persistence | `cargo: tauri-plugin-store` / `npm: @tauri-apps/plugin-store` |
| `tauri-plugin-dialog` | Native open/save dialogs | `cargo: tauri-plugin-dialog` / `npm: @tauri-apps/plugin-dialog` |
| `tauri-plugin-fs` | File system read/write | `cargo: tauri-plugin-fs` / `npm: @tauri-apps/plugin-fs` |
| `tauri-plugin-shell` | Open URLs, run commands | `cargo: tauri-plugin-shell` / `npm: @tauri-apps/plugin-shell` |
| `tauri-plugin-opener` | Open files/URLs with default app | `cargo: tauri-plugin-opener` / `npm: @tauri-apps/plugin-opener` |
| `tauri-plugin-notification` | System notifications | `cargo: tauri-plugin-notification` / `npm: @tauri-apps/plugin-notification` |
| `tauri-plugin-log` | Structured logging | `cargo: tauri-plugin-log` / `npm: @tauri-apps/plugin-log` |
| `tauri-plugin-process` | Process info, relaunch, exit | `cargo: tauri-plugin-process` / `npm: @tauri-apps/plugin-process` |

### System

| Plugin | Purpose | Install |
|--------|---------|---------|
| `tauri-plugin-clipboard-manager` | Clipboard read/write | `cargo: tauri-plugin-clipboard-manager` / `npm: @tauri-apps/plugin-clipboard-manager` |
| `tauri-plugin-global-shortcut` | System-wide hotkeys | `cargo: tauri-plugin-global-shortcut` / `npm: @tauri-apps/plugin-global-shortcut` |
| `tauri-plugin-autostart` | Launch at login | `cargo: tauri-plugin-autostart` / `npm: @tauri-apps/plugin-autostart` |
| `tauri-plugin-deep-link` | Handle deep links (myapp://) | `cargo: tauri-plugin-deep-link` / `npm: @tauri-apps/plugin-deep-link` |
| `tauri-plugin-updater` | Auto-update from GitHub | `cargo: tauri-plugin-updater` / `npm: @tauri-apps/plugin-updater` |
| `tauri-plugin-window-state` | Remember window size/position | `cargo: tauri-plugin-window-state` / `npm: @tauri-apps/plugin-window-state` |

### Network & Security

| Plugin | Purpose | Install |
|--------|---------|---------|
| `tauri-plugin-http` | HTTP client (fetch API) | `cargo: tauri-plugin-http` / `npm: @tauri-apps/plugin-http` |
| `tauri-plugin-keyring` | OS keychain (secrets) | `cargo: tauri-plugin-keyring` |

### Media

| Plugin | Purpose | Install |
|--------|---------|---------|
| `tauri-plugin-media` | Audio/video playback | `cargo: tauri-plugin-media` |
| `tauri-plugin-barcode-scanner` | Barcode/QR scanning | `cargo: tauri-plugin-barcode-scanner` |

## Adding a Plugin — Step by Step

### Step 1: Cargo.toml

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-store = "2"
tauri-plugin-dialog = "2"
tauri-plugin-fs = { version = "2", features = ["scope"] }
tauri-plugin-shell = "2"
tauri-plugin-notification = "2"
tauri-plugin-process = "2"
tauri-plugin-updater = "2"
tauri-plugin-keyring = "0.1"
```

### Step 2: Register in Rust

```rust
// src-tauri/src/lib.rs
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![/* commands */])
        .run(tauri::generate_context!())
        .expect("error");
}
```

### Step 3: npm Install

```bash
npm install @tauri-apps/plugin-store @tauri-apps/plugin-dialog \
  @tauri-apps/plugin-fs @tauri-apps/plugin-shell \
  @tauri-apps/plugin-notification @tauri-apps/plugin-process \
  @tauri-apps/plugin-updater
```

### Step 4: Permissions (tauri.conf.json)

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:*"
    }
  },
  "plugins": {
    "store": { "autosave": true },
    "updater": {
      "pubkey": "YOUR_PUBKEY_HERE",
      "endpoints": ["https://github.com/OWNER/REPO/releases/latest/download/latest.json"]
    }
  }
}
```

### Step 5: Permissions File

Create `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "identifier": "default",
  "description": "Default permissions for the app",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "store:default",
    "dialog:default",
    "dialog:allow-open",
    "dialog:allow-save",
    "fs:default",
    "fs:allow-read",
    "fs:allow-write",
    "shell:default",
    "shell:allow-open",
    "notification:default",
    "notification:allow-send-notification",
    "process:default",
    "process:allow-restart",
    "updater:default",
    "opener:default"
  ]
}
```

## Writing a Custom Plugin

### Rust Plugin Structure

```rust
// src-tauri/src/my_plugin.rs
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime, Manager, State,
};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

// Plugin state
#[derive(Default)]
pub struct MyPluginState {
    pub value: Mutex<String>,
}

// Commands
#[tauri::command]
fn get_value(state: State<'_, MyPluginState>) -> String {
    state.value.lock().unwrap().clone()
}

#[tauri::command]
fn set_value(value: String, state: State<'_, MyPluginState>) {
    *state.value.lock().unwrap() = value;
}

// Plugin initializer
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("my-plugin")
        .setup(|app, _api| {
            app.manage(MyPluginState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_value, set_value])
        .build()
}
```

### Register Custom Plugin

```rust
mod my_plugin;

pub fn run() {
    tauri::Builder::default()
        .plugin(my_plugin::init())
        // ... other plugins ...
        .run(tauri::generate_context!())
        .expect("error");
}
```

### JS Wrapper for Custom Plugin

```typescript
// src/lib/myPlugin.ts
import { invoke } from '@tauri-apps/api/core';

export const myPlugin = {
  getValue: () => invoke<string>('plugin:my-plugin|get_value'),
  setValue: (value: string) => invoke<void>('plugin:my-plugin|set_value', { value }),
};
```

## Plugin Pitfalls

| Problem | Fix |
|---------|-----|
| Plugin not found at runtime | Check both Cargo.toml AND npm install |
| Permission denied | Add permission to capabilities/default.json |
| Plugin state not shared | Use `app.manage()` in plugin setup, not in commands |
| Plugin conflicts | Check plugin versions — v1 plugins don't work with v2 |
| `tauri-plugin-store` data lost | Ensure `autosave: true` in plugin config |
| Custom plugin invoke fails | Use `plugin:name|command_name` format in JS |
| CSP blocks plugin requests | Update CSP in tauri.conf.json |
