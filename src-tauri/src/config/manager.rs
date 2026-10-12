use super::types::{portrait_ratio_default, side_width_default, Locale};
use anyhow::Result;
use std::fs::{create_dir_all, File};
use std::path::PathBuf;
use std::sync::OnceLock;

use super::AzaleaConfig;

/// Resolved base directory for the config file, assets and user dictionary.
static CONFIG_DIR: OnceLock<PathBuf> = OnceLock::new();
static BUNDLE_IDENTIFIER: OnceLock<String> = OnceLock::new();

/// Base directory for the config file, assets and user dictionary.
///
/// During development this is the repository's `config_dev` directory. Release
/// builds resolve it to `{config_dir}/{bundle_identifier}` and must be
/// initialized with [`init_config_dir`] during startup.
pub(crate) fn config_dir() -> &'static PathBuf {
  CONFIG_DIR.get_or_init(|| {
    #[cfg(debug_assertions)]
    {
      PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("CARGO_MANIFEST_DIR has no parent directory")
        .join("config_dev")
    }
    #[cfg(not(debug_assertions))]
    {
      panic!("Config directory was not initialized from the bundle identifier")
    }
  })
}

/// Builds the release config directory `{config_dir}/{bundle_identifier}`.
#[cfg_attr(debug_assertions, allow(dead_code))]
fn app_config_dir(identifier: &str) -> PathBuf {
  let mut config_dir = dirs::config_dir().expect("System config directory is not available");
  config_dir.push(identifier);
  config_dir
}

/// Records the bundle identifier declared in `tauri.conf.json` so release
/// builds store their config under `{config_dir}/{identifier}`.
pub(crate) fn init_config_dir(identifier: &str) {
  let _ = BUNDLE_IDENTIFIER.set(identifier.to_owned());
  #[cfg(not(debug_assertions))]
  {
    let _ = CONFIG_DIR.set(app_config_dir(identifier));
  }
  #[cfg(debug_assertions)]
  {
    let _ = identifier;
  }
}

pub(crate) fn downloaded_components_dir() -> Result<PathBuf, String> {
  if cfg!(debug_assertions) {
    return Ok(config_dir().join("voicevox"));
  }
  local_components_dir(
    dirs::data_local_dir(),
    BUNDLE_IDENTIFIER
      .get()
      .map(String::as_str)
      .unwrap_or("com.azalea.app"),
  )
}

fn local_components_dir(base: Option<PathBuf>, identifier: &str) -> Result<PathBuf, String> {
  base
    .map(|base| base.join(identifier).join("voicevox"))
    .ok_or_else(|| "The local data directory is unavailable".into())
}

pub(crate) fn assets_dir() -> PathBuf {
  config_dir().join("assets")
}

pub(crate) fn user_dictionary_path() -> PathBuf {
  config_dir().join("user_dictionary.json")
}

/// This struct serves the purpose of serializing/deserializing it to/from a file.
/// It also saves a in-memory copy of the config.
pub struct ConfigManager {
  pub config: AzaleaConfig,
  config_path: PathBuf,
  /// The system language tag when the config was first created with an
  /// unsupported system language and fell back to English.
  pub unsupported_system_locale: Option<String>,
}

impl Default for ConfigManager {
  fn default() -> Self {
    Self {
      config: AzaleaConfig::default(),
      config_path: config_dir().join("config.toml"),
      unsupported_system_locale: None,
    }
  }
}

impl ConfigManager {
  pub fn new() -> Result<Self> {
    Self::open(config_dir().join("config.toml"), sys_locale::get_locale)
  }

  /// Loads the config at `config_path`, or creates it on first launch with
  /// the UI locale taken from `system_locale`.
  fn open(config_path: PathBuf, system_locale: impl FnOnce() -> Option<String>) -> Result<Self> {
    let mut config_manager = Self {
      config: AzaleaConfig::default(),
      config_path,
      unsupported_system_locale: None,
    };
    if config_manager.config_path.exists() {
      config_manager.load()?;
    } else {
      if let Some(tag) = system_locale() {
        match Locale::from_language_tag(&tag) {
          Some(locale) => config_manager.config.ui.locale = locale,
          None => config_manager.unsupported_system_locale = Some(tag),
        }
      }
      create_dir_all(
        config_manager
          .config_path
          .parent()
          .expect("Config path has no parent directory"),
      )?;
      File::create(&config_manager.config_path)?;
      config_manager.save()?;
    }
    Ok(config_manager)
  }

