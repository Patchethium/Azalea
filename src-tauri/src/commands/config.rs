use super::utils::{state_mut, state_ref};
use crate::config::range::{get_range as _get_range, RangeMap};
use crate::config::{AzaleaConfig, ConfigManager};
use crate::AppState;

use tauri::{Manager, State};
use voicevox_core::VoiceModelMeta;

#[derive(Clone, serde::Deserialize, serde::Serialize, specta::Type, tauri_specta::Event)]
pub struct InitializationEvent {
  pub config: Option<AzaleaConfig>,
  pub core_initialized: bool,
  pub metas: Option<VoiceModelMeta>,
  pub range: Vec<(voicevox_core::StyleId, (f32, f32))>,
  pub error: Option<String>,
}

#[derive(Clone, serde::Deserialize, serde::Serialize, specta::Type, tauri_specta::Event)]
pub struct FrontendReadyEvent;

pub async fn initialize(app: tauri::AppHandle) -> InitializationEvent {
  let state = app.state::<AppState>();
  let config_manager = match ConfigManager::new() {
    Ok(manager) => manager,
    Err(error) => return InitializationEvent {
      config: None,
      core_initialized: false,
      metas: None,
      range: _get_range().into_iter().collect(),
      error: Some(error.to_string()),
    },
  };
  let config = config_manager.config.clone();
  state.config_manager.write().unwrap().replace(config_manager);

  let error = if let Some(core_config) = config.core_config.clone() {
    super::core::initialize_core(&state, core_config)
      .await
      .err()
  } else {
    None
  };
  let core_initialized = error.is_none() && state.core.read().await.is_some();
  let metas = if core_initialized {
    state
      .core
      .read()
      .await
      .as_ref()
      .map(|core| core.metas.values().flatten().cloned().collect())
  } else {
    None
  };
  InitializationEvent {
    config: Some(config),
    core_initialized,
    metas,
    range: _get_range().into_iter().collect(),
    error,
  }
}

#[tauri::command]
#[specta::specta]
pub async fn init_config(state: State<'_, AppState>) -> std::result::Result<AzaleaConfig, String> {
  let config_manager = ConfigManager::new().map_err(|e| e.to_string())?;
  let config = config_manager.config.clone();
  state
    .config_manager
    .write()
    .unwrap()
    .replace(config_manager);
  Ok(config)
}

#[tauri::command]
#[specta::specta]
pub async fn get_config(state: State<'_, AppState>) -> std::result::Result<AzaleaConfig, String> {
  Ok(state_ref!(state, config_manager).getter().clone())
}

#[tauri::command]
#[specta::specta]
pub async fn set_config(
  state: State<'_, AppState>,
  config: AzaleaConfig,
) -> std::result::Result<(), String> {
  state_mut!(state, config_manager).setter(config);
  state_mut!(state, config_manager)
    .save()
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_range() -> std::result::Result<RangeMap, String> {
  Ok(_get_range())
}
