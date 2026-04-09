use super::utils::{state_async_mut, state_async_ref, state_mut};
use crate::config::CoreConfig;
use crate::{audio::AudioPlayer, core::Core};
use crate::{AppState, WavLruType};

use std::num::NonZeroUsize;
use std::sync::Arc;

use ndarray::Array1;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::OnceCell;
use voicevox_core::{AccentPhrase, AudioQuery, StyleId, VoiceModelMeta};

/// Load the voicevox core and create lru cache
#[tauri::command]
#[specta::specta]
pub async fn init_core(
  state: State<'_, AppState>,
  config: CoreConfig,
) -> std::result::Result<(), String> {
  if state.core.read().await.is_none() {
    let core = Core::init(&config).map_err(|e| e.to_string())?;
    state.core.write().await.replace(core);
  } else {
    return Err("Core already loaded".into());
  }
  // initialize LRU caches for waveforms
  if state.wav_lru.read().await.is_none() {
    if config.cache_size != 0 {
      let lru = lru::LruCache::new(NonZeroUsize::new(config.cache_size).unwrap());
      state.wav_lru.write().await.replace(lru);
    }
  } else {
    return Err("LRU cache already initialized".into());
  }
  if state.query_lru.read().unwrap().is_none() {
    if config.cache_size != 0 {
      let lru = lru::LruCache::new(NonZeroUsize::new(config.cache_size).unwrap());
      state.query_lru.write().unwrap().replace(lru);
    }
  } else {
    return Err("LRU cache already initialized".into());
  }
  Ok(())
}

/// Gets metas from voicevox core
#[tauri::command]
#[specta::specta]
pub async fn get_metas(state: State<'_, AppState>) -> std::result::Result<VoiceModelMeta, String> {
  let metas = state_async_ref!(state, core).metas.clone();
  Ok(metas.values().flatten().cloned().collect())
}

/// Encodes text into audio query
#[tauri::command]
#[specta::specta]
pub async fn audio_query(
  state: State<'_, AppState>,
  text: String,
  speaker_id: StyleId,
) -> std::result::Result<AudioQuery, String> {
  if let Some(cache) = state_mut!(state, query_lru).get(&(text.clone(), speaker_id)) {
    return Ok(cache.clone());
  }
  let query = state_async_ref!(state, core)
    .audio_query(&text, speaker_id)
    .map_err(|e| e.to_string())?;
  state_mut!(state, query_lru).put((text.clone(), speaker_id), query.clone());
  Ok(query)
}

/// Encodes text into accent phrases
#[tauri::command]
#[specta::specta]
pub async fn accent_phrases(
  state: State<'_, AppState>,
  text: String,
  speaker_id: StyleId,
) -> std::result::Result<Vec<AccentPhrase>, String> {
  state_async_ref!(state, core)
    .accent_phrases(&text, speaker_id)
    .map_err(|e| e.to_string())
}

/// Replace mora data (pitch and duration) in accent phrases
#[tauri::command]
#[specta::specta]
pub async fn replace_mora(
  state: State<'_, AppState>,
  ap: Vec<AccentPhrase>,
  style_id: StyleId,
) -> std::result::Result<Vec<AccentPhrase>, String> {
  state_async_ref!(state, core)
    .replace_mora(ap, style_id)
    .map_err(|e| e.to_string())
}

/// Replace pitch in accent phrases
#[tauri::command]
#[specta::specta]
pub async fn replace_mora_pitch(
  state: State<'_, AppState>,
  ap: Vec<AccentPhrase>,
  style_id: StyleId,
) -> std::result::Result<Vec<AccentPhrase>, String> {
  state_async_ref!(state, core)
    .replace_mora_pitch(ap, style_id)
    .map_err(|e| e.to_string())
}

