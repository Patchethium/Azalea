use super::utils::{state_mut, state_ref};
use crate::config::range::{get_range as _get_range, PitchRange, RangeMap};
use crate::config::{AzaleaConfig, ConfigManager};
use crate::AppState;

use tauri::{Manager, State};
use voicevox_core::VoiceModelMeta;

#[derive(Clone, serde::Deserialize, serde::Serialize, specta::Type, tauri_specta::Event)]
pub struct InitializationEvent {
  pub config: Option<AzaleaConfig>,
  pub core_initialized: bool,
  pub metas: Option<VoiceModelMeta>,
  pub range: Vec<(voicevox_core::StyleId, PitchRange)>,
  pub error: Option<String>,
  #[serde(default)]
  pub resolved_core: Option<crate::config::CoreConfig>,
  #[serde(default)]
  pub active_setup_source: Option<crate::config::types::SetupSource>,
}

#[derive(Clone, serde::Deserialize, serde::Serialize, specta::Type, tauri_specta::Event)]
pub struct FrontendReadyEvent;

pub async fn initialize(app: tauri::AppHandle) -> InitializationEvent {
  let state = app.state::<AppState>();
  let config_manager = match ConfigManager::new() {
    Ok(manager) => manager,
    Err(error) => {
      return InitializationEvent {
        config: None,
        core_initialized: false,
        metas: None,
        range: _get_range().into_iter().collect(),
        error: Some(error.to_string()),
        resolved_core: None,
        active_setup_source: None,
      }
    }
  };
  let config = config_manager.config.clone();
  state
    .config_manager
    .write()
    .unwrap()
    .replace(config_manager);

  let config_copy = config.clone();
  let resolved =
    tauri::async_runtime::spawn_blocking(move || super::downloads::resolve_setup(&config_copy))
      .await
      .map_err(|e| e.to_string())
      .and_then(|result| result);
  let resolved_core = resolved.as_ref().ok().cloned().flatten();
  let error = if let Err(error) = resolved {
    Some(error)
  } else if let Some(core_config) = resolved_core.clone() {
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
  let active_setup_source = state
    .core
    .read()
    .await
    .as_ref()
    .map(|core| core.config.setup_source);
  InitializationEvent {
    active_setup_source,
    config: Some(config),
    core_initialized,
    metas,
    range: _get_range().into_iter().collect(),
    error,
    resolved_core,
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

#[tauri::command]
#[specta::specta]
#[allow(deprecated)]
pub async fn open_config_dir() -> std::result::Result<(), String> {
  tauri_plugin_shell::open::open(
    None,
    crate::config::manager::config_dir()
      .to_string_lossy()
      .to_string(),
    None,
  )
  .map_err(|error| error.to_string())
}
