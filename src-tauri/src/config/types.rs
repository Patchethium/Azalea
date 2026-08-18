use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;

use voicevox_core::{AudioQuery, StyleId};

#[derive(Default, Clone, Deserialize, Serialize, Type)]
pub struct AzaleaConfig {
  pub core: Option<CoreConfig>,
  pub ui: UIConfig,
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
  pub ort_path: PathBuf,
  pub ojt_dir: PathBuf,
  pub vvm_dir: PathBuf,
  #[serde(default = "cache_size_default")]
  pub cache_size: usize,
  #[serde(default = "cpu_num_threads_default")]
  pub cpu_num_threads: u16,
}

pub fn cache_size_default() -> usize {
  128
}

/// Number of CPU threads VOICEVOX Core may use. 0 lets the runtime choose automatically.
pub fn cpu_num_threads_default() -> u16 {
  0
}

#[derive(Clone, Deserialize, Serialize, Type)]
pub enum Locale {
  Ja,
  En,
  ZhCn,
}

impl Default for Locale {
  fn default() -> Self {
    Locale::En
  }
}

#[derive(Clone, Default, Deserialize, Serialize, Type)]
pub enum ThemeMode {
  #[default]
  System,
  Light,
  Dark,
}

#[derive(Clone, Deserialize, Serialize, Type)]
pub struct UIConfig {
  #[serde(default)]
  pub locale: Locale,
  #[serde(default)]
  pub theme_mode: ThemeMode,
  #[serde(default = "custom_titlebar_default")]
  pub custom_titlebar: bool,
  #[serde(default = "primary_color_default")]
  pub primary_color: String,
  #[serde(default = "bottom_scale_default")]
  pub bottom_scale: usize,
  #[serde(default)]
  pub auto_save: bool,
  #[serde(default = "bottom_ratio_default")]
  pub bottom_ratio: f32,
  #[serde(default = "side_width_default")]
  pub side_width: u32,
  #[serde(default = "buffer_render_default")]
  pub buffer_render: bool,
  #[serde(default)]
  pub nonblocking_synthesis: bool,
  #[serde(default = "synthesis_delay_ms_default")]
  pub synthesis_delay_ms: u32,
  #[serde(default = "spectrogram_preview_default")]
  pub spectrogram_preview: bool,
  #[serde(default = "playback_timeline_default")]
  pub playback_timeline: bool,
  #[serde(default = "name_truncation_len_default")]
  pub name_truncation_len: usize,
  #[serde(default)]
  pub last_exported_dir: Option<String>,
  #[serde(default)]
  pub shortcuts: KeyboardShortcuts,
}

impl Default for UIConfig {
  fn default() -> Self {
    Self {
      locale: Default::default(),
      theme_mode: Default::default(),
      custom_titlebar: custom_titlebar_default(),
      primary_color: primary_color_default(),
      bottom_scale: bottom_scale_default(),
      auto_save: Default::default(),
      bottom_ratio: bottom_ratio_default(),
      side_width: side_width_default(),
      buffer_render: buffer_render_default(),
      nonblocking_synthesis: false,
      synthesis_delay_ms: synthesis_delay_ms_default(),
      spectrogram_preview: spectrogram_preview_default(),
      playback_timeline: playback_timeline_default(),
      name_truncation_len: name_truncation_len_default(),
      last_exported_dir: None,
      shortcuts: Default::default(),
    }
  }
}

fn custom_titlebar_default() -> bool {
  true
}

fn primary_color_default() -> String {
  "#3b82f6".to_string()
}

fn bottom_scale_default() -> usize {
  360
}

fn bottom_ratio_default() -> f32 {
  0.3
}

pub(super) fn side_width_default() -> u32 {
  200
}

fn buffer_render_default() -> bool {
  false
}

fn synthesis_delay_ms_default() -> u32 {
  600
}

fn spectrogram_preview_default() -> bool {
  true
}

fn playback_timeline_default() -> bool {
  true
}

