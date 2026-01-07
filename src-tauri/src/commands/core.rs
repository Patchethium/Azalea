use super::utils::{state_mut, state_ref};
use crate::config::CoreConfig;
use crate::AppState;
use crate::{audio::AudioPlayer, core::Core};

use std::num::NonZeroUsize;

use ndarray::Array1;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use voicevox_core::{AccentPhrase, AudioQuery, StyleId, VoiceModelMeta};

/// Load the voicevox core and create lru cache
#[tauri::command]
#[specta::specta]
pub async fn init_core(
  state: State<'_, AppState>,
  config: CoreConfig,
) -> std::result::Result<(), String> {
  if state.core.read().unwrap().is_none() {
    let core = Core::init(&config).map_err(|e| e.to_string())?;
    state.core.write().unwrap().replace(core);
  } else {
    return Err("Core already loaded".into());
  }
  if state.wav_lru.read().unwrap().is_none() {
    if config.cache_size != 0 {
      let lru: lru::LruCache<(String, StyleId), Vec<u8>> =
        lru::LruCache::new(NonZeroUsize::new(config.cache_size).unwrap());
      state.wav_lru.write().unwrap().replace(lru);
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
  let metas = state_ref!(state, core).metas.clone();
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
  let query = state_ref!(state, core)
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
  state_ref!(state, core)
    .accent_phrases(&text, speaker_id)
    .map_err(|e| e.to_string())
}

/// Replace mora data (pitch and duration) in accent phrases
#[tauri::command]
#[specta::specta]
pub fn replace_mora(
  state: State<'_, AppState>,
  ap: Vec<AccentPhrase>,
  style_id: StyleId,
) -> std::result::Result<Vec<AccentPhrase>, String> {
  state_ref!(state, core)
    .replace_mora(ap, style_id)
    .map_err(|e| e.to_string())
}

/// Replace pitch in accent phrases
#[tauri::command]
#[specta::specta]
pub fn replace_mora_pitch(
  state: State<'_, AppState>,
  ap: Vec<AccentPhrase>,
  style_id: StyleId,
) -> std::result::Result<Vec<AccentPhrase>, String> {
  state_ref!(state, core)
    .replace_mora_pitch(ap, style_id)
    .map_err(|e| e.to_string())
}

/// Replace duration in accent phrases
#[tauri::command]
#[specta::specta]
pub fn replace_mora_duration(
  state: State<'_, AppState>,
  ap: Vec<AccentPhrase>,
  style_id: StyleId,
) -> std::result::Result<Vec<AccentPhrase>, String> {
  state_ref!(state, core)
    .replace_mora_duration(ap, style_id)
    .map_err(|e| e.to_string())
}

/// Decode audio query to waveform.
pub fn synthesize(
  cache: &mut lru::LruCache<(String, StyleId), Vec<u8>>,
  wrapper: &Core,
  audio_query: AudioQuery,
  speaker_id: StyleId,
) -> std::result::Result<Vec<u8>, String> {
  let query_string = serde_json::to_string(&audio_query).map_err(|e| e.to_string())?;
  if let Some(waveform) = cache.get(&(query_string.clone(), speaker_id)) {
    return Ok(waveform.clone());
  }
  let waveform = wrapper
    .synthesis(&audio_query, speaker_id)
    .map_err(|e| e.to_string())?;
  cache.put((query_string, speaker_id), waveform.clone());
  Ok(waveform)
}

#[tauri::command]
#[specta::specta]
pub async fn play_audio(
  state: State<'_, AppState>,
  audio_query: AudioQuery,
  speaker_id: StyleId,
) -> std::result::Result<(), String> {
  let waveform = synthesize(
    state_mut!(state, wav_lru),
    state_ref!(state, core),
    audio_query,
    speaker_id,
  )?;
  let audio_player = AudioPlayer::play(waveform);
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
  let waveform = synthesize(
    state_mut!(state, wav_lru),
    state_ref!(state, core),
    audio_query,
    speaker_id,
  )?;
  std::fs::write(&path, waveform).map_err(|e| e.to_string())?;
  Ok(path)
}

#[tauri::command]
#[specta::specta]
pub async fn spectrogram(signal: Vec<u16>) -> Vec<Vec<f64>> {
  let mut mel = crate::spectal::mel::MelSpec::new(1024, 128, 256, 24000);
  let signal = Array1::from(signal);
  let spec = mel
    .process(signal.mapv(|x| x as f64))
    .outer_iter()
    .map(|x| x.to_vec())
    .collect::<Vec<_>>();
  spec
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
  state_mut!(state, wav_lru).clear();
  state_mut!(state, query_lru).clear();
  Ok(())
}
