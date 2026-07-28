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

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn path_helpers_join_and_find_parents() {
    let joined = join_path("workspace".into(), "audio.wav".into());
    assert_eq!(
      joined,
      format!("workspace{}audio.wav", std::path::MAIN_SEPARATOR)
    );
    assert_eq!(parent_path(joined), Some("workspace".into()));
    assert_eq!(parent_path("filename".into()), Some(String::new()));
  }

  #[test]
  fn reported_os_matches_the_compilation_target() {
    let os = tauri::async_runtime::block_on(get_os());
    match std::env::consts::OS {
      "linux" => assert!(matches!(os, OS::Linux)),
      "macos" => assert!(matches!(os, OS::MacOS)),
      "windows" => assert!(matches!(os, OS::Windows)),
      other => panic!("unsupported test target: {other}"),
    }
  }
}
