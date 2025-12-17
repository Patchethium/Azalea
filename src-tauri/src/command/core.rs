//! just a thin wrapper to expose Core methods as Tauri commands
use crate::app::error::AppError;
use crate::app::state::AppState;
use crate::app::state::RangeItem;

use anyhow::Result;
use specta::specta;
use tauri::command;
use tauri::State;
use voicevox_core::AccentPhrase;
use voicevox_core::AudioQuery;
use voicevox_core::CharacterMeta;
use voicevox_core::StyleId;
use AppError::*;

/*
Macro to ease my finger typing `state.lock().unwrap().core.as_{ref|mut}().ok_or(CoreNotLoadedError)?`
*/
#[macro_use]
mod gen {
  macro_rules! core_ref {
    ($state:expr) => {
      $state
        .lock()
        .unwrap()
        .core
        .as_ref()
        .ok_or(CoreNotLoadedError)?
    };
  }
  macro_rules! core_mut {
    ($state:expr) => {
      $state
        .lock()
        .unwrap()
        .core
        .as_mut()
        .ok_or(CoreNotLoadedError)?
    };
  }
}

#[specta]
#[command]
pub async fn metas(state: State<'_, AppState>) -> Result<Vec<CharacterMeta>, AppError> {
  Ok(
    core_ref!(state)
      .metas
      .values()
      .flat_map(|m| m.clone())
      .collect(),
  )
}

#[specta]
#[command]
pub async fn audio_query(
  state: State<'_, AppState>,
  text: String,
  style_id: StyleId,
) -> Result<AudioQuery, AppError> {
  core_mut!(state).load_voice_model_by_id(style_id)?;
  core_ref!(state).audio_query(&text, style_id)
}

#[specta]
#[command]
pub async fn accent_phrases(
  state: State<'_, AppState>,
  text: String,
  style_id: StyleId,
) -> Result<Vec<AccentPhrase>, AppError> {
  core_mut!(state).load_voice_model_by_id(style_id)?;
  core_ref!(state).accent_phrases(&text, style_id)
}

#[specta]
#[command]
pub async fn synthesis(
  state: State<'_, AppState>,
  query: AudioQuery,
  style_id: StyleId,
) -> Result<Vec<u8>, AppError> {
  core_mut!(state).load_voice_model_by_id(style_id)?;
  core_ref!(state).synthesis(&query, style_id)
}

#[specta]
#[command]
pub async fn optimal_pitch_range(
  state: State<'_, AppState>,
  style_id: StyleId,
  density_ratio: f32,
) -> Result<RangeItem, AppError> {
  core_mut!(state).load_voice_model_by_id(style_id)?;
  Ok(core_mut!(state).optimal_pitch_range(style_id, density_ratio))
}