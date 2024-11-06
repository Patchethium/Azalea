use crate::voicevox_sys::audio_query::AudioQuery;
use crate::voicevox_sys::metas::VoiceModelMeta;
use crate::voicevox_sys::DynWrapper;
use crate::AppState;

use super::audio::player;
use tauri::State;

/// macro to do the stupid lock().unwrap().as_ref().ok_or("Not initialized")? dance,
#[allow(unused_macros)]
macro_rules! wrapper_ref {
  ($state:expr) => {
    $state
      .wrapper
      .read()
      .unwrap()
      .as_ref()
      .ok_or("Not initialized")?
  };
}

#[allow(unused_macros)]
macro_rules! wrapper_mut_option {
  ($state:expr) => {
    $state.wrapper.write().unwrap()
  };
}

#[allow(unused_macros)]
macro_rules! wav_lru_ref {
  ($state:expr) => {
    $state
      .wav_lru
      .read()
      .unwrap()
      .as_ref()
      .ok_or("Not initialized")?
  };
}

#[allow(unused_macros)]
macro_rules! wav_lru_mut_option {
  ($state:expr) => {
    $state.wav_lru.write().unwrap()
  };
}

#[allow(unused_macros)]
macro_rules! query_lru_ref {
  ($state:expr) => {
    $state
      .query_lru
      .read()
      .unwrap()
      .as_ref()
      .ok_or("Not initialized")?
  };
}

#[allow(unused_macros)]
macro_rules! query_lru_mut_option {
  ($state:expr) => {
    $state.query_lru.write().unwrap()
  };
}

/// try get the voicevox core path
#[tauri::command]
pub(crate) async fn get_core_path() -> std::result::Result<String, String> {
  // use env var in debug mode
  #[cfg(debug_assertions)]
  let path = std::env::var("VOICEVOX_CORE_DIR").map_err(|e| e.to_string())?;
  #[cfg(debug_assertions)]
  return Ok(path);
  // TODO: grab the core path from config file in release mode
  #[cfg(not(debug_assertions))]
  Err("Not implemented".into())
}

/// load the voicevox core and create lru cache
#[tauri::command]
pub(crate) async fn initialize(
  state: State<'_, AppState>,
  core_path: String,
  cache_size: usize,
) -> std::result::Result<(), String> {
  if !std::path::Path::new(&core_path).exists() {
    return Err(format!("Path does not exist: {}", core_path));
  }
  if wrapper_mut_option!(state).is_none() {
    let wrapper = DynWrapper::new(&core_path, None).map_err(|e| e.to_string())?;
    wrapper_mut_option!(state).replace(wrapper);
  } else {
    return Err("Core already loaded".into());
  }
  if state.wav_lru.read().unwrap().is_none() {
    match cache_size {
      0 => {} // keep it None
      _ => {
        let lru = lru::LruCache::new(std::num::NonZeroUsize::new(cache_size).unwrap());
        wav_lru_mut_option!(state).replace(lru);
      }
    }
  } else {
    return Err("LRU cache already initialized".into());
  }
  Ok(())
}

/// get metas from voicevox core
#[tauri::command]
pub(crate) async fn get_metas(
  state: State<'_, AppState>,
) -> std::result::Result<VoiceModelMeta, String> {
  let metas = wrapper_ref!(state).metas.clone();
  Ok(metas)
}

/// encode text to audio query
#[tauri::command]
pub(crate) async fn audio_query(
  state: State<'_, AppState>,
  text: &str,
  speaker_id: u32,
) -> std::result::Result<AudioQuery, String> {
  if let Some(cache) = query_lru_mut_option!(state).as_mut() {
    if let Some(audio_query) = cache.get(text) {
      return Ok(audio_query.clone());
    }
  }
  let query = wrapper_ref!(state)
    .audio_query(text, speaker_id, None)
    .map_err(|e| e.to_string())?;
  if let Some(cache) = query_lru_mut_option!(state).as_mut() {
    cache.put(text.to_string(), query.clone());
  }
  Ok(query)
}

/// decode audio query to waveform
#[tauri::command]
pub(crate) async fn synthesize(
  state: State<'_, AppState>,
  audio_query: AudioQuery,
  speaker_id: u32,
) -> std::result::Result<Vec<u8>, String> {
  if let Some(cache) = wav_lru_mut_option!(state).as_mut() {
    if let Some(waveform) = cache.get(&audio_query) {
      player::play_samples(waveform.clone()).expect("Failed to play samples");
      return Ok(waveform.clone());
    }
  }
  let waveform = wrapper_ref!(state)
    .synthesis(&audio_query, speaker_id, None)
    .map_err(|e| format!("Failed in Synthesis: {:?}", e.to_string()))?;
  player::play_samples(waveform.clone()).expect("Failed to play samples");
  if let Some(cache) = wav_lru_mut_option!(state).as_mut() {
    cache.put(audio_query, waveform.clone());
  }
  Ok(waveform)
}
