//! app related commands (config, state, etc.)
use crate::app::core::{Core, CoreConfig};
use crate::app::error::AppError;
use crate::app::state::{AppConfig, AppState, AppStateInner, RangeMap};

use specta::specta;
use tauri::command;

#[specta]
#[command]
pub fn load_config() -> Result<AppConfig, AppError> {
  AppConfig::read(None)
}

#[specta]
#[command]
pub fn save_config(cfg: AppConfig) -> Result<(), AppError> {
  cfg.write(None)
}

#[specta]
#[command]
pub fn load_core(state: tauri::State<'_, AppState>, cfg: CoreConfig) -> Result<(), AppError> {
  state.lock().unwrap().load_core(&cfg)
}

#[specta]
#[command]
pub fn range() -> Result<RangeMap, AppError> {
  crate::app::state::get_range()
}