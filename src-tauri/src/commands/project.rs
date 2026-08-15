use crate::config::types::Project;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::Path, result::Result};
use voicevox_core::AudioQuery;

const CURRENT_PROJECT_SCHEMA_VERSION: u32 = 1;

#[derive(Serialize)]
struct ProjectFileRef<'a> {
  schema_version: u32,
  blocks: Vec<ProjectBlockRef<'a>>,
  presets: &'a [crate::config::types::Preset],
}

#[derive(Deserialize)]
struct ProjectFile {
  schema_version: u32,
  blocks: Vec<ProjectBlock>,
  presets: Vec<crate::config::types::Preset>,
}

#[derive(Serialize)]
struct ProjectBlockRef<'a> {
  id: &'a str,
  text: &'a str,
  #[serde(skip_serializing_if = "Option::is_none")]
  query_override: Option<&'a AudioQuery>,
  preset_id: Option<usize>,
}

#[derive(Deserialize)]
struct ProjectBlock {
  id: String,
  text: String,
  #[serde(default)]
  query_override: Option<AudioQuery>,
  preset_id: Option<usize>,
}

fn validate_project(project: &Project) -> Result<(), String> {
  let mut block_ids = HashSet::with_capacity(project.blocks.len());
  for (index, block) in project.blocks.iter().enumerate() {
    if block.id.trim().is_empty() {
      return Err(format!("Project block {index} has an empty ID"));
    }
    if !block_ids.insert(&block.id) {
      return Err(format!("Project block {index} has a duplicate ID"));
    }
    if block.query_is_modified && block.query.is_none() {
      return Err(format!(
        "Project block {index} marks a missing query as modified"
      ));
    }
    if let Some(preset_id) = block.preset_id {
      if preset_id >= project.presets.len() {
        return Err(format!(
          "Project block {index} references missing preset {preset_id}"
        ));
      }
    }
  }

  for (index, preset) in project.presets.iter().enumerate() {
    match (&preset.speaker_uuid, &preset.style_name) {
      (Some(speaker_uuid), Some(style_name))
        if speaker_uuid.trim().is_empty() || style_name.trim().is_empty() =>
      {
        return Err(format!(
          "Project preset {index} has an empty style fallback"
        ));
      }
      (Some(_), None) | (None, Some(_)) => {
        return Err(format!(
          "Project preset {index} has an incomplete style fallback"
        ));
      }
      _ => {}
    }
  }

  Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn save_project(
  project: Project,
  path: String,
  allow_create: bool,
) -> Result<(), String> {
  validate_project(&project)?;
  let project_toml = toml::to_string_pretty(&ProjectFileRef {
    schema_version: CURRENT_PROJECT_SCHEMA_VERSION,
    blocks: project
      .blocks
      .iter()
      .map(|block| ProjectBlockRef {
        id: &block.id,
        text: &block.text,
        query_override: if block.query_is_modified {
          block.query.as_ref()
        } else {
          None
        },
        preset_id: block.preset_id,
      })
      .collect(),
    presets: &project.presets,
  })
  .map_err(|e| e.to_string())?;
  let path = if !path.ends_with(".azp") {
    format!("{path}.azp")
  } else {
    path
  };
  if Path::new(&path).exists() || allow_create {
    fs::write(&path, project_toml).map_err(|e| e.to_string())?;
  } else {
    return Err(format!("Project File {path} does not exist").to_string());
  }
  Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn load_project(path: String) -> Result<Project, String> {
  let project_toml = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
  let project_file: ProjectFile = toml::from_str(&project_toml).map_err(|e| e.to_string())?;
  if project_file.schema_version != CURRENT_PROJECT_SCHEMA_VERSION {
    return Err(format!(
      "Unsupported project schema version {}",
      project_file.schema_version
    ));
  }
  let project = Project {
    blocks: project_file
      .blocks
      .into_iter()
      .map(|block| crate::config::types::TextBlockProps {
        id: block.id,
        text: block.text,
        query_is_modified: block.query_override.is_some(),
        query: block.query_override,
        preset_id: block.preset_id,
      })
      .collect(),
    presets: project_file.presets,
  };
  validate_project(&project)?;
  Ok(project)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::config::types::{Preset, TextBlockProps};

  fn project() -> Project {
    let mut preset = Preset::default();
    preset.speaker_uuid = Some("speaker-uuid".into());
    preset.style_name = Some("Normal".into());
    Project {
      blocks: vec![TextBlockProps {
        id: "block-1".into(),
        text: "こんにちは、Azalea 🌺".into(),
        query: Some(sample_query()),
        query_is_modified: true,
        preset_id: Some(0),
      }],
      presets: vec![preset],
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
      let saved_toml: toml::Value =
        toml::from_str(&std::fs::read_to_string(&saved).unwrap()).unwrap();
      assert_eq!(
        saved_toml["schema_version"].as_integer(),
        Some(CURRENT_PROJECT_SCHEMA_VERSION.into())
      );
      assert_eq!(saved_toml["blocks"][0]["id"].as_str(), Some("block-1"));
      assert!(saved_toml["blocks"][0].get("query").is_none());
      assert!(saved_toml["blocks"][0].get("query_override").is_some());
      let loaded = load_project(saved.to_string_lossy().into_owned())
        .await
        .unwrap();

      assert_eq!(loaded.blocks.len(), 1);
      assert_eq!(loaded.blocks[0].id, "block-1");
      assert_eq!(loaded.blocks[0].text, "こんにちは、Azalea 🌺");
      assert!(loaded.blocks[0].query.is_some());
      assert!(loaded.blocks[0].query_is_modified);
      assert_eq!(loaded.blocks[0].preset_id, Some(0));
      assert_eq!(loaded.presets.len(), 1);
      assert_eq!(
        loaded.presets[0].speaker_uuid.as_deref(),
        Some("speaker-uuid")
      );
      assert_eq!(loaded.presets[0].style_name.as_deref(), Some("Normal"));
    });
  }

  fn sample_query() -> AudioQuery {
    serde_json::from_value(serde_json::json!({
      "accent_phrases": [{
        "moras": [{
          "text": "コ",
          "consonant": "k",
          "consonant_length": 0.08,
          "vowel": "o",
          "vowel_length": 0.12,
          "pitch": 5.4
        }],
        "accent": 1,
        "pause_mora": null,
        "is_interrogative": false
      }],
      "speedScale": 1.0,
      "pitchScale": 0.0,
      "intonationScale": 1.0,
      "volumeScale": 1.0,
      "prePhonemeLength": 0.1,
      "postPhonemeLength": 0.1,
      "outputSamplingRate": 24000,
      "outputStereo": false
    }))
    .unwrap()
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
  fn save_rejects_invalid_ids_queries_and_fallbacks() {
    tauri::async_runtime::block_on(async {
      let directory = tempfile::tempdir().unwrap();

      let mut empty_id = project();
      empty_id.blocks[0].id = " ".into();
      let path = directory.path().join("empty-id.azp");
      let error = save_project(empty_id, path.to_string_lossy().into_owned(), true)
        .await
        .unwrap_err();
      assert!(error.contains("empty ID"));
      assert!(!path.exists());

      let mut missing_query = project();
      missing_query.blocks[0].query = None;
      let path = directory.path().join("missing-query.azp");
      let error = save_project(missing_query, path.to_string_lossy().into_owned(), true)
        .await
        .unwrap_err();
      assert!(error.contains("missing query"));
      assert!(!path.exists());

      let mut incomplete_fallback = project();
      incomplete_fallback.presets[0].style_name = None;
      let path = directory.path().join("incomplete-fallback.azp");
      let error = save_project(
        incomplete_fallback,
        path.to_string_lossy().into_owned(),
        true,
      )
      .await
      .unwrap_err();
      assert!(error.contains("incomplete style fallback"));
      assert!(!path.exists());
    });
  }

  #[test]
  fn load_rejects_missing_malformed_and_unversioned_projects() {
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

      for (name, contents) in [
        ("unversioned.azp", "blocks = []\npresets = []\n"),
        (
          "zero-version.azp",
          "schema_version = 0\nblocks = []\npresets = []\n",
        ),
        (
          "string-version.azp",
          "schema_version = \"1\"\nblocks = []\npresets = []\n",
        ),
        (
          "negative-version.azp",
          "schema_version = -1\nblocks = []\npresets = []\n",
        ),
        (
          "missing-id.azp",
          "schema_version = 1\npresets = []\n[[blocks]]\ntext = \"missing\"\n",
        ),
        (
          "empty-id.azp",
          "schema_version = 1\npresets = []\n[[blocks]]\nid = \" \"\ntext = \"empty\"\n",
        ),
      ] {
        let path = directory.path().join(name);
        std::fs::write(&path, contents).unwrap();
        assert!(
          load_project(path.to_string_lossy().into_owned())
            .await
            .is_err(),
          "{name} should be rejected"
        );
      }
    });
  }

  #[test]
  fn save_omits_regenerable_queries() {
    tauri::async_runtime::block_on(async {
      let directory = tempfile::tempdir().unwrap();
      let path = directory.path().join("derived.azp");
      let mut derived_project = project();
      derived_project.blocks[0].query_is_modified = false;

      save_project(derived_project, path.to_string_lossy().into_owned(), true)
        .await
        .unwrap();
      let saved_toml: toml::Value =
        toml::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
      assert!(saved_toml["blocks"][0].get("query_override").is_none());
      let loaded = load_project(path.to_string_lossy().into_owned())
        .await
        .unwrap();
      assert!(loaded.blocks[0].query.is_none());
      assert!(!loaded.blocks[0].query_is_modified);
    });
  }

  #[test]
  fn load_rejects_unsupported_schemas_and_invalid_current_projects() {
    tauri::async_runtime::block_on(async {
      let directory = tempfile::tempdir().unwrap();
      let newer = directory.path().join("newer.azp");
      std::fs::write(
        &newer,
        format!(
          "schema_version = {}\nblocks = []\npresets = []\n",
          CURRENT_PROJECT_SCHEMA_VERSION + 1
        ),
      )
      .unwrap();
      let error = load_project(newer.to_string_lossy().into_owned())
        .await
        .err()
        .expect("unsupported project schemas should be rejected");
      assert!(error.contains("Unsupported project schema version"));

      let duplicate_ids = directory.path().join("duplicates.azp");
      std::fs::write(
        &duplicate_ids,
        "schema_version = 1\npresets = []\n[[blocks]]\nid = \"same\"\ntext = \"a\"\n[[blocks]]\nid = \"same\"\ntext = \"b\"\n",
      )
      .unwrap();
      let error = load_project(duplicate_ids.to_string_lossy().into_owned())
        .await
        .err()
        .expect("duplicate block IDs should be rejected");
      assert!(error.contains("duplicate ID"));

      let missing_preset = directory.path().join("missing-preset.azp");
      std::fs::write(
        &missing_preset,
        "schema_version = 1\npresets = []\n[[blocks]]\nid = \"block\"\ntext = \"a\"\npreset_id = 0\n",
      )
      .unwrap();
      let error = load_project(missing_preset.to_string_lossy().into_owned())
        .await
        .err()
        .expect("missing preset references should be rejected");
      assert!(error.contains("references missing preset"));
    });
  }
}
