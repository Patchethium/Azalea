//! The presets the MCP server offers: the agent's own, which it creates, edits
//! and deletes, kept in `mcp_presets.toml` in the config directory until
//! deleted, and the app's system presets, which it only reads. A running app
//! never shows or overwrites the agent's presets.
use std::path::{Path, PathBuf};

use rmcp::schemars;
use serde::{Deserialize, Deserializer, Serialize};
use typed_floats::{NonNaNFinite, PositiveFinite};
use voicevox_core::AudioQuery;

use super::{
  fail,
  ids::{is_word_pair, normalize, IdFile},
  SpeakerInfo, StyleInfo,
};
use crate::{atomic_file::write_with_backup, config::types::Preset};

pub const PRESETS_FILE: &str = "mcp_presets.toml";

/// Defaults match synthesis without a preset (VOICEVOX's query defaults).
const DEFAULT_SPEED: u32 = 100;
const DEFAULT_SILENCE_MS: u32 = 100;
/// Ranges of the app's preset editor.
const SPEED_RANGE: (u32, u32) = (50, 200);
const PITCH_RANGE: (f32, f32) = (-0.5, 0.5);
const SCALE_RANGE: (f32, f32) = (0.0, 2.0);
const MAX_SILENCE_MS: u32 = 1500;

fn default_speed() -> u32 {
  DEFAULT_SPEED
}

fn default_scale() -> f32 {
  1.0
}

fn default_silence() -> u32 {
  DEFAULT_SILENCE_MS
}

/// Accepts the whole or fractional milliseconds earlier files stored.
fn deserialize_milliseconds<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u32, D::Error> {
  let value = f64::deserialize(deserializer)?;
  if value.is_finite() && (0.0..=u32::MAX as f64).contains(&value) {
    Ok(value.round() as u32)
  } else {
    Err(serde::de::Error::custom("invalid silence length"))
  }
}

/// A preset as the server keeps it. Files written before agent presets could be
/// edited used the app's `Preset` field names, which are still read.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StoredPreset {
  #[serde(default)]
  pub id: String,
  #[serde(default)]
  pub name: String,
  /// The voice; all three are absent until the agent chooses one.
  #[serde(default)]
  pub speaker_uuid: Option<String>,
  #[serde(default)]
  pub style_name: Option<String>,
  #[serde(default)]
  pub style_id: Option<u32>,
  #[serde(default = "default_speed")]
  pub speed: u32,
  #[serde(default)]
  pub pitch: f32,
  #[serde(default = "default_scale")]
  pub intonation: f32,
  #[serde(default = "default_scale")]
  pub volume: f32,
  #[serde(
    default = "default_silence",
    alias = "start_slience",
    deserialize_with = "deserialize_milliseconds"
  )]
  pub start_silence_ms: u32,
  #[serde(
    default = "default_silence",
    alias = "end_slience",
    deserialize_with = "deserialize_milliseconds"
  )]
  pub end_silence_ms: u32,
}

impl StoredPreset {
  /// What `create_preset` returns: defaults and no voice.
  pub fn template(id: String) -> Self {
    Self {
      id,
      name: String::new(),
      speaker_uuid: None,
      style_name: None,
      style_id: None,
      speed: DEFAULT_SPEED,
      pitch: 0.0,
      intonation: 1.0,
      volume: 1.0,
      start_silence_ms: DEFAULT_SILENCE_MS,
      end_silence_ms: DEFAULT_SILENCE_MS,
    }
  }

  /// One of the app's presets under the server's ID for it.
  fn from_app(id: String, preset: &Preset) -> Self {
    Self {
      id,
      name: preset.name.clone(),
      speaker_uuid: preset.speaker_uuid.clone(),
      style_name: preset.style_name.clone(),
      style_id: Some(preset.style_id.0),
      speed: preset.speed,
      pitch: preset.pitch,
      intonation: preset.intonation,
      volume: preset.volume,
      start_silence_ms: preset.start_slience.max(0.0).round() as u32,
      end_silence_ms: preset.end_slience.max(0.0).round() as u32,
    }
  }

