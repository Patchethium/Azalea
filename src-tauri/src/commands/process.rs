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

/// Longest sanitized file stem in bytes, leaving room within the common
/// 255-byte name limit for a ` (n)` collision suffix and the extension.
const MAX_FILE_STEM_BYTES: usize = 200;
const FALLBACK_FILE_STEM: &str = "audio";

/// Turns arbitrary text into a single file stem that is valid on every
/// supported platform. Separators and characters invalid on Windows become
/// `_`, so the result can never escape the directory it is joined to.
pub(crate) fn sanitize_file_stem(name: &str) -> String {
  let replaced: String = name
    .chars()
    .map(|c| match c {
      '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
      c if c.is_control() => '_',
      c => c,
    })
    .collect();
  // Windows drops trailing dots and spaces, which would turn `..` into `.`.
  let trim_tail = |text: &str| {
    text
      .trim_end_matches(|c: char| c == '.' || c.is_whitespace())
      .to_string()
  };
  let mut stem = trim_tail(replaced.trim_start());
  if stem.len() > MAX_FILE_STEM_BYTES {
    let mut end = MAX_FILE_STEM_BYTES;
    while !stem.is_char_boundary(end) {
      end -= 1;
    }
    stem.truncate(end);
    stem = trim_tail(&stem);
  }
  if stem.is_empty() {
    return FALLBACK_FILE_STEM.into();
  }
  // Windows reserves device names, even with an extension (`CON.wav`).
  let device = stem
    .split('.')
    .next()
    .unwrap_or_default()
    .to_ascii_uppercase();
  let reserved = matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
    || ((device.starts_with("COM") || device.starts_with("LPT"))
      && device.len() == 4
      && device.as_bytes()[3].is_ascii_digit()
      && device.as_bytes()[3] != b'0');
  if reserved {
    stem.insert(0, '_');
  }
  stem
}

/// Joins `dir` with a `.wav` file named after `name`, sanitized so the result
/// always stays directly inside `dir`.
#[tauri::command]
#[specta::specta]
pub fn audio_export_path(dir: String, name: String) -> String {
  PathBuf::from(dir)
    .join(format!("{}.wav", sanitize_file_stem(&name)))
    .to_string_lossy()
    .to_string()
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
    let joined = audio_export_path("workspace".into(), "audio".into());
    assert_eq!(
      joined,
      format!("workspace{}audio.wav", std::path::MAIN_SEPARATOR)
    );
    assert_eq!(parent_path(joined), Some("workspace".into()));
    assert_eq!(parent_path("filename".into()), Some(String::new()));
  }

  #[test]
  fn sanitize_file_stem_replaces_separators_and_invalid_characters() {
    assert_eq!(
      sanitize_file_stem("こんにちは、世界！"),
      "こんにちは、世界！"
    );
    assert_eq!(sanitize_file_stem("1/2"), "1_2");
    assert_eq!(sanitize_file_stem("/etc/passwd"), "_etc_passwd");
    assert_eq!(sanitize_file_stem("..\\..\\x"), ".._.._x");
    assert_eq!(sanitize_file_stem("C:\\out"), "C__out");
    assert_eq!(sanitize_file_stem("a*b?c\"d<e>f|g"), "a_b_c_d_e_f_g");
    assert_eq!(
      sanitize_file_stem("line\nbreak\ttab\u{7f}"),
      "line_break_tab_"
    );
  }

  #[test]
  fn sanitize_file_stem_handles_empty_dot_and_reserved_names() {
    for name in ["", "   ", ".", "..", "...", " . . "] {
      assert_eq!(sanitize_file_stem(name), "audio", "{name:?}");
    }
    assert_eq!(sanitize_file_stem("  padded.  "), "padded");
    for name in ["CON", "con", "Nul", "aux.txt", "COM1", "lpt9"] {
      assert_eq!(sanitize_file_stem(name), format!("_{name}"), "{name:?}");
    }
    for name in ["COM0", "COM10", "CONSOLE", "LPT", "NULL"] {
      assert_eq!(sanitize_file_stem(name), name, "{name:?}");
    }
  }

  #[test]
  fn sanitize_file_stem_truncates_long_names_on_a_char_boundary() {
    let long = "あ".repeat(100);
    let stem = sanitize_file_stem(&long);
    assert!(stem.len() <= MAX_FILE_STEM_BYTES);
    assert_eq!(stem, "あ".repeat(66));
    let dotted = format!("{}. x", "a".repeat(MAX_FILE_STEM_BYTES - 2));
    assert_eq!(
      sanitize_file_stem(&dotted),
      "a".repeat(MAX_FILE_STEM_BYTES - 2)
    );
  }

  #[test]
  fn audio_export_path_stays_inside_the_directory() {
    let dir = tempfile::tempdir().unwrap();
    for name in [
      "/etc/passwd",
      "../escape",
      "..",
      "C:\\Windows\\x",
      "a/../../b",
    ] {
      let path = PathBuf::from(audio_export_path(
        dir.path().to_string_lossy().to_string(),
        name.into(),
      ));
      assert_eq!(path.parent(), Some(dir.path()), "{name:?}");
      assert_eq!(path.extension().and_then(|e| e.to_str()), Some("wav"));
    }
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
