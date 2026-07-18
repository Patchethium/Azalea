use serde::Serialize;
use specta::Type;
use std::path::PathBuf;
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
  match std::env::consts::OS {
    "macos" => OS::MacOS,
    "windows" => OS::Windows,
    "linux" => OS::Linux,
    _ => {
      panic!("I don't know how you made it work on this OS, but you may want to add a case for it.")
    }
  }
}

#[tauri::command]
#[specta::specta]
pub fn join_path(p1: String, p2: String) -> String {
  let mut pathbuf = PathBuf::from(p1);
  pathbuf.push(p2);
  pathbuf.to_string_lossy().to_string()
}

#[tauri::command]
#[specta::specta]
pub fn parent_path(p: String) -> Option<String> {
  let pathbuf = PathBuf::from(p);
  let parent = pathbuf.parent();
  match parent {
    Some(pr) => return Some(pr.to_string_lossy().to_string()),
    None => None,
  }
}
