//! TODO: there's no reason we pass the audio to frontend, we can keep it in the buffer and avoid the IPC overhead
pub mod audio;
pub mod commands;
pub mod voicevox_sys;

use commands::*;
use std::sync::RwLock;

use voicevox_sys::audio_query::AudioQuery;
use voicevox_sys::DynWrapper;

pub(crate) struct AppState {
  pub wrapper: RwLock<Option<DynWrapper>>,
  pub query_lru: RwLock<Option<lru::LruCache<(String, u32), AudioQuery>>>,
  pub wav_lru: RwLock<Option<lru::LruCache<(AudioQuery, u32), Vec<u8>>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .manage(AppState {
      // we don't need to add arc here as tauri will do this for us
      wrapper: RwLock::new(None),
      query_lru: RwLock::new(None),
      wav_lru: RwLock::new(None),
    })
    .invoke_handler(tauri::generate_handler![
      get_core_path,
      get_metas,
      initialize,
      audio_query,
      synthesize
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
