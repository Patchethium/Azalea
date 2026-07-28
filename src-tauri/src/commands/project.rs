use crate::config::types::Project;
use serde_json;
use std::{fs, path::Path, result::Result};

#[tauri::command]
#[specta::specta]
pub async fn save_project(
  project: Project,
  path: String,
  allow_create: bool,
) -> Result<(), String> {
  let project_json = serde_json::to_string(&project).map_err(|e| e.to_string())?;
  let path = if !path.ends_with(".azp") {
    format!("{path}.azp")
  } else {
    path
  };
  if Path::new(&path).exists() || allow_create {
    fs::write(&path, project_json).map_err(|e| e.to_string())?;
  } else {
    return Err(format!("Project File {path} does not exist").to_string());
  }
  Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn load_project(path: String) -> Result<Project, String> {
  let project_json = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
  let project: Project = serde_json::from_str(&project_json).map_err(|e| e.to_string())?;
  Ok(project)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::config::types::{Preset, TextBlockProps};

  fn project() -> Project {
    Project {
      blocks: vec![TextBlockProps {
        text: "こんにちは、Azalea 🌺".into(),
        query: None,
        preset_id: Some(0),
      }],
      presets: vec![Preset::default()],
    }
  }

  #[test]
  fn save_adds_extension_and_load_round_trips_unicode() {
    tauri::async_runtime::block_on(async {
      let directory = tempfile::tempdir().unwrap();
      let path = directory.path().join("project");

      save_project(project(), path.to_string_lossy().into_owned(), true)
        .await
        .unwrap();
      let saved = path.with_extension("azp");
      assert!(saved.is_file());
      let loaded = load_project(saved.to_string_lossy().into_owned())
        .await
        .unwrap();

      assert_eq!(loaded.blocks.len(), 1);
      assert_eq!(loaded.blocks[0].text, "こんにちは、Azalea 🌺");
      assert_eq!(loaded.blocks[0].preset_id, Some(0));
      assert_eq!(loaded.presets.len(), 1);
    });
  }

  #[test]
  fn save_requires_creation_permission_for_new_files() {
    tauri::async_runtime::block_on(async {
      let directory = tempfile::tempdir().unwrap();
      let path = directory.path().join("new.azp");

      let error = save_project(project(), path.to_string_lossy().into_owned(), false)
        .await
        .unwrap_err();

      assert!(error.contains("does not exist"));
      assert!(!path.exists());
    });
  }

  #[test]
  fn load_reports_missing_and_malformed_projects() {
    tauri::async_runtime::block_on(async {
      let directory = tempfile::tempdir().unwrap();
      let missing = directory.path().join("missing.azp");
      assert!(load_project(missing.to_string_lossy().into_owned())
        .await
        .is_err());

      let malformed = directory.path().join("malformed.azp");
      std::fs::write(&malformed, "{").unwrap();
      assert!(load_project(malformed.to_string_lossy().into_owned())
        .await
        .is_err());
    });
  }
}
