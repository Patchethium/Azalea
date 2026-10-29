//! Presets the MCP server keeps in its own file, `mcp_presets.toml` in the
//! config directory. They use the app's `Preset` format but are separate from
//! its system and project presets, so a running app never overwrites them and
//! never shows them.
use std::path::Path;

use rmcp::schemars;
use serde::{Deserialize, Serialize};
use typed_floats::{NonNaNFinite, PositiveFinite};
use voicevox_core::{AudioQuery, StyleId};

use super::{SpeakerInfo, StyleInfo};
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

#[derive(Default, Serialize, Deserialize)]
struct PresetFile {
  #[serde(default)]
  presets: Vec<Preset>,
}

/// Reads the stored presets; a missing file has none.
pub fn load_presets(path: &Path) -> Result<Vec<Preset>, String> {
  let text = match std::fs::read_to_string(path) {
    Ok(text) => text,
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
    Err(error) => return Err(format!("Failed to read {}: {error}", path.display())),
  };
  toml::from_str::<PresetFile>(&text)
    .map(|file| file.presets)
    .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
}

pub fn save_presets(path: &Path, presets: &[Preset]) -> Result<(), String> {
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

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreatePresetRequest {
  /// A name not used by another preset.
  pub name: String,
  /// Speaker name or UUID, as listed by `list_speakers`.
  pub speaker: String,
  /// Style name or numeric style ID, as listed by `list_speakers`.
  pub style: String,
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
}

#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct PresetInfo {
  pub id: String,
  pub name: String,
  /// The voice's speaker and style names, absent when it is not installed.
  pub speaker: Option<String>,
  pub style: Option<String>,
  pub speaker_uuid: Option<String>,
  pub style_id: u32,
  /// Whether the preset's voice is installed, so `synthesize` can use it.
  pub available: bool,
  pub speed: u32,
  pub pitch: f64,
  pub intonation: f64,
  pub volume: f64,
  pub start_silence_ms: u32,
  pub end_silence_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct PresetList {
  pub presets: Vec<PresetInfo>,
}

fn check_range<T: PartialOrd + std::fmt::Display>(
  field: &str,
  value: T,
  (min, max): (T, T),
) -> Result<T, String> {
  if value >= min && value <= max {
    Ok(value)
  } else {
    Err(format!(
      "{field} must be between {min} and {max}, got {value}"
    ))
  }
}

/// Builds a preset from a request whose voice is already resolved, checking
/// the name against `existing` and every value against the editor's ranges.
pub fn new_preset(
  request: &CreatePresetRequest,
  speaker: &SpeakerInfo,
  style: &StyleInfo,
  existing: &[Preset],
) -> Result<Preset, String> {
  let name = request.name.trim();
  if name.is_empty() {
    return Err("The preset name is empty.".into());
  }
  if existing
    .iter()
    .any(|preset| preset.name.to_lowercase() == name.to_lowercase())
  {
    return Err(format!("A preset named \"{name}\" already exists."));
  }
  let silence = |field: &str, value: Option<u32>| {
    check_range(
      field,
      value.unwrap_or(DEFAULT_SILENCE_MS),
      (0, MAX_SILENCE_MS),
    )
  };
  Ok(Preset {
    id: uuid::Uuid::new_v4().to_string(),
    name: name.to_owned(),
    style_id: StyleId(style.id),
    speed: check_range("speed", request.speed.unwrap_or(DEFAULT_SPEED), SPEED_RANGE)?,
    pitch: check_range("pitch", request.pitch.unwrap_or(0.0), PITCH_RANGE)?,
    intonation: check_range("intonation", request.intonation.unwrap_or(1.0), SCALE_RANGE)?,
    volume: check_range("volume", request.volume.unwrap_or(1.0), SCALE_RANGE)?,
    start_slience: silence("start_silence_ms", request.start_silence_ms)? as f32,
    end_slience: silence("end_silence_ms", request.end_silence_ms)? as f32,
    speaker_uuid: Some(speaker.speaker_uuid.clone()),
    style_name: Some(style.name.clone()),
  })
}

/// Finds a preset by ID, then by name (exactly, then ignoring case).
pub fn find_preset<'a>(presets: &'a [Preset], key: &str) -> Result<&'a Preset, String> {
  let key = key.trim();
  presets
    .iter()
    .find(|preset| preset.id == key || preset.name == key)
    .or_else(|| {
      presets
        .iter()
        .find(|preset| preset.name.to_lowercase() == key.to_lowercase())
    })
    .ok_or_else(|| {
      if presets.is_empty() {
        format!("Unknown preset \"{key}\". No presets exist yet; create one with create_preset.")
      } else {
        let names: Vec<&str> = presets.iter().map(|preset| preset.name.as_str()).collect();
        format!(
          "Unknown preset \"{key}\". Available presets: {}",
          names.join(", ")
        )
      }
    })
}