  /// Whether a voice has been chosen.
  pub fn is_complete(&self) -> bool {
    self.speaker_uuid.is_some() || self.style_id.is_some()
  }
}

#[derive(Default, Serialize, Deserialize)]
struct PresetFile {
  #[serde(default)]
  presets: Vec<StoredPreset>,
}

fn load_presets(path: &Path) -> Result<Vec<StoredPreset>, String> {
  let text = match std::fs::read_to_string(path) {
    Ok(text) => text,
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
    Err(error) => return Err(format!("Failed to read {}: {error}", path.display())),
  };
  toml::from_str::<PresetFile>(&text)
    .map(|file| file.presets)
    .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
}

fn save_presets(path: &Path, presets: &[StoredPreset]) -> Result<(), String> {
  if let Some(dir) = path.parent() {
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
  }
  let text = toml::to_string_pretty(&PresetFile {
    presets: presets.to_vec(),
  })
  .map_err(|e| e.to_string())?;
  write_with_backup(path, text.as_bytes())
    .map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

/// Every preset a call can name.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Catalog {
  pub agent: Vec<StoredPreset>,
  pub user: Vec<StoredPreset>,
}

impl Catalog {
  /// Finds a preset by ID and says whether it is the user's.
  pub fn find(&self, id: &str) -> Result<(&StoredPreset, bool), String> {
    let id = normalize(id);
    let agent = self.agent.iter().map(|preset| (preset, false));
    let user = self.user.iter().map(|preset| (preset, true));
    agent
      .chain(user)
      .find(|(preset, _)| preset.id == id)
      .ok_or_else(|| self.unknown(&id))
  }

  fn unknown(&self, id: &str) -> String {
    let known: Vec<String> = self
      .agent
      .iter()
      .chain(&self.user)
      .map(|preset| match preset.name.as_str() {
        "" => preset.id.clone(),
        name => format!("{} ({name})", preset.id),
      })
      .collect();
    if known.is_empty() {
      fail(
        "unknown_preset",
        format!("No preset has the ID \"{id}\", and none exist yet; make one with create_preset."),
      )
    } else {
      fail(
        "unknown_preset",
        format!(
          "No preset has the ID \"{id}\". Preset IDs: {}",
          known.join(", ")
        ),
      )
    }
  }
}

/// The files behind the catalog. Callers serialize access to them.
pub struct PresetStore {
  pub presets_path: PathBuf,
  pub ids_path: PathBuf,
}

impl PresetStore {
  /// Reads the agent's presets and the app's, giving a short ID to any preset
  /// that lacks one: presets from earlier files and app presets seen for the
  /// first time.
  pub fn load(&self, app_presets: &[Preset]) -> Result<(Catalog, IdFile), String> {
    let mut ids = IdFile::load(&self.ids_path)?;
    let mut ids_changed = false;
    let mut agent = load_presets(&self.presets_path)?;
    let mut agent_changed = false;
    for preset in &mut agent {
      let id = normalize(&preset.id);
      if is_word_pair(&id) {
        ids_changed |= ids.reserve(&id);
        agent_changed |= preset.id != id;
        preset.id = id;
      }
    }
    for index in 0..agent.len() {
      let duplicate = agent[..index]
        .iter()
        .any(|earlier| earlier.id == agent[index].id);
      if duplicate || !is_word_pair(&agent[index].id) {
        agent[index].id = ids.issue()?;
        agent_changed = true;
        ids_changed = true;
      }
    }
    let mut user = Vec::with_capacity(app_presets.len());
    for preset in app_presets {
      // Presets the app has not given an ID yet are told apart by name.
      let key = match preset.id.as_str() {
        "" => format!("name:{}", preset.name),
        id => id.to_owned(),
      };
      let (id, changed) = ids.user_preset_id(&key)?;
      ids_changed |= changed;
      user.push(StoredPreset::from_app(id, preset));
    }
    // IDs are recorded before the presets that carry them.
    if ids_changed {
      ids.save(&self.ids_path)?;
    }
    if agent_changed {
      save_presets(&self.presets_path, &agent)?;
    }
    Ok((Catalog { agent, user }, ids))
  }

