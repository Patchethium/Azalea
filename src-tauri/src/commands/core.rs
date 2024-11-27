use super::utils::{state_mut, state_ref};
use crate::audio::AudioPlayer;
use crate::voicevox_sys::audio_query::AudioQuery;
use crate::voicevox_sys::metas::VoiceModelMeta;
use crate::voicevox_sys::utils::{search_file, VOICEVOX_LIB_NAME};
use crate::voicevox_sys::DynWrapper;
use crate::AppState;

use std::num::NonZeroUsize;
use std::path::PathBuf;

use ndarray::Array1;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
#[specta::specta]
/// So, the `libvoicevox.so` is not in the same directory as the executable,
/// so we search for it in the executable's directory and return the dir that
/// actually contains the `libvoicevox.so` file.
pub async fn sanitize_vv_exe_path(path: String) -> Option<PathBuf> {
  let path = std::path::Path::new(&path);
  let path = if path.is_dir() {
    path.to_path_buf()
  } else {
    path.parent().unwrap().to_path_buf()
  };
  let dir = search_file(VOICEVOX_LIB_NAME, path.to_str().unwrap());
  dir
}

/// Load the voicevox core and create lru cache
#[tauri::command]
#[specta::specta]
pub async fn init_core(
  state: State<'_, AppState>,
  core_path: String,
  cache_size: usize,
) -> std::result::Result<(), String> {
  if !std::path::Path::new(&core_path).exists() {
    return Err(format!("Path does not exist: {}", core_path));
  }
  if state.wrapper.read().unwrap().is_none() {
    let wrapper = DynWrapper::new(&core_path, None).map_err(|e| e.to_string())?;
    state_mut!(state, wrapper).replace(wrapper);
  } else {
    return Err("Core already loaded".into());
  }
  if state.wav_lru.read().unwrap().is_none() {
    if cache_size != 0 {
      let lru = lru::LruCache::new(NonZeroUsize::new(cache_size).unwrap());
      state_mut!(state, wav_lru).replace(lru);
    }
  } else {
    return Err("LRU cache already initialized".into());
  }
  if state.query_lru.read().unwrap().is_none() {
    if cache_size != 0 {
      let lru = lru::LruCache::new(NonZeroUsize::new(cache_size).unwrap());
      state_mut!(state, query_lru).replace(lru);
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
  let metas = state_ref!(state, wrapper).metas.clone();
  Ok(metas)
}

/// Encodes text into audio query
#[tauri::command]
#[specta::specta]
pub async fn audio_query(
  state: State<'_, AppState>,
  text: &str,
  speaker_id: u32,
) -> std::result::Result<AudioQuery, String> {
  if let Some(cache) = state_mut!(state, query_lru).as_mut() {
    if let Some(audio_query) = cache.get(&(text.into(), speaker_id)) {
      return Ok(audio_query.clone());
    }
  }
  let query = state_ref!(state, wrapper)
    .audio_query(text, speaker_id, None)
    .map_err(|e| e.to_string())?;
  if let Some(cache) = state_mut!(state, query_lru).as_mut() {
    cache.put((text.into(), speaker_id), query.clone());
  }
  Ok(query)
}

/// > Decode audio query to waveform.
/// 
/// > It doesn't really return the waveform,
/// instead the waveform will be stored in the cache, waiting to be played.
/// The frontend doesn't need actual waveform data.
#[tauri::command]
#[specta::specta]
pub async fn synthesize(
  state: State<'_, AppState>,
  audio_query: AudioQuery,
  speaker_id: u32,
) -> std::result::Result<(), String> {
  if let Some(cache) = state_mut!(state, wav_lru).as_mut() {
    if let Some(waveform) = cache.get(&(audio_query.clone(), speaker_id)) {
      let audio_player = AudioPlayer::play(waveform.clone());
      state_mut!(state, audio_player).replace(audio_player);
      return Ok(());
    }
  }
  let waveform = state_ref!(state, wrapper)
    .synthesis(&audio_query, speaker_id, None)
    .map_err(|e| format!("Failed in Synthesis: {:?}", e.to_string()))?;
  let audio_player = AudioPlayer::play(waveform.clone());
  state_mut!(state, audio_player).replace(audio_player);
  if let Some(cache) = state_mut!(state, wav_lru).as_mut() {
    cache.put((audio_query.clone(), speaker_id), waveform.clone());
  }
  Ok(())
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
pub async fn pick_core(app: AppHandle, pick_exec: bool) -> Result<String, String> {
  let path = app
    .dialog()
    .file()
    .set_file_name(if pick_exec {
      VOICEVOX_LIB_NAME
    } else {
      "voicevox"
    })
    .blocking_pick_file();
  if path.is_none() {
    return Ok("".into());
  }
  let path = match path {
    Some(p) => p.into_path().map_err(|e| e.to_string())?,
    None => "".into(),
  };
  let path = if path.is_file() {
    path.parent().unwrap().to_path_buf()
  } else {
    path
  };
  Ok(path.to_str().unwrap().into())
}
