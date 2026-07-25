//! TODO: there's no reason we pass the audio to frontend, we can keep it in the buffer and avoid the IPC overhead
pub mod audio;
pub mod commands;
pub mod config;
pub mod core;
mod synthesis;
use core::Core;

use commands::*;
// somehow release build will warn about this, but it's necessary
#[allow(unused_imports)]
use specta_typescript::Typescript;
use std::sync::{Arc, Mutex, RwLock};
use tauri::async_runtime::RwLock as TokioRwLock;
use tauri::Manager;
use tokio::sync::Semaphore;

use tauri_specta::{collect_commands, collect_events, Builder, Event};

use voicevox_core::{AudioQuery, StyleId};

use synthesis::{SynthesisJobEvent, SynthesisQueue, WaveformCacheEntry};

pub(crate) type WavLruType = lru::LruCache<(String, StyleId), WaveformCacheEntry>;

type LockedState<T> = RwLock<Option<T>>;
pub struct AppState {
  pub(crate) core: TokioRwLock<Option<Arc<Core>>>,
  pub(crate) core_task_gate: Arc<Semaphore>,
  pub(crate) query_lru: LockedState<lru::LruCache<(String, StyleId), AudioQuery>>,
  pub(crate) wav_lru: TokioRwLock<Option<WavLruType>>,
  pub(crate) synthesis_queue: SynthesisQueue,
  pub(crate) config_manager: LockedState<config::ConfigManager>,
  pub(crate) audio_player: LockedState<audio::AudioPlayer>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = Builder::<tauri::Wry>::new()
    .commands(collect_commands![
      clear_caches,
      pick_core,
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
      cancel_synthesis,
      synthesize_state,
      get_spectrogram_preview,
      play_audio,
      play_audio_sequence,
      stop_audio,
      save_audio,
      get_os,
      join_path,
      parent_path,
      quit,
      save_project,
      load_project,
    ])
    .events(collect_events![
      InitializationEvent,
      FrontendReadyEvent,
      SynthesisJobEvent
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
      core_task_gate: Arc::new(Semaphore::new(1)),
      query_lru: RwLock::new(None),
      wav_lru: TokioRwLock::new(None),
      synthesis_queue: SynthesisQueue::default(),
      config_manager: RwLock::new(None),
      audio_player: RwLock::new(None),
    })
    .invoke_handler(builder.invoke_handler())
    .setup(move |app| {
      builder.mount_events(app);
      let app_handle = app.handle().clone();
      start_synthesis_worker(app_handle.clone());
      let startup = Arc::new(Mutex::new(None::<InitializationEvent>));
      let ready_startup = startup.clone();
      let ready_app = app_handle.clone();
      FrontendReadyEvent::listen(&app_handle, move |_| {
        let mut event = ready_startup.lock().unwrap().clone();
        if let Some(event) = event.as_mut() {
          let state = ready_app.state::<AppState>();
          event.config = state
            .config_manager
            .read()
            .unwrap()
            .as_ref()
            .map(|manager| manager.config.clone());
        }
        if let Some(event) = event {
          if let Err(error) = event.emit(&ready_app) {
            eprintln!("Failed to emit initialization event: {error}");
          }
        }
      });
      tauri::async_runtime::spawn(async move {
        let event = initialize(app_handle.clone()).await;
        startup.lock().unwrap().replace(event.clone());
        if let Err(error) = event.emit(&app_handle) {
          eprintln!("Failed to emit initialization event: {error}");
        }
      });
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
