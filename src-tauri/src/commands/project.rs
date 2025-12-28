use crate::config::types::Project;
use serde_json;
use std::{fs, result::Result};

#[tauri::command]
#[specta::specta]
pub async fn save_project(project: Project, path: String, allow_create: bool) -> Result<(), String> {
  let project_json = serde_json::to_string(&project).map_err(|e| e.to_string())?;
  let path = if !path.ends_with(".azp") {
    format!("{path}.azp")
  } else {
    path
  };
  if fs::exists(&path).is_ok() || allow_create {
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
