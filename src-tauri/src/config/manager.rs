use anyhow::Result;
use std::fs::{create_dir_all, File};
use std::path::PathBuf;
use std::sync::LazyLock;

use super::AzaleaConfig;

/// Use the config directory to store the config file in release mode.
#[cfg(not(debug_assertions))]
static CONFIG_DIR: LazyLock<PathBuf> = LazyLock::new(|| {
  use dirs::config_dir;
  let mut config_dir = config_dir().unwrap();
  config_dir.push("azalea");
  config_dir
});

/// for development, use the project directory to store the config file.
#[cfg(debug_assertions)]
static CONFIG_DIR: LazyLock<PathBuf> = LazyLock::new(|| {
  let config_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  let config_dir = config_dir.parent().unwrap();
  config_dir.join("config_dev")
});

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
      create_dir_all(config_manager.config_path.parent().unwrap())?;
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