/// Resolves a preset's voice against the installed speakers. A stored speaker
/// UUID must be installed, so a style ID another speaker reuses is never
/// picked; the style is matched by its stored name, then its ID. Presets without
/// a UUID fall back to the style ID.
pub fn preset_voice<'a>(
  speakers: &'a [SpeakerInfo],
  preset: &Preset,
) -> Result<(&'a SpeakerInfo, &'a StyleInfo), String> {
  let unavailable = || format!("The voice of preset \"{}\" is not installed.", preset.name);
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
            .find(|style| style.id == preset.style_id.0)
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
          .find(|style| style.id == preset.style_id.0)
          .map(|style| (speaker, style))
      })
      .ok_or_else(unavailable),
  }
}

/// Reports a stored `f32` without its binary noise (0.8, not 0.800000011920929).
fn rounded(value: f32) -> f64 {
  (value as f64 * 1000.0).round() / 1000.0
}

pub fn preset_info(speakers: &[SpeakerInfo], preset: &Preset) -> PresetInfo {
  let voice = preset_voice(speakers, preset).ok();
  PresetInfo {
    id: preset.id.clone(),
    name: preset.name.clone(),
    speaker: voice.map(|(speaker, _)| speaker.name.clone()),
    style: voice.map(|(_, style)| style.name.clone()),
    speaker_uuid: preset.speaker_uuid.clone(),
    style_id: voice.map_or(preset.style_id.0, |(_, style)| style.id),
    available: voice.is_some(),
    speed: preset.speed,
    pitch: rounded(preset.pitch),
    intonation: rounded(preset.intonation),
    volume: rounded(preset.volume),
    start_silence_ms: preset.start_slience.round() as u32,
    end_silence_ms: preset.end_slience.round() as u32,
  }
}

