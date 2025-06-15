use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;

use crate::voicevox_sys::{audio_query::AudioQuery, metas::StyleId};

#[derive(Default, Clone, Deserialize, Serialize, Type)]
pub struct AzaleaConfig {
  pub core_config: CoreConfig,
  pub ui_config: UIConfig,
  #[serde(default = "presets_default")]
  pub system_presets: Vec<Preset>,
}

fn presets_default() -> Vec<Preset> {
  vec![Preset::default()]
}

#[derive(Clone, Deserialize, Serialize, Type)]
pub struct CoreConfig {
  /// The Path to the core directory, it should be the directory containing the dynamic library.
  /// For example, if the lib is in `/home/user/VOICEVOX/vv-engine/libvoicevox_core.so`,
  /// the path should be `/home/user/VOICEVOX/vv-engine`.
  pub core_path: Option<PathBuf>,
  pub ojt_path: Option<PathBuf>,
  #[serde(default = "cache_size_default")]
  pub cache_size: usize,
}

impl Default for CoreConfig {
  fn default() -> Self {
    Self {
      core_path: None,
      ojt_path: None,
      cache_size: cache_size_default(),
    }
  }
}

fn cache_size_default() -> usize {
  128
}

#[derive(Clone, Deserialize, Serialize, Type)]
pub enum Locale {
  Ja,
  En,
}

impl Default for Locale {
  fn default() -> Self {
    Locale::En
  }
}

#[derive(Clone, Deserialize, Serialize, Type)]
pub struct UIConfig {
  #[serde(default)]
  pub locale: Locale,
  #[serde(default = "bottom_scale_default")]
  pub bottom_scale: usize,
  #[serde(default)]
  pub auto_save: bool,
  #[serde(default = "bottom_ratio_default")]
  pub bottom_ratio: f32,
  #[serde(default = "side_ratio_default")]
  pub side_ratio: f32,
}

impl Default for UIConfig {
  fn default() -> Self {
    Self {
      locale: Default::default(),
      bottom_scale: bottom_scale_default(),
      auto_save: Default::default(),
      bottom_ratio: bottom_ratio_default(),
      side_ratio: side_ratio_default()
    }
  }
}

fn bottom_scale_default() -> usize {
  360
}

fn bottom_ratio_default() -> f32 {
  0.3
}

fn side_ratio_default() -> f32 {
  0.2
}

#[derive(Clone, Deserialize, Serialize, Type)]
pub struct Preset {
  pub name: String,
  pub style_id: StyleId,
  /// in percentage, 50-200
  pub speed: u32,
  // TODO: use ratio of std for pitch shift
  /// linear shift in log hz, -1-1.
  pub pitch: f32,
  pub intonation: f32,
  pub volume: f32,
  /// in seconds, 0.0-3.0, 0 is default for no slience
  pub start_slience: f32,
  /// in seconds, 0.0-3.0, 0 is default for no slience
  pub end_slience: f32,
}

impl Default for Preset {
  fn default() -> Self {
    Self {
      name: String::from("Default"),
      style_id: StyleId::new(0),
      speed: 100,
      pitch: 0.0,
      intonation: 1.0,
      volume: 1.0,
      start_slience: 0.0,
      end_slience: 0.0,
    }
  }
}

#[derive(Clone, Deserialize, Serialize, Type)]
pub struct TextBlockProps {
  pub text: String,
  pub query: Option<AudioQuery>,
  pub preset_id: Option<usize>,
}

#[derive(Clone, Deserialize, Serialize, Type, Default)]
pub struct Project {
  pub blocks: Vec<TextBlockProps>,
  pub presets: Vec<Preset>,
}
