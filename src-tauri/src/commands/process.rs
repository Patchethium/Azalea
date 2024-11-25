use serde::Serialize;
use specta::Type;
use std::env::consts::OS;
use tauri::AppHandle;

#[tauri::command]
#[specta::specta]
pub async fn quit(app: AppHandle) {
  app.exit(0);
}

#[derive(Serialize, Type)]
pub enum OS {
  MacOS,
  Windows,
  Linux,
}

#[tauri::command]
#[specta::specta]
pub async fn get_os() -> OS {
  match OS {
    "macos" => OS::MacOS,
    "windows" => OS::Windows,
    "linux" => OS::Linux,
    _ => {
      panic!("I don't know how you made it work on this OS, but you may want to add a case for it.")
    }
  }
}