/// Applies a preset's speed, pitch, intonation, volume and silences to a query,
/// as the app's `getModifiedQuery` does.
pub fn apply_preset(query: &mut AudioQuery, preset: &Preset) -> Result<(), String> {
  let invalid = |field: &str| format!("Preset \"{}\" has an invalid {field}.", preset.name);
  query.speed_scale =
    PositiveFinite::<f32>::new(preset.speed as f32 / 100.0).map_err(|_| invalid("speed"))?;
  query.pitch_scale = NonNaNFinite::<f32>::new(preset.pitch).map_err(|_| invalid("pitch"))?;
  query.intonation_scale =
    NonNaNFinite::<f32>::new(preset.intonation).map_err(|_| invalid("intonation"))?;
  query.volume_scale = PositiveFinite::<f32>::new(preset.volume).map_err(|_| invalid("volume"))?;
  query.pre_phoneme_length = PositiveFinite::<f32>::new(preset.start_slience / 1000.0)
    .map_err(|_| invalid("start silence"))?;
  query.post_phoneme_length =
    PositiveFinite::<f32>::new(preset.end_slience / 1000.0).map_err(|_| invalid("end silence"))?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

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

  fn request(name: &str) -> CreatePresetRequest {
    CreatePresetRequest {
      name: name.into(),
      speaker: "ずんだもん".into(),
      style: "あまあま".into(),
      speed: None,
      pitch: None,
      intonation: None,
      volume: None,
      start_silence_ms: None,
      end_silence_ms: None,
    }
  }

  fn zunda_amaama(speakers: &[SpeakerInfo]) -> (&SpeakerInfo, &StyleInfo) {
    (&speakers[1], &speakers[1].styles[1])
  }

  #[test]
  fn new_preset_applies_defaults_and_stores_the_voice_identity() {
    let speakers = speakers();
    let (speaker, style) = zunda_amaama(&speakers);
    let preset = new_preset(&request(" Narration "), speaker, style, &[]).unwrap();
    assert_eq!(preset.name, "Narration");
    assert!(uuid::Uuid::parse_str(&preset.id).is_ok());
    assert_eq!(preset.style_id, StyleId(1));
    assert_eq!(preset.speaker_uuid.as_deref(), Some("zunda"));
    assert_eq!(preset.style_name.as_deref(), Some("あまあま"));
    assert_eq!(
      (preset.speed, preset.pitch, preset.intonation, preset.volume),
      (100, 0.0, 1.0, 1.0)
    );
    assert_eq!((preset.start_slience, preset.end_slience), (100.0, 100.0));
  }

  #[test]
  fn new_preset_rejects_duplicate_or_empty_names_and_out_of_range_values() {
    let speakers = speakers();
    let (speaker, style) = zunda_amaama(&speakers);
    let existing = vec![new_preset(&request("Narration"), speaker, style, &[]).unwrap()];
    let error = new_preset(&request("narration"), speaker, style, &existing).unwrap_err();
    assert!(error.contains("already exists"), "{error}");
    assert!(new_preset(&request("  "), speaker, style, &[]).is_err());

    let cases: [(&str, fn(&mut CreatePresetRequest)); 6] = [
      ("speed", |r| r.speed = Some(49)),
      ("pitch", |r| r.pitch = Some(0.6)),
      ("intonation", |r| r.intonation = Some(-0.1)),
      ("volume", |r| r.volume = Some(f32::NAN)),
      ("start_silence_ms", |r| r.start_silence_ms = Some(1501)),
      ("end_silence_ms", |r| r.end_silence_ms = Some(2000)),
    ];
    for (field, edit) in cases {
      let mut request = request("Out of range");
      edit(&mut request);
      let error = new_preset(&request, speaker, style, &[]).unwrap_err();
      assert!(error.starts_with(field), "{error}");
    }
  }

  #[test]
  fn presets_round_trip_through_the_file_and_a_missing_file_has_none() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested").join(PRESETS_FILE);
    assert!(load_presets(&path).unwrap().is_empty());

    let speakers = speakers();
    let (speaker, style) = zunda_amaama(&speakers);
    let mut fast = request("Fast");
    fast.speed = Some(150);
    fast.end_silence_ms = Some(0);
    let presets = vec![new_preset(&fast, speaker, style, &[]).unwrap()];
    save_presets(&path, &presets).unwrap();
    let loaded = load_presets(&path).unwrap();
    assert_eq!(
      preset_info(&speakers, &loaded[0]),
      preset_info(&speakers, &presets[0])
    );
    let mut precise = presets[0].clone();
    precise.intonation = 0.8;
    precise.pitch = 0.15;
    let info = preset_info(&speakers, &precise);
    assert_eq!((info.intonation, info.pitch), (0.8, 0.15));

    std::fs::write(&path, "presets = 3").unwrap();
    assert!(load_presets(&path).unwrap_err().contains("Failed to parse"));
  }

  #[test]
  fn find_preset_matches_ids_and_names_and_lists_the_alternatives() {
    let speakers = speakers();
    let (speaker, style) = zunda_amaama(&speakers);
    let first = new_preset(&request("Narration"), speaker, style, &[]).unwrap();
    let second = new_preset(&request("Calm"), speaker, style, &[first.clone()]).unwrap();
    let presets = vec![first, second];
    assert_eq!(find_preset(&presets, &presets[1].id).unwrap().name, "Calm");
    assert_eq!(find_preset(&presets, "calm").unwrap().name, "Calm");
    let error = find_preset(&presets, "Loud").unwrap_err();
    assert!(error.contains("Narration, Calm"), "{error}");
    let error = find_preset(&[], "Loud").unwrap_err();
    assert!(error.contains("create_preset"), "{error}");
  }

  #[test]
  fn preset_voice_never_falls_back_to_another_speaker_reusing_the_style_id() {
    let speakers = speakers();
    let (speaker, style) = zunda_amaama(&speakers);
    let mut preset = new_preset(&request("Narration"), speaker, style, &[]).unwrap();
    let (found, found_style) = preset_voice(&speakers, &preset).unwrap();
    assert_eq!((found.name.as_str(), found_style.id), ("ずんだもん", 1));

    // A renumbered style is found by its stored name.
    preset.style_id = StyleId(99);
    assert_eq!(preset_voice(&speakers, &preset).unwrap().1.id, 1);

    // An uninstalled speaker is unavailable even though ID 2 exists elsewhere.
    preset.speaker_uuid = Some("gone".into());
    preset.style_id = StyleId(2);
    assert!(preset_voice(&speakers, &preset).is_err());
    let info = preset_info(&speakers, &preset);
    assert!(!info.available);
    assert_eq!((info.speaker, info.style_id), (None, 2));

    // Presets without an identity use the style ID.
    preset.speaker_uuid = None;
    preset.style_name = None;
    assert_eq!(
      preset_voice(&speakers, &preset).unwrap().0.name,
      "四国めたん"
    );
  }

  #[test]
  fn apply_preset_sets_the_query_scales_and_silences_in_seconds() {
    let speakers = speakers();
    let (speaker, style) = zunda_amaama(&speakers);
    let mut custom = request("Custom");
    custom.speed = Some(150);
    custom.pitch = Some(-0.25);
    custom.intonation = Some(1.5);
    custom.volume = Some(0.0);
    custom.start_silence_ms = Some(0);
    custom.end_silence_ms = Some(1500);
    let preset = new_preset(&custom, speaker, style, &[]).unwrap();
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
