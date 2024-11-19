//! TODO: there's no reason we pass the audio to frontend, we can keep it in the buffer and avoid the IPC overhead
pub mod audio;
pub mod commands;
pub mod config;
pub mod spectal;
pub mod voicevox_sys;

use commands::*;
use specta_typescript::Typescript;
use std::sync::RwLock;

use tauri_specta::{collect_commands, Builder};

use voicevox_sys::audio_query::AudioQuery;
use voicevox_sys::DynWrapper;

type LockedState<T> = RwLock<Option<T>>;
pub struct AppState {
  pub wrapper: LockedState<DynWrapper>,
  pub query_lru: LockedState<lru::LruCache<(String, u32), AudioQuery>>,
  pub wav_lru: LockedState<lru::LruCache<(AudioQuery, u32), Vec<u8>>>,
  pub config_manager: LockedState<config::ConfigManager>,
  pub audio_player: LockedState<audio::AudioPlayer>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = Builder::<tauri::Wry>::new().commands(collect_commands![
    sanitize_vv_exe_path,
    pick_core,
    download_core,
    init_config,
    get_config,
    set_config,
    init_core,
    get_metas,
    get_range,
    audio_query,
    synthesize,
    spectrogram,
    quit,
  ]);

  // In debug mode, export the typescript bindings
  #[cfg(debug_assertions)]
  builder
    .export(
      Typescript::default().bigint(specta_typescript::BigIntExportBehavior::Number),
      "../src/binding.ts",
    )
    .expect("Failed to export typescript");

  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .manage(AppState {
      wrapper: RwLock::new(None),
      query_lru: RwLock::new(None),
      wav_lru: RwLock::new(None),
      config_manager: RwLock::new(None),
      audio_player: RwLock::new(None),
    })
    .invoke_handler(builder.invoke_handler())
    .setup(move |app| {
      builder.mount_events(app);
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
