//! TODO: there's no reason we pass the audio to frontend, we can keep it in the buffer and avoid the IPC overhead
pub mod audio;
pub mod voicevox_sys;

use std::sync::Mutex;

use audio::player;
use tauri::State;
use voicevox_sys::{audio_query::AudioQuery, metas::VoiceModelMeta, DynWrapper};

/// macro to do the stupid lock().unwrap().as_ref().ok_or("Not initialized")? dance
macro_rules! get_wrapper_ref {
  ($state:expr) => {
    $state
      .wrapper
      .lock()
      .unwrap()
      .as_ref()
      .ok_or("Not initialized")?
  };
}

macro_rules! get_wrapper_option {
  ($state:expr) => {
    $state.wrapper.lock().unwrap()
  };
}

/// try get the voicevox core path
#[tauri::command]
async fn get_core_path() -> std::result::Result<String, String> {
  // use env var in debug mode
  #[cfg(debug_assertions)]
  let path = std::env::var("VOICEVOX_CORE_DIR").map_err(|e| e.to_string())?;
  // TODO: grab the core path from config file in release mode
  #[cfg(not(debug_assertions))]
  todo!();

  Ok(path)
}

/// load the voicevox core
#[tauri::command]
async fn load_core(state: State<'_, AppState>, path: String) -> std::result::Result<(), String> {
  if std::path::Path::new(&path).exists() == false {
    return Err(format!("Path does not exist: {}", path));
  }
  if get_wrapper_option!(state).is_none() {
    let wrapper = DynWrapper::new(&path, None).map_err(|e| e.to_string())?;
    get_wrapper_option!(state).replace(wrapper);
    Ok(())
  } else {
    Err("Core already loaded".into())
  }
}

/// get metas from voicevox core
#[tauri::command]
async fn get_metas(state: State<'_, AppState>) -> std::result::Result<VoiceModelMeta, String> {
  let metas = get_wrapper_ref!(state).metas.clone();
  Ok(metas)
}

/// encode text to audio query
#[tauri::command]
async fn audio_query(
  state: State<'_, AppState>,
  text: &str,
  speaker_id: u32,
) -> std::result::Result<AudioQuery, String> {
  match get_wrapper_ref!(state).audio_query(text, speaker_id, None) {
    Ok(audio_query) => Ok(audio_query),
    Err(e) => Err(format!("Error encoding phonemes: {:?}", e.to_string())),
  }
}

/// decode audio query to waveform
#[tauri::command]
async fn synthesis(
  state: State<'_, AppState>,
  audio_query: AudioQuery,
  speaker_id: u32,
) -> std::result::Result<Vec<u8>, String> {
  let waveform = get_wrapper_ref!(state)
    .synthesis(&audio_query, speaker_id, None)
    .map_err(|e| format!("Failed in Synthesis: {:?}", e.to_string()))?;
  player::play_samples(waveform.clone()).expect("Failed to play samples");
  Ok(waveform)
}

pub(crate) struct AppState {
  pub wrapper: Mutex<Option<DynWrapper>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .manage(AppState {
      wrapper: Mutex::new(None),
    })
    .invoke_handler(tauri::generate_handler![
      get_core_path,
      get_metas,
      load_core,
      audio_query,
      synthesis
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
