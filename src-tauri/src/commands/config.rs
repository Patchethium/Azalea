use super::utils::{state_mut, state_ref};
use crate::config::{AzaleaConfig, ConfigManager};
use crate::AppState;
use crate::config::range::{get_range as _get_range, RangeMap};


use tauri::State;

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
  state_mut!(state, config_manager)
    .as_mut()
    .ok_or("Config not initialized")?
    .setter(config);
  state_mut!(state, config_manager)
    .as_mut()
    .ok_or("Config not initialized")?
    .save()
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_range() -> std::result::Result<RangeMap, String> {
  Ok(_get_range())
}
