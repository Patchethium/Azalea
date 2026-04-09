//! TODO: there's no reason we pass the audio to frontend, we can keep it in the buffer and avoid the IPC overhead
pub mod audio;
pub mod commands;
pub mod config;
pub mod core;
use core::Core;

use commands::*;
use specta_typescript::Typescript;
use std::sync::{Arc, RwLock};
use tokio::sync::OnceCell;
use tauri::async_runtime::RwLock as TokioRwLock;

use tauri_specta::{collect_commands, Builder};

use voicevox_core::{AudioQuery, StyleId};

pub type WavLruType = lru::LruCache<(String, StyleId), Arc<OnceCell<Vec<u8>>>>;

type LockedState<T> = RwLock<Option<T>>;
pub struct AppState {
  pub core: TokioRwLock<Option<Core>>,
  pub query_lru: LockedState<lru::LruCache<(String, StyleId), AudioQuery>>,
  pub wav_lru: TokioRwLock<Option<WavLruType>>, // use an async Lock for wav cache so synthesis can be async
  pub config_manager: LockedState<config::ConfigManager>,
  pub audio_player: LockedState<audio::AudioPlayer>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = Builder::<tauri::Wry>::new().commands(collect_commands![
    clear_caches,
    pick_core,
    download_core,
    init_config,
    get_config,
    set_config,
    init_core,
    get_metas,
    get_range,
    audio_query,
    accent_phrases,
    replace_mora,
    replace_mora_pitch,
    replace_mora_duration,
    synthesize,
    synthesize_state,
    play_audio,
    save_audio,
    get_os,
    quit,
    save_project,
    load_project,
  ]);

  // In debug mode, export the typescript bindings
  #[cfg(debug_assertions)]
  builder
    .export(
      Typescript::default().bigint(specta_typescript::BigIntExportBehavior::Number),
      "../src/binding.ts",
    )
    .expect("Failed to export typescript");

  let app = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init());

  #[cfg(not(debug_assertions))] // prevent default on release build
  let app = app.plugin(tauri_plugin_prevent_default::init());

  app
    .manage(AppState {
      core: TokioRwLock::new(None),
      query_lru: RwLock::new(None),
      wav_lru: TokioRwLock::new(None),
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