  pub fn save(&self, agent: &[StoredPreset], ids: &IdFile) -> Result<(), String> {
    ids.save(&self.ids_path)?;
    save_presets(&self.presets_path, agent)
  }
}

#[derive(Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CreatePresetRequest {
  /// ID of a preset from `list_presets` to copy, the user's or the agent's.
  /// Omit for an empty template.
  pub copy_from: Option<String>,
}

/// The preset `create_preset` returned, filled in.
#[derive(Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdatePresetRequest {
  /// The ID `create_preset` returned.
  pub id: String,
  /// A label for your own use.
  pub name: Option<String>,
  /// Speaker name or UUID, as listed by `list_speakers`. Required.
  pub speaker: Option<String>,
  /// Style name or numeric style ID, as listed by `list_speakers`. Required.
  pub style: Option<String>,
  /// Speaking speed in percent, 50–200 (default 100).
  pub speed: Option<u32>,
  /// Pitch shift, -0.5–0.5 (default 0).
  pub pitch: Option<f32>,
  /// Intonation strength, 0–2 (default 1).
  pub intonation: Option<f32>,
  /// Volume, 0–2 (default 1).
  pub volume: Option<f32>,
  /// Silence before the speech in milliseconds, 0–1500 (default 100).
  pub start_silence_ms: Option<u32>,
  /// Silence after the speech in milliseconds, 0–1500 (default 100).
  pub end_silence_ms: Option<u32>,
  /// Read-only; ignored, so a listed preset can be passed back unchanged.
  pub speaker_uuid: Option<String>,
  /// Read-only; ignored.
  pub style_id: Option<u32>,
  /// Read-only; ignored.
  pub available: Option<bool>,
  /// Read-only; ignored.
  pub complete: Option<bool>,
}

