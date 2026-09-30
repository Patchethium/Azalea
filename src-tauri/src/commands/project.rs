use crate::config::types::{Preset, Project, TextBlockProps};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::Path, result::Result};
use voicevox_core::AudioQuery;

const CURRENT_PROJECT_SCHEMA_VERSION: u32 = 1;

#[derive(Serialize)]
struct ProjectFileRef<'a> {
  schema_version: u32,
  blocks: Vec<ProjectBlockRef<'a>>,
  presets: &'a [Preset],
}

#[derive(Deserialize)]
struct ProjectFile {
  schema_version: u32,
  blocks: Vec<ProjectBlock>,
  presets: Vec<Preset>,
}

#[derive(Serialize)]
struct ProjectBlockRef<'a> {
  id: &'a str,
  text: &'a str,
  pitch_noise_seed: u32,
  #[serde(skip_serializing_if = "Option::is_none")]
  query_override: Option<&'a AudioQuery>,
  accent_is_modified: bool,
  duration_is_modified: bool,
  pitch_is_modified: bool,
  preset_id: Option<&'a str>,
}

#[derive(Deserialize)]
struct ProjectBlock {
  id: String,
  text: String,
  pitch_noise_seed: u32,
  #[serde(default)]
  query_override: Option<AudioQuery>,
  #[serde(default)]
  accent_is_modified: bool,
  #[serde(default)]
  duration_is_modified: bool,
  #[serde(default)]
  pitch_is_modified: bool,
  preset_id: Option<String>,
}

