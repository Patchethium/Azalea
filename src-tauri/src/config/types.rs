use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;

use crate::voicevox_sys::metas::StyleId;

#[derive(Default, Clone, Deserialize, Serialize, Type)]
pub struct AzaleaConfig {
  pub core_config: CoreConfig,
  pub ui_config: UIConfig,
  pub presets: Vec<Preset>,
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
}

impl Default for UIConfig {
  fn default() -> Self {
    Self {
      locale: Locale::default(),
      bottom_scale: bottom_scale_default(),
    }
  }
}

fn bottom_scale_default() -> usize {
  360
}

#[derive(Clone, Deserialize, Serialize, Type)]
pub struct Preset {
  pub name: String,
  pub style_id: StyleId,
  /// in percentage, 50-200
  pub speed: u32,
  // At C=440Hz, one semi-tone is approximately 26.16 Hz,
  // after log scale it comes to 0.21, and 1.5 is about 1 octave.
  // Don't need to be too precise, it's TTS, not SVS.
  /// linear shift in log hz, -1.5-1.5.
  pub pitch: f32,
  /// if pause scale is applied. if not, it will follow the `speed` value.
  pub pause_scale_enabled: bool,
  /// 50-200, 100 is default for no change
  pub pause_scale: u32,
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
      pause_scale_enabled: false,
      pause_scale: 100,
      start_slience: 0.0,
      end_slience: 0.0,
    }
  }
}