#[derive(Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DeletePresetRequest {
  /// ID of one of the agent's presets.
  pub id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct DeletedPreset {
  pub id: String,
  pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct PresetInfo {
  /// Pass this as `preset_id`.
  pub id: String,
  pub name: String,
  /// The voice's speaker and style names, absent until one is chosen or when
  /// it is not installed.
  pub speaker: Option<String>,
  pub style: Option<String>,
  pub speed: u32,
  pub pitch: f64,
  pub intonation: f64,
  pub volume: f64,
  pub start_silence_ms: u32,
  pub end_silence_ms: u32,
  pub speaker_uuid: Option<String>,
  pub style_id: Option<u32>,
  /// Whether a voice has been chosen. Fill in speaker and style with
  /// `update_preset` to complete a template.
  pub complete: bool,
  /// Whether the preset's voice is installed, so it can be used.
  pub available: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct PresetList {
  /// Presets made with `create_preset`; they can be updated and deleted.
  pub agent: Vec<PresetInfo>,
  /// The user's presets from the Azalea app, read-only.
  pub user: Vec<PresetInfo>,
}

fn check_range<T: PartialOrd + std::fmt::Display>(
  field: &str,
  value: T,
  (min, max): (T, T),
) -> Result<T, String> {
  if value >= min && value <= max {
    Ok(value)
  } else {
    Err(fail(
      "invalid_argument",
      format!("{field} must be between {min} and {max}, got {value}"),
    ))
  }
}

/// The preset a request describes, replacing every stored value: omitted
/// values return to their defaults. The voice is already resolved.
pub fn updated_preset(
  request: &UpdatePresetRequest,
  speaker: &SpeakerInfo,
  style: &StyleInfo,
) -> Result<StoredPreset, String> {
  let silence = |field: &str, value: Option<u32>| {
    check_range(
      field,
      value.unwrap_or(DEFAULT_SILENCE_MS),
      (0, MAX_SILENCE_MS),
    )
  };
  Ok(StoredPreset {
    id: normalize(&request.id),
    name: request
      .name
      .as_deref()
      .unwrap_or_default()
      .trim()
      .to_owned(),
    speaker_uuid: Some(speaker.speaker_uuid.clone()),
    style_name: Some(style.name.clone()),
    style_id: Some(style.id),
    speed: check_range("speed", request.speed.unwrap_or(DEFAULT_SPEED), SPEED_RANGE)?,
    pitch: check_range("pitch", request.pitch.unwrap_or(0.0), PITCH_RANGE)?,
    intonation: check_range("intonation", request.intonation.unwrap_or(1.0), SCALE_RANGE)?,
    volume: check_range("volume", request.volume.unwrap_or(1.0), SCALE_RANGE)?,
    start_silence_ms: silence("start_silence_ms", request.start_silence_ms)?,
    end_silence_ms: silence("end_silence_ms", request.end_silence_ms)?,
  })
}

/// Resolves a preset's voice against the installed speakers. A stored speaker
/// UUID must be installed, so a style ID another speaker reuses is never
/// picked; the style is matched by its stored name, then its ID. Presets without
/// a UUID fall back to the style ID.
pub fn preset_voice<'a>(
  speakers: &'a [SpeakerInfo],
  preset: &StoredPreset,
) -> Result<(&'a SpeakerInfo, &'a StyleInfo), String> {
  if !preset.is_complete() {
    return Err(fail(
      "incomplete_preset",
      format!(
        "Preset {} has no voice yet. Give it a speaker and style with update_preset.",
        preset.id
      ),
    ));
  }
  let unavailable = || {
    fail(
      "voice_unavailable",
      format!("The voice of preset {} is not installed.", preset.id),
    )
  };
  match &preset.speaker_uuid {
    Some(uuid) => {
      let speaker = speakers
        .iter()
        .find(|speaker| &speaker.speaker_uuid == uuid)
        .ok_or_else(unavailable)?;
      let style = preset
        .style_name
        .as_ref()
        .and_then(|name| speaker.styles.iter().find(|style| &style.name == name))
        .or_else(|| {
          speaker
            .styles
            .iter()
            .find(|style| Some(style.id) == preset.style_id)
        })
        .ok_or_else(unavailable)?;
      Ok((speaker, style))
    }
    None => speakers
      .iter()
      .find_map(|speaker| {
        speaker
          .styles
          .iter()
          .find(|style| Some(style.id) == preset.style_id)
          .map(|style| (speaker, style))
      })
      .ok_or_else(unavailable),
  }
}

/// Reports a stored `f32` without its binary noise (0.8, not 0.800000011920929).
fn rounded(value: f32) -> f64 {
  (value as f64 * 1000.0).round() / 1000.0
}

pub fn preset_info(speakers: &[SpeakerInfo], preset: &StoredPreset) -> PresetInfo {
  let voice = preset_voice(speakers, preset).ok();
  PresetInfo {
    id: preset.id.clone(),
    name: preset.name.clone(),
    speaker: voice.map(|(speaker, _)| speaker.name.clone()),
    style: voice.map(|(_, style)| style.name.clone()),
    speed: preset.speed,
    pitch: rounded(preset.pitch),
    intonation: rounded(preset.intonation),
    volume: rounded(preset.volume),
    start_silence_ms: preset.start_silence_ms,
    end_silence_ms: preset.end_silence_ms,
    speaker_uuid: preset.speaker_uuid.clone(),
    style_id: voice.map(|(_, style)| style.id).or(preset.style_id),
    complete: preset.is_complete(),
    available: voice.is_some(),
  }
}

/// Applies a preset's speed, pitch, intonation, volume and silences to a query,
/// as the app's `getModifiedQuery` does.
pub fn apply_preset(query: &mut AudioQuery, preset: &StoredPreset) -> Result<(), String> {
  let invalid = |field: &str| {
    fail(
      "invalid_argument",
      format!("Preset {} has an invalid {field}.", preset.id),
    )
  };
  query.speed_scale =
    PositiveFinite::<f32>::new(preset.speed as f32 / 100.0).map_err(|_| invalid("speed"))?;
  query.pitch_scale = NonNaNFinite::<f32>::new(preset.pitch).map_err(|_| invalid("pitch"))?;
  query.intonation_scale =
    NonNaNFinite::<f32>::new(preset.intonation).map_err(|_| invalid("intonation"))?;
  query.volume_scale = PositiveFinite::<f32>::new(preset.volume).map_err(|_| invalid("volume"))?;
  query.pre_phoneme_length = PositiveFinite::<f32>::new(preset.start_silence_ms as f32 / 1000.0)
    .map_err(|_| invalid("start silence"))?;
  query.post_phoneme_length = PositiveFinite::<f32>::new(preset.end_silence_ms as f32 / 1000.0)
    .map_err(|_| invalid("end silence"))?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use voicevox_core::StyleId;

  fn speakers() -> Vec<SpeakerInfo> {
    let style = |id, name: &str| StyleInfo {
      id,
      name: name.into(),
    };
    vec![
      SpeakerInfo {
        name: "四国めたん".into(),
        speaker_uuid: "metan".into(),
        styles: vec![style(2, "ノーマル"), style(0, "あまあま")],
      },
      SpeakerInfo {
        name: "ずんだもん".into(),
        speaker_uuid: "zunda".into(),
        styles: vec![style(3, "ノーマル"), style(1, "あまあま")],
      },
    ]
  }

  fn request(id: &str) -> UpdatePresetRequest {
    UpdatePresetRequest {
      id: id.into(),
      ..Default::default()
    }
  }

  fn zunda_amaama(speakers: &[SpeakerInfo]) -> (&SpeakerInfo, &StyleInfo) {
    (&speakers[1], &speakers[1].styles[1])
  }

  fn store(dir: &Path) -> PresetStore {
    PresetStore {
      presets_path: dir.join("nested").join(PRESETS_FILE),
      ids_path: dir.join("nested").join(super::super::ids::IDS_FILE),
    }
  }

  fn app_preset(id: &str, name: &str) -> Preset {
    Preset {
      id: id.into(),
      name: name.into(),
      style_id: StyleId(3),
      speed: 120,
      pitch: 0.1,
      intonation: 0.8,
      volume: 1.0,
      start_slience: 0.0,
      end_slience: 250.4,
      speaker_uuid: Some("zunda".into()),
      style_name: Some("ノーマル".into()),
    }
  }

  #[test]
  fn updated_preset_applies_defaults_and_stores_the_voice_identity() {
    let speakers = speakers();
    let (speaker, style) = zunda_amaama(&speakers);
    let mut named = request(" Quick-Fox ");
    named.name = Some(" Narration ".into());
    let preset = updated_preset(&named, speaker, style).unwrap();
    assert_eq!(
      preset,
      StoredPreset {
        name: "Narration".into(),
        speaker_uuid: Some("zunda".into()),
        style_name: Some("あまあま".into()),
        style_id: Some(1),
        ..StoredPreset::template("quick-fox".into())
      }
    );
    assert!(preset.is_complete());
    assert!(!StoredPreset::template("quick-fox".into()).is_complete());
  }

  #[test]
  fn updated_preset_rejects_out_of_range_values() {
    let speakers = speakers();
    let (speaker, style) = zunda_amaama(&speakers);
    let cases: [(&str, fn(&mut UpdatePresetRequest)); 6] = [
      ("speed", |r| r.speed = Some(49)),
      ("pitch", |r| r.pitch = Some(0.6)),
      ("intonation", |r| r.intonation = Some(-0.1)),
      ("volume", |r| r.volume = Some(f32::NAN)),
      ("start_silence_ms", |r| r.start_silence_ms = Some(1501)),
      ("end_silence_ms", |r| r.end_silence_ms = Some(2000)),
    ];
    for (field, edit) in cases {
      let mut request = request("quick-fox");
      edit(&mut request);
      let error = updated_preset(&request, speaker, style).unwrap_err();
      assert!(
        error.starts_with(&format!("invalid_argument: {field}")),
        "{error}"
      );
    }
  }

  #[test]
  fn store_round_trips_agent_presets_and_gives_app_presets_stable_ids() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(dir.path());
    let app = [app_preset("app-1", "Default"), app_preset("", "Unsaved")];
    let (mut catalog, mut ids) = store.load(&app).unwrap();
    assert!(catalog.agent.is_empty());
    assert_eq!(catalog.user.len(), 2);
    let user = &catalog.user[0];
    assert!(is_word_pair(&user.id));
    assert_eq!(
      (user.name.as_str(), user.speed, user.style_id),
      ("Default", 120, Some(3))
    );
    assert_eq!((user.start_silence_ms, user.end_silence_ms), (0, 250));
    assert_ne!(catalog.user[0].id, catalog.user[1].id);

    let speakers = speakers();
    let (speaker, style) = zunda_amaama(&speakers);
    let id = ids.issue().unwrap();
    let mut fast = request(&id);
    fast.speed = Some(150);
    fast.pitch = Some(0.15);
    fast.end_silence_ms = Some(0);
    catalog
      .agent
      .push(updated_preset(&fast, speaker, style).unwrap());
    store.save(&catalog.agent, &ids).unwrap();

    // App presets keep their IDs when their order changes and one is renamed.
    let mut reordered = [app[1].clone(), app[0].clone()];
    reordered[1].name = "Renamed".into();
    let (reloaded, reloaded_ids) = store.load(&reordered).unwrap();
    assert_eq!(reloaded.agent, catalog.agent);
    assert_eq!(reloaded.user[1].id, catalog.user[0].id);
    assert_eq!(reloaded.user[0].id, catalog.user[1].id);
    assert_eq!(reloaded_ids, ids);
    let info = preset_info(&speakers, &reloaded.agent[0]);
    assert_eq!(
      (info.pitch, info.speed, info.end_silence_ms),
      (0.15, 150, 0)
    );

    std::fs::write(&store.presets_path, "presets = 3").unwrap();
    assert!(store.load(&[]).unwrap_err().contains("Failed to parse"));
  }

  #[test]
  fn store_gives_presets_from_earlier_files_short_ids_once() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(dir.path());
    std::fs::create_dir_all(store.presets_path.parent().unwrap()).unwrap();
    // The app's `Preset` format, as earlier versions of the server wrote it.
    std::fs::write(
      &store.presets_path,
      r#"
[[presets]]
id = "0a6f0c7e-5d0b-4c53-9a53-2f3f3a1f9f10"
name = "Fast"
style_id = 1
speed = 150
pitch = 0.1
intonation = 1.0
volume = 1.0
start_slience = 0.0
end_slience = 100.0
speaker_uuid = "zunda"
style_name = "あまあま"

[[presets]]
id = "Quick-Fox"
name = "Kept"
style_id = 3
speed = 100
pitch = 0.0
intonation = 1.0
volume = 1.0
start_silence_ms = 100
end_silence_ms = 100

[[presets]]
id = "quick-fox"
name = "Duplicate"
"#,
    )
    .unwrap();
    let (catalog, _) = store.load(&[]).unwrap();
    let ids: Vec<&str> = catalog.agent.iter().map(|p| p.id.as_str()).collect();
    assert!(ids.iter().all(|id| is_word_pair(id)), "{ids:?}");
    assert_eq!(ids[1], "quick-fox");
    assert_ne!(ids[0], ids[2]);
    assert!(ids[0] != "quick-fox" && ids[2] != "quick-fox");
    let fast = &catalog.agent[0];
    assert_eq!(
      (fast.name.as_str(), fast.speed, fast.style_id),
      ("Fast", 150, Some(1))
    );
    assert_eq!((fast.start_silence_ms, fast.end_silence_ms), (0, 100));
    assert!(!catalog.agent[2].is_complete());

    // The new IDs were written, so they are the same on the next load.
    assert_eq!(store.load(&[]).unwrap().0, catalog);
  }

  #[test]
  fn catalog_finds_presets_by_id_and_lists_the_ids_otherwise() {
    let mut narration = StoredPreset::template("quick-fox".into());
    narration.name = "Narration".into();
    let catalog = Catalog {
      agent: vec![narration, StoredPreset::template("calm-owl".into())],
      user: vec![StoredPreset {
        name: "Default".into(),
        ..StoredPreset::template("lazy-dog".into())
      }],
    };
    let (found, is_user) = catalog.find(" Quick-Fox ").unwrap();
    assert_eq!((found.name.as_str(), is_user), ("Narration", false));
    assert!(catalog.find("lazy-dog").unwrap().1);
    // Names are not IDs.
    let error = catalog.find("Narration").unwrap_err();
    assert!(error.starts_with("unknown_preset: "), "{error}");
    assert!(
      error.contains("quick-fox (Narration), calm-owl, lazy-dog (Default)"),
      "{error}"
    );
    let error = Catalog::default().find("quick-fox").unwrap_err();
    assert!(error.contains("create_preset"), "{error}");
  }

  #[test]
  fn preset_voice_never_falls_back_to_another_speaker_reusing_the_style_id() {
    let speakers = speakers();
    let (speaker, style) = zunda_amaama(&speakers);
    let mut preset = updated_preset(&request("quick-fox"), speaker, style).unwrap();
    let (found, found_style) = preset_voice(&speakers, &preset).unwrap();
    assert_eq!((found.name.as_str(), found_style.id), ("ずんだもん", 1));

    // A renumbered style is found by its stored name.
    preset.style_id = Some(99);
    assert_eq!(preset_voice(&speakers, &preset).unwrap().1.id, 1);

    // An uninstalled speaker is unavailable even though ID 2 exists elsewhere.
    preset.speaker_uuid = Some("gone".into());
    preset.style_id = Some(2);
    let error = preset_voice(&speakers, &preset).unwrap_err();
    assert!(error.starts_with("voice_unavailable: "), "{error}");
    let info = preset_info(&speakers, &preset);
    assert!(info.complete && !info.available);
    assert_eq!((info.speaker, info.style_id), (None, Some(2)));

    // Presets without an identity use the style ID.
    preset.speaker_uuid = None;
    preset.style_name = None;
    assert_eq!(
      preset_voice(&speakers, &preset).unwrap().0.name,
      "四国めたん"
    );

    // A template has no voice at all.
    let template = StoredPreset::template("calm-owl".into());
    let error = preset_voice(&speakers, &template).unwrap_err();
    assert!(error.starts_with("incomplete_preset: "), "{error}");
    let info = preset_info(&speakers, &template);
    assert!(!info.complete && !info.available);
    assert_eq!((info.speaker, info.style_id), (None, None));
  }

  #[test]
  fn apply_preset_sets_the_query_scales_and_silences_in_seconds() {
    let speakers = speakers();
    let (speaker, style) = zunda_amaama(&speakers);
    let mut custom = request("quick-fox");
    custom.speed = Some(150);
    custom.pitch = Some(-0.25);
    custom.intonation = Some(1.5);
    custom.volume = Some(0.0);
    custom.start_silence_ms = Some(0);
    custom.end_silence_ms = Some(1500);
    let preset = updated_preset(&custom, speaker, style).unwrap();
    let mut query: AudioQuery = serde_json::from_value(serde_json::json!({
      "accent_phrases": [], "speedScale": 1.0, "pitchScale": 0.0, "intonationScale": 1.0,
      "volumeScale": 1.0, "prePhonemeLength": 0.1, "postPhonemeLength": 0.1,
      "outputSamplingRate": 24000, "outputStereo": false
    }))
    .unwrap();
    apply_preset(&mut query, &preset).unwrap();
    assert_eq!(f32::from(query.speed_scale), 1.5);
    assert_eq!(f32::from(query.pitch_scale), -0.25);
    assert_eq!(f32::from(query.intonation_scale), 1.5);
    assert_eq!(f32::from(query.volume_scale), 0.0);
    assert_eq!(f32::from(query.pre_phoneme_length), 0.0);
    assert_eq!(f32::from(query.post_phoneme_length), 1.5);

    let mut broken = preset.clone();
    broken.pitch = f32::INFINITY;
    assert!(apply_preset(&mut query, &broken)
      .unwrap_err()
      .contains("pitch"));
  }
}
