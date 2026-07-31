//! TODO: there's no reason we pass the audio to frontend, we can keep it in the buffer and avoid the IPC overhead
pub mod audio;
pub mod commands;
pub mod config;
pub mod core;
mod synthesis;
use core::Core;

use commands::*;
#[cfg(any(debug_assertions, test))]
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

fn specta_builder() -> Builder<tauri::Wry> {
  Builder::<tauri::Wry>::new()
    .commands(collect_commands![
      clear_caches,
      get_cached_speaker_icons,
      download_speaker_icons,
      get_assets_size,
      clear_assets,
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
    ])
}

#[cfg(any(debug_assertions, test))]
fn export_typescript_bindings(builder: &Builder<tauri::Wry>) {
  let binding_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/binding.ts");
  builder
    .export(
      Typescript::default().bigint(specta_typescript::BigIntExportBehavior::Number),
      binding_path,
    )
    .expect("Failed to export typescript");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = specta_builder();

  #[cfg(debug_assertions)]
  export_typescript_bindings(&builder);

  let app = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init());

  #[cfg(feature = "e2e")]
  let app = app
    .plugin(tauri_plugin_wdio::init())
    .plugin(tauri_plugin_wdio_webdriver::init());

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

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;
  use std::num::NonZeroUsize;
  use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
  use tauri::webview::InvokeRequest;
  use tokio::sync::OnceCell;

  fn empty_app_state(
    wav_lru: Option<WavLruType>,
    query_lru: Option<lru::LruCache<(String, StyleId), AudioQuery>>,
  ) -> AppState {
    AppState {
      core: TokioRwLock::new(None),
      core_task_gate: Arc::new(Semaphore::new(1)),
      query_lru: RwLock::new(query_lru),
      wav_lru: TokioRwLock::new(wav_lru),
      synthesis_queue: SynthesisQueue::default(),
      config_manager: RwLock::new(None),
      audio_player: RwLock::new(None),
    }
  }

  fn invoke_request(cmd: &str, body: serde_json::Value) -> InvokeRequest {
    InvokeRequest {
      cmd: cmd.into(),
      callback: tauri::ipc::CallbackFn(0),
      error: tauri::ipc::CallbackFn(1),
      url: "tauri://localhost".parse().unwrap(),
      body: tauri::ipc::InvokeBody::Json(body),
      headers: Default::default(),
      invoke_key: INVOKE_KEY.into(),
    }
  }

  #[test]
  fn regenerate_typescript_bindings() {
    export_typescript_bindings(&specta_builder());
  }

  #[test]
  fn mock_runtime_dispatches_registered_path_commands() {
    let app = mock_builder()
      .invoke_handler(tauri::generate_handler![join_path, parent_path])
      .build(mock_context(noop_assets()))
      .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
      .build()
      .unwrap();

    let joined = get_ipc_response(
      &webview,
      invoke_request("join_path", json!({ "p1": "workspace", "p2": "audio.wav" })),
    )
    .unwrap()
    .deserialize::<String>()
    .unwrap();
    assert_eq!(
      joined,
      format!("workspace{}audio.wav", std::path::MAIN_SEPARATOR)
    );

    let parent = get_ipc_response(
      &webview,
      invoke_request("parent_path", json!({ "p": joined })),
    )
    .unwrap()
    .deserialize::<Option<String>>()
    .unwrap();
    assert_eq!(parent, Some("workspace".into()));
  }

  #[test]
  fn mock_runtime_reports_uninitialized_managed_state_errors() {
    let app = mock_builder()
      .manage(empty_app_state(None, None))
      .invoke_handler(tauri::generate_handler![synthesize_state, get_metas])
      .build(mock_context(noop_assets()))
      .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
      .build()
      .unwrap();
    let query = json!({
      "accent_phrases": [],
      "speedScale": 1.0,
      "pitchScale": 0.0,
      "intonationScale": 1.0,
      "volumeScale": 1.0,
      "prePhonemeLength": 0.1,
      "postPhonemeLength": 0.1,
      "outputSamplingRate": 24000,
      "outputStereo": false
    });

    let state_error = get_ipc_response(
      &webview,
      invoke_request(
        "synthesize_state",
        json!({ "query": query, "speakerId": 1 }),
      ),
    )
    .unwrap_err()
    .to_string();
    assert!(state_error.contains("wav_lru is not initialized"));

    let metas_error = get_ipc_response(&webview, invoke_request("get_metas", json!({})))
      .unwrap_err()
      .to_string();
    assert!(metas_error.contains("core is not initialized"));
  }

  #[test]
  fn mock_runtime_serializes_all_waveform_cache_states() {
    let wav_lru = lru::LruCache::new(NonZeroUsize::new(4).unwrap());
    let query_lru = lru::LruCache::new(NonZeroUsize::new(4).unwrap());
    let app = mock_builder()
      .manage(empty_app_state(Some(wav_lru), Some(query_lru)))
      .invoke_handler(tauri::generate_handler![synthesize_state])
      .build(mock_context(noop_assets()))
      .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
      .build()
      .unwrap();
    let query: AudioQuery = serde_json::from_value(json!({
      "accent_phrases": [],
      "speedScale": 1.0,
      "pitchScale": 0.0,
      "intonationScale": 1.0,
      "volumeScale": 1.0,
      "prePhonemeLength": 0.1,
      "postPhonemeLength": 0.1,
      "outputSamplingRate": 24000,
      "outputStereo": false
    }))
    .unwrap();
    let body = || {
      json!({
        "query": query,
        "speakerId": 1
      })
    };
    let invoke_state = || {
      get_ipc_response(&webview, invoke_request("synthesize_state", body()))
        .unwrap()
        .deserialize::<serde_json::Value>()
        .unwrap()
    };

    assert_eq!(invoke_state(), json!("UnInitialized"));

    let cell = Arc::new(OnceCell::new());
    let query_key = serde_json::to_string(&query).unwrap();
    tauri::async_runtime::block_on(async {
      app
        .state::<AppState>()
        .wav_lru
        .write()
        .await
        .as_mut()
        .unwrap()
        .put(
          (query_key, StyleId(1)),
          WaveformCacheEntry::new(cell.clone()),
        );
    });
    assert_eq!(invoke_state(), json!("Pending"));

    cell.set(vec![1, 2, 3]).unwrap();
    assert_eq!(invoke_state(), json!("Done"));
  }
}
