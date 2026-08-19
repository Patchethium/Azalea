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

#[tauri::command]
#[specta::specta]
pub fn home_dir() -> Option<String> {
  dirs::home_dir().map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
pub fn read_text_file(path: String) -> Result<String, String> {
  std::fs::read_to_string(path).map_err(|error| error.to_string())
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

  #[test]
  fn home_dir_matches_dirs_home_dir() {
    assert_eq!(
      home_dir(),
      dirs::home_dir().map(|p| p.to_string_lossy().to_string())
    );
  }

  #[test]
  fn read_text_file_round_trips_utf8_contents() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("script.srt");
    let contents = "1\n00:00:00,000 --> 00:00:01,000\nこんにちは\n";
    std::fs::write(&path, contents).unwrap();
    assert_eq!(
      read_text_file(path.to_string_lossy().to_string()),
      Ok(contents.to_string())
    );
  }

  #[test]
  fn read_text_file_reports_missing_or_invalid_files() {
    assert!(read_text_file("/definitely/not/a/real/path.srt".into()).is_err());

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("invalid.srt");
    std::fs::write(&path, [0xff, 0xfe, 0x00]).unwrap();
    assert!(read_text_file(path.to_string_lossy().to_string()).is_err());
  }
}
