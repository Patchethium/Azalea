use super::types::side_ratio_default;
use anyhow::Result;
use std::fs::{create_dir_all, File};
use std::path::PathBuf;
use std::sync::LazyLock;

use super::AzaleaConfig;

/// Use the config directory to store the config file in release mode.
#[cfg(not(debug_assertions))]
static CONFIG_DIR: LazyLock<PathBuf> = LazyLock::new(|| {
  use dirs::config_dir;
  let mut config_dir = config_dir().expect("System config directory is not available");
  config_dir.push("azalea");
  config_dir
});

/// for development, use the project directory to store the config file.
#[cfg(debug_assertions)]
static CONFIG_DIR: LazyLock<PathBuf> = LazyLock::new(|| {
  let config_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  let config_dir = config_dir
    .parent()
    .expect("CARGO_MANIFEST_DIR has no parent directory");
  config_dir.join("config_dev")
});

pub(crate) fn assets_dir() -> PathBuf {
  CONFIG_DIR.join("assets")
}

/// This struct serves the purpose of serializing/deserializing it to/from a file.
/// It also saves a in-memory copy of the config.
pub struct ConfigManager {
  pub config: AzaleaConfig,
  config_path: PathBuf,
}

impl Default for ConfigManager {
  fn default() -> Self {
    let config_path = CONFIG_DIR.join("config.json");
    Self {
      config: AzaleaConfig::default(),
      config_path,
    }
  }
}

impl ConfigManager {
  pub fn new() -> Result<Self> {
    let mut config_manager = Self::default();
    if config_manager.config_path.exists() {
      config_manager.load()?;
    } else {
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
    self.config = serde_json::from_str(&config)?;
    // guard out-of-range values
    // TODO: implement it in serde
    if self.config.ui_config.side_ratio < 0.0 || self.config.ui_config.side_ratio > 1.0 {
      self.config.ui_config.side_ratio = side_ratio_default();
    }
    Ok(())
  }

  pub fn save(&self) -> Result<()> {
    self.save_as(&self.config_path)
  }

  pub fn save_as(&self, path: &PathBuf) -> Result<()> {
    let config = serde_json::to_string(&self.config)?;
    std::fs::write(path, config)?;
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::config::types::{Locale, ThemeMode};

  #[test]
  fn save_and_load_as_round_trip_all_settings() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("config.json");
    let mut source = ConfigManager::default();
    source.config.ui_config.locale = Locale::Ja;
    source.config.ui_config.theme_mode = ThemeMode::Dark;
    source.config.ui_config.primary_color = "#123456".into();
    source.config.ui_config.spectrogram_preview = false;

    source.save_as(&path).unwrap();
    let mut loaded = ConfigManager::default();
    loaded.load_as(&path).unwrap();

    assert!(matches!(loaded.config.ui_config.locale, Locale::Ja));
    assert!(matches!(
      loaded.config.ui_config.theme_mode,
      ThemeMode::Dark
    ));
    assert_eq!(loaded.config.ui_config.primary_color, "#123456");
    assert!(!loaded.config.ui_config.spectrogram_preview);
  }

  #[test]
  fn load_repairs_non_finite_side_panel_ranges() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("config.json");
    std::fs::write(
      &path,
      r#"{"core_config":null,"ui_config":{"side_ratio":4},"system_presets":[]}"#,
    )
    .unwrap();
    let mut manager = ConfigManager::default();

    manager.load_as(&path).unwrap();

    assert_eq!(manager.config.ui_config.side_ratio, side_ratio_default());
  }

  #[test]
  fn malformed_or_missing_files_return_errors_without_replacing_memory() {
    let directory = tempfile::tempdir().unwrap();
    let malformed = directory.path().join("malformed.json");
    std::fs::write(&malformed, "{").unwrap();
    let missing = directory.path().join("missing.json");
    let mut manager = ConfigManager::default();
    manager.config.ui_config.primary_color = "#abcdef".into();

    assert!(manager.load_as(&malformed).is_err());
    assert_eq!(manager.config.ui_config.primary_color, "#abcdef");
    assert!(manager.load_as(&missing).is_err());
  }
}
