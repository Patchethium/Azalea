use crate::app::core::CoreConfig;

use super::core::Core;
use super::error::AppError;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{collections::HashMap, fmt::Debug, path::PathBuf};
use voicevox_core::StyleId;
use AppError::*;

#[derive(Default)]
pub struct AppStateInner {
  pub core: Option<Core>,
}

pub type AppState = std::sync::Mutex<AppStateInner>;

#[derive(Type, Clone, Serialize, Deserialize)]
pub struct UiConfig {
  // later
}

impl Default for UiConfig {
  fn default() -> Self {
    UiConfig {
      // later
    }
  }
}

#[derive(Default, Type, Clone, Serialize, Deserialize)]
pub struct AppConfig {
  pub core: Option<CoreConfig>, // nullable for first launch
  pub ui: UiConfig,
}

impl AppConfig {
  /// Get default config path according to OS.
  /// Debug build uses {CARGO_MANIFEST_DIR}/config_dev/config.toml
  #[cfg(debug_assertions)]
  pub fn default_path() -> Result<PathBuf, AppError> {
    let cargo_manifest_dir =
      std::env::var("CARGO_MANIFEST_DIR").map_err(|_| OsConfigDirNotFoundError)?;
    let mut config_path = PathBuf::from(cargo_manifest_dir);
    config_path.pop();
    config_path.push("config_dev");
    config_path.push("config.toml");
    Ok(config_path)
  }

  /// Get default config path according to OS.
  /// Release build uses {OS config directory}/azalea/config.toml
  #[cfg(not(debug_assertions))]
  pub fn default_path() -> Result<PathBuf, AppError> {
    use dirs;
    let mut config_dir = dirs::config_dir().ok_or(OsConfigDirNotFoundError)?;
    config_dir.push("azalea");
    config_dir.push("config.toml");
    Ok(config_dir)
  }

  /// Read config from given path, or default path if None.
  pub fn read(cfg_path: Option<PathBuf>) -> Result<AppConfig, AppError> {
    let cfg_path = match cfg_path {
      Some(p) => p,
      None => AppConfig::default_path()?,
    };
    let cfg_str = std::fs::read_to_string(cfg_path).map_err(|_| ConfigReadError)?;
    toml::from_str(&cfg_str).map_err(|_| ConfigDeserializeError)
  }

  /// Write config to given path, or default path if None.
  /// If default path is used, create parent directories if not exists.
  pub fn write(&self, cfg_path: Option<PathBuf>) -> Result<(), AppError> {
    let cfg_path = match cfg_path {
      Some(p) => p,
      None => {
        // create parent dir if not exists
        let path = AppConfig::default_path()?;
        if let Some(parent) = path.parent() {
          if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|_| ConfigWriteError)?;
          }
        }
        path
      }
    };
    let cfg_str = toml::to_string_pretty(self).map_err(|_| ConfigSerializeError)?;
    std::fs::write(cfg_path, cfg_str).map_err(|_| ConfigWriteError)
  }
}

#[derive(Type, Clone, Serialize, Deserialize)]
pub enum RangeItem {
  Normal(f32, f32),
  Whisper,
}

impl Debug for RangeItem {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      RangeItem::Normal(min, max) => write!(f, "RangeItem: (min: {}, max: {})", min, max),
      RangeItem::Whisper => write!(f, "Whisper"),
    }
  }
}

pub type RangeMap = HashMap<StyleId, RangeItem>;

impl AppStateInner {
  pub fn load_core(&mut self, cfg: &CoreConfig) -> Result<(), AppError> {
    self.core.replace(Core::new(cfg)?);
    Ok(())
  }
}

const RANGE_TOML: &str = include_str!("../assets/range.toml");
pub fn get_range() -> Result<RangeMap, AppError> {
  toml::from_str(RANGE_TOML).map_err(|_| RangeDeserializeError)
}
