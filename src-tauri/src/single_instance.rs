//! Handling for a second application launch while Azalea is already running.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::Event;

/// Asks the running frontend to open a project passed to a second launch.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
pub struct OpenProjectRequested {
  pub path: String,
}

/// Returns the first existing `.azp` file named in a launch's arguments.
///
/// `args` follows `std::env::args` conventions, so the leading executable path
/// is skipped. Flags are ignored and relative paths resolve against `cwd`, the
/// working directory of the launching process.
pub(crate) fn project_path_from_args<S: AsRef<str>>(args: &[S], cwd: &Path) -> Option<PathBuf> {
  args
    .iter()
    .skip(1)
    .map(AsRef::as_ref)
    .filter(|arg| !arg.is_empty() && !arg.starts_with('-'))
    .map(|arg| cwd.join(arg))
    .find(|path| {
      path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("azp"))
        && path.is_file()
    })
}

/// Brings the main window forward and forwards any project path from the
/// second launch to the frontend.
#[cfg(desktop)]
pub(crate) fn handle_second_launch(app: &tauri::AppHandle, args: Vec<String>, cwd: String) {
  use tauri::Manager;

  if let Some(window) = app.get_webview_window("main") {
    for (action, result) in [
      ("unminimize", window.unminimize()),
      ("show", window.show()),
      ("focus", window.set_focus()),
    ] {
      if let Err(error) = result {
        eprintln!("Failed to {action} the main window: {error}");
      }
    }
  }
  let Some(path) = project_path_from_args(&args, Path::new(&cwd)) else {
    return;
  };
  let event = OpenProjectRequested {
    path: path.to_string_lossy().into_owned(),
  };
  if let Err(error) = event.emit(app) {
    eprintln!("Failed to emit open project request: {error}");
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  fn args(values: &[&str]) -> Vec<String> {
    std::iter::once("azalea")
      .chain(values.iter().copied())
      .map(String::from)
      .collect()
  }

  #[test]
  fn project_path_from_args_returns_existing_absolute_project() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("story.azp");
    fs::write(&project, "").unwrap();
    let other = tempfile::tempdir().unwrap();

    assert_eq!(
      project_path_from_args(&args(&[project.to_str().unwrap()]), other.path()),
      Some(project)
    );
  }

  #[test]
  fn project_path_from_args_resolves_relative_paths_against_cwd() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("nested")).unwrap();
    let project = dir.path().join("nested").join("Story.AZP");
    fs::write(&project, "").unwrap();

    assert_eq!(
      project_path_from_args(&args(&["nested/Story.AZP"]), dir.path()),
      Some(project)
    );
  }

  #[test]
  fn project_path_from_args_ignores_flags_missing_and_other_files() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("notes.txt"), "").unwrap();
    fs::write(dir.path().join("-flag.azp"), "").unwrap();
    fs::create_dir(dir.path().join("folder.azp")).unwrap();
    let project = dir.path().join("second.azp");
    fs::write(&project, "").unwrap();

    assert_eq!(
      project_path_from_args(
        &args(&[
          "--flag",
          "-flag.azp",
          "",
          "missing.azp",
          "notes.txt",
          "folder.azp",
          "second.azp",
        ]),
        dir.path(),
      ),
      Some(project)
    );
  }

  #[test]
  fn project_path_from_args_skips_the_executable_and_returns_none_without_projects() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("azalea.azp"), "").unwrap();

    assert_eq!(project_path_from_args(&["azalea.azp"], dir.path()), None);
    assert_eq!(project_path_from_args::<&str>(&[], dir.path()), None);
    assert_eq!(
      project_path_from_args(&args(&["--verbose", "missing.azp"]), dir.path()),
      None
    );
  }
}
