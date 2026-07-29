# Multi-Window & System Tray in Tauri 2

## System Tray

### Cargo.toml

```toml
tauri = { version = "2", features = ["tray-icon"] }
```

### Rust: Tray Setup

```rust
// src-tauri/src/tray.rs
use tauri::{
    tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent},
    Manager, Menu, MenuItem,
};

pub fn create_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let disconnect = MenuItem::with_id(app, "disconnect", "Disconnect", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &disconnect, &quit])?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("My App")
        .on_menu_event(move |app, event| {
            match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        window.show().ok();
                        window.set_focus().ok();
                    }
                }
                "disconnect" => {
                    app.emit("disconnect", ()).ok();
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    window.show().ok();
                    window.set_focus().ok();
                }
            }
        })
        .build(app)?;

    Ok(())
}
```

### Register Tray in Main

```rust
mod tray;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            tray::create_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error");
}
```

## Window Management

### Multi-Window Config

```json
// src-tauri/tauri.conf.json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "My App",
        "width": 1200,
        "height": 800,
        "center": true,
        "visible": true
      },
      {
        "label": "settings",
        "title": "Settings",
        "width": 600,
        "height": 500,
        "center": true,
        "visible": false,
        "resizable": false
      }
    ]
  }
}
```

### Create Window at Runtime

```rust
use tauri::WebviewUrl;

#[tauri::command]
fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    // Check if window already exists
    if let Some(window) = app.get_webview_window("settings") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Create new window
    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        WebviewUrl::App("settings.html".into()),
    )
    .title("Settings")
    .inner_size(600.0, 500.0)
    .center()
    .resizable(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}
```

### Frontend: Create Window

```typescript
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

// Open settings window
const settings = new WebviewWindow('settings', {
  url: '/settings',
  title: 'Settings',
  width: 600,
  height: 500,
  center: true,
  resizable: false,
});

await settings.once('tauri://error', (e) => {
  console.error('Window creation error:', e);
});
```

### Close-to-Tray Pattern

```rust
// In lib.rs setup:
let app_handle = app.handle().clone();
app.get_webview_window("main")
    .unwrap()
    .on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            // Prevent close, hide to tray instead
            api.prevent_close();
            // Window stays in tray
        }
    });
```

### Frontend: Close-to-Tray

```typescript
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

// Close to tray
appWindow.onCloseRequested(async (event) => {
  event.preventDefault(); // Don't actually close
  await appWindow.hide(); // Hide instead
});
```

## Window Communication

### Between Windows via Tauri Events

```rust
// Window A emits
app.emit("data-update", json!({"key": "value"})).ok();
```

```typescript
// Window B listens
import { listen } from '@tauri-apps/api/event';

listen('data-update', (event) => {
  console.log('Received from Window A:', event.payload);
});
```

### Frontend: Cross-Window Communication

```typescript
// Window 1: Send data
import { emit } from '@tauri-apps/api/event';
await emit('settings-changed', { theme: 'dark' });

// Window 2: Receive data
import { listen } from '@tauri-apps/api/event';
listen('settings-changed', (e) => {
  applyTheme(e.payload.theme);
});
```

## Tray Tooltip Updates

```rust
use tauri::tray::TrayIconBuilder;

// Store tray handle
let tray = TrayIconBuilder::new().build(app)?;

// Later: update tooltip
tray.set_tooltip(Some("Connected to gateway")).ok();
```

## Frontend: Window Controls

```typescript
import { getCurrentWindow } from '@tauri-apps/api/window';

const win = getCurrentWindow();

// Minimize
await win.minimize();

// Maximize/unmaximize
await win.toggleMaximize();

// Fullscreen
await win.setFullscreen(true);

// Always on top
await win.setAlwaysOnTop(true);

// Position
await win.setPosition({ x: 100, y: 100 });

// Size
await win.setSize({ width: 800, height: 600 });
```

## Pitfalls

| Problem | Fix |
|---------|-----|
| Tray icon not showing | Ensure `tray-icon` feature enabled in Cargo.toml |
| Window close exits app | Use `on_window_event` with `api.prevent_close()` |
| Settings window opens twice | Check `get_webview_window("settings")` before creating |
| Events not received in other window | Ensure `listen` is called before `emit` |
| Tray menu items not responding | Check `on_menu_event` handler matches ID strings |
| Window behind other windows | Use `set_focus()` after `show()` |