/// Replace duration in accent phrases
#[tauri::command]
#[specta::specta]
pub async fn replace_mora_duration(
  state: State<'_, AppState>,
  ap: Vec<AccentPhrase>,
  style_id: StyleId,
) -> std::result::Result<Vec<AccentPhrase>, String> {
  state_async_ref!(state, core)
    .replace_mora_duration(ap, style_id)
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
/// Synthesizes audio from audio query and put it into cache.
///
/// It doesn't guarantee the cached waveform is always there,
/// so the edge guard is still needed when retrieving from cache.
///
/// It's used in buffering audio generation in the background to reduce latency,
/// also needs to be async so that it can be invoked in the background.
///
/// TODO: invoke an event when wavform is dropped from cache so that frontend can be notified
/// or find another way to guarantee the viability of the cached waveforms.
pub async fn synthesize(
  state: State<'_, AppState>,
  audio_query: AudioQuery,
  speaker_id: StyleId,
) -> std::result::Result<(), String> {
  let _ = _synthesize(
    state_async_mut!(state, wav_lru),
    state_async_ref!(state, core),
    audio_query,
    speaker_id,
  )
  .await?;
  Ok(())
}

/// Decode audio query to waveform.
/// FIXME: `clone` is abused, optimize it.
pub async fn _synthesize(
  cache: &mut WavLruType,
  wrapper: &Core,
  audio_query: AudioQuery,
  speaker_id: StyleId,
) -> std::result::Result<Vec<u8>, String> {
  let query_string = serde_json::to_string(&audio_query).map_err(|e| e.to_string())?;
  let cell = cache
    .get_or_insert((query_string, speaker_id), || Arc::new(OnceCell::new()))
    .clone();
  let wav = cell
    .get_or_try_init(|| async {
      wrapper
        .synthesis(&audio_query, speaker_id)
        .map_err(|e| e.to_string())
    })
    .await?;
  Ok(wav.clone())
}

#[tauri::command]
#[specta::specta]
pub async fn play_audio(
  state: State<'_, AppState>,
  audio_query: AudioQuery,
  speaker_id: StyleId,
) -> std::result::Result<(), String> {
  let wav = _synthesize(
    state_async_mut!(state, wav_lru),
    state_async_ref!(state, core),
    audio_query,
    speaker_id,
  )
  .await?;
  let audio_player = AudioPlayer::play(wav.clone());
  state.audio_player.write().unwrap().replace(audio_player);
  Ok(())
}

/// Save the audio waveform to a file
#[tauri::command]
#[specta::specta]
pub async fn save_audio(
  state: State<'_, AppState>,
  path: String,
  audio_query: AudioQuery,
  speaker_id: StyleId,
) -> std::result::Result<String, String> {
  let waveform = _synthesize(
    state_async_mut!(state, wav_lru),
    state_async_ref!(state, core),
    audio_query,
    speaker_id,
  )
  .await?;
  std::fs::write(&path, waveform).map_err(|e| e.to_string())?;
  Ok(path)
}

#[tauri::command]
#[specta::specta]
pub async fn download_core(_url: String) -> Result<(), String> {
  todo!()
}

#[tauri::command]
#[specta::specta]
pub async fn pick_core(app: AppHandle) -> Option<CoreConfig> {
  let path = app.dialog().file().blocking_pick_folder();
  match path {
    Some(dir) => {
      let path = dir.as_path();
      if let Some(p) = path {
        Core::find_path(p)
      } else {
        None
      }
    }
    None => None,
  }
}

#[tauri::command]
#[specta::specta]
pub async fn clear_caches(state: State<'_, AppState>) -> Result<(), String> {
  state_async_mut!(state, wav_lru).clear();
  state_mut!(state, query_lru).clear();
  Ok(())
}

#[derive(specta::Type, Clone, Debug, serde::Serialize)]
pub enum SynthState {
  /// not started yet or not present in cache (dropped automatically)
  UnInitialized,
  /// a synthesis task is running
  Pending,
  /// synthesis is done, contains waveform
  Done,
}

#[tauri::command]
#[specta::specta]
/// Check the synthesis state in cache
/// 
/// The frontend will poll this to keep track of the synthesis progress for each text blocks.
pub async fn synthesize_state(
  state: State<'_, AppState>,
  query: AudioQuery,
  speaker_id: StyleId,
) -> std::result::Result<SynthState, String> {
  let query_string = serde_json::to_string(&query).map_err(|e| e.to_string())?;
  if let Some(cell) = state_async_mut!(state, wav_lru).get(&(query_string.clone(), speaker_id)) {
    if cell.get().is_some() {
      return Ok(SynthState::Done);
    } else {
      return Ok(SynthState::Pending);
    }
  } else {
    return Ok(SynthState::UnInitialized);
  }
}