fn name_truncation_len_default() -> usize {
  0
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct KeyboardShortcut {
  pub key: String,
  #[serde(default)]
  pub primary: bool,
  #[serde(default)]
  pub secondary: bool,
  #[serde(default)]
  pub shift: bool,
  #[serde(default)]
  pub alt: bool,
}

impl KeyboardShortcut {
  fn new(key: &str, primary: bool, shift: bool) -> Self {
    Self {
      key: key.to_string(),
      primary,
      secondary: false,
      shift,
      alt: false,
    }
  }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct KeyboardShortcuts {
  #[serde(default = "save_project_shortcut_default")]
  pub save_project: KeyboardShortcut,
  #[serde(default = "toggle_playback_shortcut_default")]
  pub toggle_playback: KeyboardShortcut,
  #[serde(default = "play_current_shortcut_default")]
  pub play_current: KeyboardShortcut,
  #[serde(default = "play_next_shortcut_default")]
  pub play_next: KeyboardShortcut,
}

impl Default for KeyboardShortcuts {
  fn default() -> Self {
    Self {
      save_project: save_project_shortcut_default(),
      toggle_playback: toggle_playback_shortcut_default(),
      play_current: play_current_shortcut_default(),
      play_next: play_next_shortcut_default(),
    }
  }
}

fn save_project_shortcut_default() -> KeyboardShortcut {
  KeyboardShortcut::new("S", true, false)
}

fn toggle_playback_shortcut_default() -> KeyboardShortcut {
  KeyboardShortcut::new("Space", false, false)
}

fn play_current_shortcut_default() -> KeyboardShortcut {
  KeyboardShortcut::new("Enter", true, false)
}

fn play_next_shortcut_default() -> KeyboardShortcut {
  KeyboardShortcut::new("Enter", false, true)
}

#[derive(Clone, Deserialize, Serialize, Type)]
pub struct Preset {
  #[serde(default)]
  pub id: String,
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
  #[serde(default)]
  pub speaker_uuid: Option<String>,
  #[serde(default)]
  pub style_name: Option<String>,
}

impl Default for Preset {
  fn default() -> Self {
    Self {
      id: String::new(),
      name: String::from("Default"),
      style_id: StyleId::new(0),
      speed: 100,
      pitch: 0.0,
      intonation: 1.0,
      volume: 1.0,
      start_slience: 0.0,
      end_slience: 0.0,
      speaker_uuid: None,
      style_name: None,
    }
  }
}

#[derive(Clone, Deserialize, Serialize, Type)]
pub struct TextBlockProps {
  pub id: String,
  pub text: String,
  pub query: Option<AudioQuery>,
  pub query_is_modified: bool,
  pub preset_id: Option<String>,
}

#[derive(Clone, Deserialize, Serialize, Type, Default)]
pub struct Project {
  pub blocks: Vec<TextBlockProps>,
  pub presets: Vec<Preset>,
}

#[cfg(test)]
mod tests {
  use super::{
    cache_size_default, cpu_num_threads_default, AzaleaConfig, KeyboardShortcut, UIConfig,
  };

  #[test]
  fn missing_settings_use_defaults() {
    let config: UIConfig = toml::from_str("").unwrap();
    assert_eq!(config.synthesis_delay_ms, 600);
    assert!(!config.nonblocking_synthesis);
    assert!(config.custom_titlebar);
    assert_eq!(
      config.shortcuts.toggle_playback,
      KeyboardShortcut::new("Space", false, false)
    );
    assert_eq!(
      config.shortcuts.play_next,
      KeyboardShortcut::new("Enter", false, true)
    );
  }

  #[test]
  fn missing_shortcut_action_uses_default() {
    let config: UIConfig = toml::from_str(
      r#"
        [shortcuts.save_project]
        key = "P"
        alt = true

        [shortcuts.stop_playback]
        key = "Space"
        primary = true
      "#,
    )
    .unwrap();
    assert_eq!(
      config.shortcuts.save_project,
      KeyboardShortcut {
        key: "P".to_string(),
        primary: false,
        secondary: false,
        shift: false,
        alt: true,
      }
    );
    assert_eq!(
      config.shortcuts.toggle_playback,
      KeyboardShortcut::new("Space", false, false)
    );
    let serialized = toml::Value::try_from(config).unwrap();
    assert!(serialized["shortcuts"].get("stop_playback").is_none());
  }

  #[test]
  fn empty_application_config_has_a_default_preset_and_preview() {
    let config: AzaleaConfig = toml::from_str("[ui]\n").unwrap();

    assert_eq!(config.system_presets.len(), 1);
    assert_eq!(config.system_presets[0].name, "Default");
    assert!(config.ui.spectrogram_preview);
    assert!(config.ui.playback_timeline);
    assert!(config.ui.custom_titlebar);
    assert_eq!(config.ui.primary_color, "#3b82f6");
    assert_eq!(config.ui.bottom_ratio, 0.3);
    assert_eq!(config.ui.side_width, 200);
  }

  #[test]
  fn missing_core_settings_use_defaults() {
    let config: AzaleaConfig = toml::from_str(
      r#"
        [ui]

        [core]
        ort_path = "/runtime"
        ojt_dir = "/dictionary"
        vvm_dir = "/models"
      "#,
    )
    .unwrap();

    let core = config.core.unwrap();
    assert_eq!(core.cache_size, cache_size_default());
    assert_eq!(core.cpu_num_threads, cpu_num_threads_default());
  }

  #[test]
  fn shortcut_round_trip_preserves_all_platform_modifiers() {
    let input = r#"
      [shortcuts.save_project]
      key = "P"
      primary = true
      secondary = true
      shift = true
      alt = true

      [shortcuts.toggle_playback]
      key = "P"
      alt = true
    "#;
    let config: UIConfig = toml::from_str(input).unwrap();
    let serialized = toml::to_string(&config).unwrap();
    let restored: UIConfig = toml::from_str(&serialized).unwrap();

    assert_eq!(
      restored.shortcuts.save_project,
      config.shortcuts.save_project
    );
    assert_eq!(
      restored.shortcuts.toggle_playback,
      config.shortcuts.toggle_playback
    );
  }
}