  pub fn getter(&self) -> &AzaleaConfig {
    &self.config
  }

  pub fn setter(&mut self, config: AzaleaConfig) {
    self.config = config;
  }

  pub fn load(&mut self) -> Result<()> {
    let config_path = self.config_path.clone(); // workaround for borrow checker
    self.load_as(&config_path)
  }

  pub fn load_as(&mut self, path: &PathBuf) -> Result<()> {
    let config = std::fs::read_to_string(path)?;
    self.config = toml::from_str(&config)?;
    // guard out-of-range values
    // TODO: implement it in serde
    if self.config.ui.side_width != 0 && self.config.ui.side_width < 200 {
      self.config.ui.side_width = side_width_default();
    }
    if !(0.0..=1.0).contains(&self.config.ui.portrait_ratio) {
      self.config.ui.portrait_ratio = portrait_ratio_default();
    }
    Ok(())
  }

  pub fn save(&self) -> Result<()> {
    self.save_as(&self.config_path)
  }

  pub fn save_as(&self, path: &PathBuf) -> Result<()> {
    let config = toml::to_string_pretty(&self.config)?;
    std::fs::write(path, config)?;
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::config::types::{PitchScale, ThemeMode, TitlebarStyle};

  #[test]
  fn release_downloaded_components_use_local_data_and_report_missing_base() {
    let directory = tempfile::tempdir().unwrap();
    assert_eq!(
      local_components_dir(Some(directory.path().to_owned()), "com.azalea.app").unwrap(),
      directory.path().join("com.azalea.app/voicevox")
    );
    assert!(local_components_dir(None, "com.azalea.app").is_err());
  }

  #[cfg(debug_assertions)]
  #[test]
  fn development_downloaded_components_are_isolated_from_release_data() {
    let development_root = downloaded_components_dir().unwrap();
    assert_eq!(
      development_root,
      PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("config_dev/voicevox")
    );
  }

  #[test]
  fn app_config_dir_appends_bundle_identifier() {
    let Some(base) = dirs::config_dir() else {
      return;
    };
    assert_eq!(
      app_config_dir("com.azalea.app"),
      base.join("com.azalea.app")
    );
  }

  #[test]
  fn save_and_load_as_round_trip_all_settings() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("config.toml");
    let mut source = ConfigManager::default();
    source.config.ui.locale = Locale::Ja;
    source.config.ui.theme_mode = ThemeMode::Dark;
    source.config.ui.embedded_font = true;
    source.config.ui.titlebar_style = TitlebarStyle::Hidden;
    source.config.ui.primary_color = "#123456".into();
    source.config.ui.nonblocking_synthesis = true;
    source.config.ui.pitch_noise_enabled = true;
    source.config.ui.pitch_completion_enabled = true;
    source.config.ui.pitch_completion_locked = true;
    source.config.ui.shortcuts.toggle_pitch_completion.key = "K".into();
    source.config.ui.pitch_noise_sigma = 0.08;
    source.config.ui.spectrogram_preview = false;
    source.config.ui.playback_timeline = false;
    source.config.ui.pitch_scale = PitchScale::DensityAware;
    source.config.setup_source = crate::config::types::SetupSource::Downloaded;
    source.config.downloaded_setup.cpu_num_threads = 4;
    source.config.ui.pitch_ruler = false;

    source.save_as(&path).unwrap();
    let mut loaded = ConfigManager::default();
    loaded.load_as(&path).unwrap();

    assert!(matches!(loaded.config.ui.locale, Locale::Ja));
    assert!(matches!(loaded.config.ui.theme_mode, ThemeMode::Dark));
    assert!(loaded.config.ui.embedded_font);
    assert!(matches!(
      loaded.config.ui.titlebar_style,
      TitlebarStyle::Hidden
    ));
    assert_eq!(loaded.config.ui.primary_color, "#123456");
    assert!(loaded.config.ui.nonblocking_synthesis);
    assert!(loaded.config.ui.pitch_noise_enabled);
    assert!(loaded.config.ui.pitch_completion_enabled);
    assert!(loaded.config.ui.pitch_completion_locked);
    assert_eq!(loaded.config.ui.shortcuts.toggle_pitch_completion.key, "K");
    assert_eq!(loaded.config.ui.pitch_noise_sigma, 0.08);
    assert!(!loaded.config.ui.spectrogram_preview);
    assert!(!loaded.config.ui.playback_timeline);
    assert!(matches!(
      loaded.config.ui.pitch_scale,
      PitchScale::DensityAware
    ));
    assert!(!loaded.config.ui.pitch_ruler);
    assert_eq!(
      loaded.config.setup_source,
      crate::config::types::SetupSource::Downloaded
    );
    assert_eq!(loaded.config.downloaded_setup.cpu_num_threads, 4);
  }