fn validate_project(project: &Project) -> Result<(), String> {
  let mut preset_ids = HashSet::with_capacity(project.presets.len());
  for (index, preset) in project.presets.iter().enumerate() {
    if preset.id.trim().is_empty() {
      return Err(format!("Project preset {index} has an empty ID"));
    }
    if !preset_ids.insert(&preset.id) {
      return Err(format!("Project preset {index} has a duplicate ID"));
    }
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

  let mut block_ids = HashSet::with_capacity(project.blocks.len());
  for (index, block) in project.blocks.iter().enumerate() {
    if block.id.trim().is_empty() {
      return Err(format!("Project block {index} has an empty ID"));
    }
    if !block_ids.insert(&block.id) {
      return Err(format!("Project block {index} has a duplicate ID"));
    }
    if block.is_query_modified() && block.query.is_none() {
      return Err(format!(
        "Project block {index} marks a missing query as modified"
      ));
    }
    if let Some(preset_id) = &block.preset_id {
      if !preset_ids.contains(preset_id) {
        return Err(format!(
          "Project block {index} references missing preset {preset_id}"
        ));
      }
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
        pitch_noise_seed: block.pitch_noise_seed,
        query_override: if block.is_query_modified() {
          block.query.as_ref()
        } else {
          None
        },
        accent_is_modified: block.accent_is_modified,
        duration_is_modified: block.duration_is_modified,
        pitch_is_modified: block.pitch_is_modified,
        preset_id: block.preset_id.as_deref(),
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
  for (index, block) in project_file.blocks.iter().enumerate() {
    let modified =
      block.accent_is_modified || block.duration_is_modified || block.pitch_is_modified;
    if modified != block.query_override.is_some() {
      return Err(format!(
        "Project block {index} has inconsistent query override flags"
      ));
    }
  }
  let project = Project {
    blocks: project_file
      .blocks
      .into_iter()
      .map(|block| TextBlockProps {
        id: block.id,
        text: block.text,
        pitch_noise_seed: block.pitch_noise_seed,
        query: block.query_override,
        accent_is_modified: block.accent_is_modified,
        duration_is_modified: block.duration_is_modified,
        pitch_is_modified: block.pitch_is_modified,
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
    preset.id = "preset-1".into();
    preset.speaker_uuid = Some("speaker-uuid".into());
    preset.style_name = Some("Normal".into());
    Project {
      blocks: vec![TextBlockProps {
        id: "block-1".into(),
        text: "こんにちは、Azalea 🌺".into(),
        pitch_noise_seed: 42,
        query: Some(sample_query()),
        accent_is_modified: true,
        duration_is_modified: true,
        pitch_is_modified: false,
        preset_id: Some("preset-1".into()),
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
      assert_eq!(
        saved_toml["blocks"][0]["preset_id"].as_str(),
        Some("preset-1")
      );
      assert_eq!(saved_toml["presets"][0]["id"].as_str(), Some("preset-1"));
      assert!(saved_toml["blocks"][0].get("query").is_none());
      assert!(saved_toml["blocks"][0].get("query_override").is_some());
      assert_eq!(
        saved_toml["blocks"][0]["accent_is_modified"].as_bool(),
        Some(true)
      );
      assert_eq!(
        saved_toml["blocks"][0]["duration_is_modified"].as_bool(),
        Some(true)
      );
      assert_eq!(
        saved_toml["blocks"][0]["pitch_is_modified"].as_bool(),
        Some(false)
      );
      let loaded = load_project(saved.to_string_lossy().into_owned())
        .await
        .unwrap();

      assert_eq!(loaded.blocks.len(), 1);
      assert_eq!(loaded.blocks[0].id, "block-1");
      assert_eq!(loaded.blocks[0].text, "こんにちは、Azalea 🌺");
      assert_eq!(loaded.blocks[0].pitch_noise_seed, 42);
      assert!(loaded.blocks[0].query.is_some());
      assert!(loaded.blocks[0].accent_is_modified);
      assert!(loaded.blocks[0].duration_is_modified);
      assert!(!loaded.blocks[0].pitch_is_modified);
      assert!(loaded.blocks[0].is_query_modified());
      assert_eq!(loaded.blocks[0].preset_id.as_deref(), Some("preset-1"));
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

      let mut empty_preset_id = project();
      empty_preset_id.presets[0].id = " ".into();
      let path = directory.path().join("empty-preset-id.azp");
      let error = save_project(empty_preset_id, path.to_string_lossy().into_owned(), true)
        .await
        .unwrap_err();
      assert!(error.contains("preset 0 has an empty ID"), "{error}");
      assert!(!path.exists());

      let mut duplicate_preset_id = project();
      duplicate_preset_id
        .presets
        .push(duplicate_preset_id.presets[0].clone());
      let path = directory.path().join("duplicate-preset-id.azp");
      let error = save_project(
        duplicate_preset_id,
        path.to_string_lossy().into_owned(),
        true,
      )
      .await
      .unwrap_err();
      assert!(error.contains("duplicate ID"));
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
  fn load_rejects_missing_or_invalid_block_seeds() {
    tauri::async_runtime::block_on(async {
      let directory = tempfile::tempdir().unwrap();
      let path = directory.path().join("seed.azp");
      for seed in [
        "",
        "pitch_noise_seed = -1",
        "pitch_noise_seed = 4294967296",
        "pitch_noise_seed = 1.5",
      ] {
        std::fs::write(
          &path,
          format!(
          "schema_version = 1\npresets = []\n[[blocks]]\nid = \"block\"\ntext = \"text\"\n{seed}\n"
        ),
        )
        .unwrap();
        assert!(load_project(path.to_string_lossy().into_owned())
          .await
          .is_err());
      }
    });
  }

  #[test]
  fn load_rejects_query_overrides_without_modified_flags() {
    tauri::async_runtime::block_on(async {
      let directory = tempfile::tempdir().unwrap();
      let path = directory.path().join("inconsistent.azp");
      save_project(project(), path.to_string_lossy().into_owned(), true)
        .await
        .unwrap();
      let saved = path.with_extension("azp");
      let mut saved_toml: toml::Value =
        toml::from_str(&std::fs::read_to_string(&saved).unwrap()).unwrap();
      saved_toml["blocks"][0]["accent_is_modified"] = false.into();
      saved_toml["blocks"][0]["duration_is_modified"] = false.into();
      std::fs::write(&saved, toml::to_string(&saved_toml).unwrap()).unwrap();

      let error = load_project(saved.to_string_lossy().into_owned())
        .await
        .err()
        .expect("inconsistent query override flags should be rejected");
      assert!(
        error.contains("inconsistent query override flags"),
        "{error}"
      );
    });
  }

  #[test]
  fn save_omits_regenerable_queries() {
    tauri::async_runtime::block_on(async {
      let directory = tempfile::tempdir().unwrap();
      let path = directory.path().join("derived.azp");
      let mut derived_project = project();
      derived_project.blocks[0].accent_is_modified = false;
      derived_project.blocks[0].duration_is_modified = false;
      derived_project.blocks[0].pitch_is_modified = false;

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
      assert!(!loaded.blocks[0].accent_is_modified);
      assert!(!loaded.blocks[0].duration_is_modified);
      assert!(!loaded.blocks[0].pitch_is_modified);
      assert!(!loaded.blocks[0].is_query_modified());
      assert_eq!(loaded.blocks[0].pitch_noise_seed, 42);
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
        "schema_version = 1\npresets = []\n[[blocks]]\nid = \"same\"\ntext = \"a\"\npitch_noise_seed = 0\n[[blocks]]\nid = \"same\"\ntext = \"b\"\npitch_noise_seed = 0\n",
      )
      .unwrap();
      let error = load_project(duplicate_ids.to_string_lossy().into_owned())
        .await
        .err()
        .expect("duplicate block IDs should be rejected");
      assert!(error.contains("duplicate ID"));

      let missing_preset_id = directory.path().join("missing-preset-id.azp");
      save_project(
        project(),
        missing_preset_id.to_string_lossy().into_owned(),
        true,
      )
      .await
      .unwrap();
      let contents = std::fs::read_to_string(&missing_preset_id)
        .unwrap()
        .replace("\nid = \"preset-1\"\n", "\n");
      std::fs::write(&missing_preset_id, contents).unwrap();
      let error = load_project(missing_preset_id.to_string_lossy().into_owned())
        .await
        .err()
        .expect("missing preset IDs should be rejected");
      assert!(error.contains("preset 0 has an empty ID"), "{error}");

      let missing_preset = directory.path().join("missing-preset.azp");
      std::fs::write(
        &missing_preset,
        "schema_version = 1\npresets = []\n[[blocks]]\nid = \"block\"\ntext = \"a\"\npitch_noise_seed = 0\npreset_id = \"missing\"\n",
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