  #[test]
  fn load_preserves_collapsed_and_repairs_invalid_portrait_ratio() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("config.toml");
    let mut manager = ConfigManager::default();
    for (stored, expected) in [
      ("0.0", 0.0),
      ("0.4", 0.4),
      ("nan", 0.25),
      ("1.5", 0.25),
      ("-0.1", 0.25),
    ] {
      std::fs::write(&path, format!("[ui]\nportrait_ratio = {stored}\n")).unwrap();
      manager.load_as(&path).unwrap();
      assert_eq!(manager.config.ui.portrait_ratio, expected, "{stored}");
    }
  }

  #[test]
  fn load_preserves_collapsed_and_repairs_invalid_side_panel_width() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("config.toml");
    std::fs::write(&path, "[ui]\nside_width = 0\n").unwrap();
    let mut manager = ConfigManager::default();

    manager.load_as(&path).unwrap();

    assert_eq!(manager.config.ui.side_width, 0);

    std::fs::write(&path, "[ui]\nside_width = 175\n").unwrap();

    manager.load_as(&path).unwrap();

    assert_eq!(manager.config.ui.side_width, side_width_default());
  }

  #[test]
  fn malformed_or_missing_files_return_errors_without_replacing_memory() {
    let directory = tempfile::tempdir().unwrap();
    let malformed = directory.path().join("malformed.toml");
    std::fs::write(&malformed, "{").unwrap();
    let missing = directory.path().join("missing.toml");
    let mut manager = ConfigManager::default();
    manager.config.ui.primary_color = "#abcdef".into();

    assert!(manager.load_as(&malformed).is_err());
    assert_eq!(manager.config.ui.primary_color, "#abcdef");
    assert!(manager.load_as(&missing).is_err());
  }

  #[test]
  fn first_launch_uses_supported_system_locale() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("nested/config.toml");

    let manager = ConfigManager::open(path.clone(), || Some("ja-JP".into())).unwrap();

    assert!(matches!(manager.config.ui.locale, Locale::Ja));
    assert!(manager.unsupported_system_locale.is_none());
    let mut saved = ConfigManager::default();
    saved.load_as(&path).unwrap();
    assert!(matches!(saved.config.ui.locale, Locale::Ja));
  }

  #[test]
  fn first_launch_falls_back_to_english_for_unsupported_system_locale() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("config.toml");

    let manager = ConfigManager::open(path.clone(), || Some("fr-FR".into())).unwrap();

    assert!(matches!(manager.config.ui.locale, Locale::En));
    assert_eq!(manager.unsupported_system_locale.as_deref(), Some("fr-FR"));
    let mut saved = ConfigManager::default();
    saved.load_as(&path).unwrap();
    assert!(matches!(saved.config.ui.locale, Locale::En));
  }

  #[test]
  fn first_launch_without_system_locale_uses_english_silently() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("config.toml");

    let manager = ConfigManager::open(path, || None).unwrap();

    assert!(matches!(manager.config.ui.locale, Locale::En));
    assert!(manager.unsupported_system_locale.is_none());
  }

  #[test]
  fn existing_config_ignores_system_locale() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("config.toml");
    std::fs::write(&path, "[ui]\nlocale = \"En\"\n").unwrap();

    let manager = ConfigManager::open(path, || {
      panic!("the system locale must only be read on first launch")
    })
    .unwrap();

    assert!(matches!(manager.config.ui.locale, Locale::En));
    assert!(manager.unsupported_system_locale.is_none());
  }
}
