use super::utils::state_mut;
use crate::config::CoreConfig;
use crate::synthesis::{
  eviction_events, SynthesisJob, SynthesisJobEvent, SynthesisJobRequest, SynthesisJobState,
  WaveformCacheEntry, WaveformCacheOwner,
};
use crate::AppState;
use crate::{audio::spectal::MelSpec, audio::AudioPlayer, core::Core};

use ndarray::Array1;
use rodio::Source;
use serde::Serialize;
use std::io::Cursor;
use std::num::NonZeroUsize;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_specta::Event;
use tokio::sync::OnceCell;
use voicevox_core::{AccentPhrase, AudioQuery, StyleId, VoiceModelMeta};

/// Load the voicevox core and create lru cache
#[tauri::command]
#[specta::specta]
pub async fn init_core(
  state: State<'_, AppState>,
  config: CoreConfig,
) -> std::result::Result<(), String> {
  initialize_core(&state, config).await
}

pub async fn initialize_core(
  state: &AppState,
  config: CoreConfig,
) -> std::result::Result<(), String> {
  if state.core.read().await.is_none() {
    let core_config = config.clone();
    let core = tauri::async_runtime::spawn_blocking(move || Core::init(&core_config))
      .await
      .map_err(|e| format!("Core initialization task failed: {e}"))?
      .map_err(|e| e.to_string())?;
    state.core.write().await.replace(Arc::new(core));
  } else {
    return Err("Core already loaded".into());
  }
  // initialize LRU caches for waveforms
  if state.wav_lru.read().await.is_none() {
    if config.cache_size != 0 {
      let lru = lru::LruCache::new(
        NonZeroUsize::new(config.cache_size).ok_or("cache_size must be non-zero")?,
      );
      state.wav_lru.write().await.replace(lru);
    }
  } else {
    return Err("LRU cache already initialized".into());
  }
  if state.query_lru.read().map_err(|e| e.to_string())?.is_none() {
    if config.cache_size != 0 {
      let lru = lru::LruCache::new(
        NonZeroUsize::new(config.cache_size).ok_or("cache_size must be non-zero")?,
      );
      state
        .query_lru
        .write()
        .map_err(|e| e.to_string())?
        .replace(lru);
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
  let metas = state
    .core
    .read()
    .await
    .as_ref()
    .ok_or("core is not initialized")?
    .metas
    .clone();
  Ok(metas.values().flatten().cloned().collect())
}

async fn run_core_task<T, F>(state: &AppState, task: F) -> Result<T, String>
where
  T: Send + 'static,
  F: FnOnce(Arc<Core>) -> Result<T, String> + Send + 'static,
{
  let core = state
    .core
    .read()
    .await
    .as_ref()
    .cloned()
    .ok_or("core is not initialized")?;
  let permit = state
    .core_task_gate
    .clone()
    .acquire_owned()
    .await
    .map_err(|_| "Core task worker is unavailable")?;
  tauri::async_runtime::spawn_blocking(move || {
    let _permit = permit;
    task(core)
  })
  .await
  .map_err(|e| format!("Core task failed: {e}"))?
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
  let cache_key = (text.clone(), speaker_id);
  let query = run_core_task(&state, move |core| {
    core
      .audio_query(&text, speaker_id)
      .map_err(|e| e.to_string())
  })
  .await?;
  state_mut!(state, query_lru).put(cache_key, query.clone());
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
  run_core_task(&state, move |core| {
    core
      .accent_phrases(&text, speaker_id)
      .map_err(|e| e.to_string())
  })
  .await
}

/// Replace mora data (pitch and duration) in accent phrases
#[tauri::command]
#[specta::specta]
pub async fn replace_mora(
  state: State<'_, AppState>,
  ap: Vec<AccentPhrase>,
  style_id: StyleId,
) -> std::result::Result<Vec<AccentPhrase>, String> {
  run_core_task(&state, move |core| {
    core.replace_mora(ap, style_id).map_err(|e| e.to_string())
  })
  .await
}

/// Replace pitch in accent phrases
#[tauri::command]
#[specta::specta]
pub async fn replace_mora_pitch(
  state: State<'_, AppState>,
  ap: Vec<AccentPhrase>,
  style_id: StyleId,
) -> std::result::Result<Vec<AccentPhrase>, String> {
  run_core_task(&state, move |core| {
    core
      .replace_mora_pitch(ap, style_id)
      .map_err(|e| e.to_string())
  })
  .await
}

/// Replace duration in accent phrases
#[tauri::command]
#[specta::specta]
pub async fn replace_mora_duration(
  state: State<'_, AppState>,
  ap: Vec<AccentPhrase>,
  style_id: StyleId,
) -> std::result::Result<Vec<AccentPhrase>, String> {
  run_core_task(&state, move |core| {
    core
      .replace_mora_duration(ap, style_id)
      .map_err(|e| e.to_string())
  })
  .await
}

#[tauri::command]
#[specta::specta]
/// Queues a synthesis request and returns without waiting for inference.
pub async fn synthesize(
  app: AppHandle,
  state: State<'_, AppState>,
  request: SynthesisJobRequest,
) -> std::result::Result<(), String> {
  if request.block_id.trim().is_empty() {
    return Err("block_id must not be empty".into());
  }
  if request.hash.trim().is_empty() {
    return Err("hash must not be empty".into());
  }
  let query_key = serde_json::to_string(&request.audio_query).map_err(|e| e.to_string())?;
  let events = state
    .synthesis_queue
    .enqueue(SynthesisJob::new(request, query_key));
  emit_synthesis_events(&app, events);
  Ok(())
}

#[tauri::command]
#[specta::specta]
/// Cancels queued work for one block. Running inference is marked stale and its result is ignored.
pub async fn cancel_synthesis(
  app: AppHandle,
  state: State<'_, AppState>,
  block_id: String,
  generation_id: Option<u64>,
) -> std::result::Result<(), String> {
  let events = state.synthesis_queue.cancel(&block_id, generation_id);
  emit_synthesis_events(&app, events);
  Ok(())
}

fn emit_synthesis_events(app: &AppHandle, events: impl IntoIterator<Item = SynthesisJobEvent>) {
  for event in events {
    if let Err(error) = event.emit(app) {
      eprintln!("Failed to emit synthesis job event: {error}");
    }
  }
}

pub fn start_synthesis_worker(app: AppHandle) {
  tauri::async_runtime::spawn(async move {
    loop {
      let job = {
        let state = app.state::<AppState>();
        state.synthesis_queue.next().await
      };
      emit_synthesis_events(&app, [job.identity.event(SynthesisJobState::Running, None)]);

      let result = {
        let state = app.state::<AppState>();
        synthesize_cached(
          &app,
          &state,
          job.request.audio_query,
          job.request.speaker_id,
          Some(WaveformCacheOwner {
            identity: job.identity.clone(),
          }),
        )
        .await
      };

      let is_current = {
        let state = app.state::<AppState>();
        state.synthesis_queue.finish(&job.identity)
      };
      if !is_current {
        continue;
      }
      let event = match result {
        Ok(_) => job.identity.event(SynthesisJobState::Completed, None),
        Err(error) => job.identity.event(SynthesisJobState::Failed, Some(error)),
      };
      emit_synthesis_events(&app, [event]);
    }
  });
}

#[derive(specta::Type, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpectrogramPreview {
  pub values: Vec<u8>,
  pub frame_count: usize,
  pub mel_bins: usize,
  pub duration_seconds: f64,
}

fn create_spectrogram_preview(wav: Vec<u8>) -> Result<SpectrogramPreview, String> {
  const FFT_SIZE: usize = 1024;
  const MEL_BINS: usize = 96;
  const HOP_LENGTH: usize = 256;
  const DYNAMIC_RANGE_DB: f64 = 80.;

  let decoder = rodio::Decoder::new_wav(Cursor::new(wav))
    .map_err(|e| format!("Failed to decode WAV audio for spectrogram: {e}"))?;
  let channels = decoder.channels() as usize;
  let sample_rate = decoder.sample_rate() as usize;
  if channels == 0 || sample_rate == 0 {
    return Err("Invalid WAV channel count or sample rate".into());
  }

  let interleaved = decoder.collect::<Vec<i16>>();
  let mono = interleaved
    .chunks(channels)
    .map(|frame| {
      frame.iter().map(|sample| *sample as f64).sum::<f64>()
        / (frame.len() as f64 * i16::MAX as f64)
    })
    .collect::<Array1<_>>();
  let duration_seconds = mono.len() as f64 / sample_rate as f64;

  let mut extractor = MelSpec::new(FFT_SIZE, MEL_BINS, HOP_LENGTH, sample_rate);
  let spectrogram = extractor.process(mono);
  let frame_count = spectrogram.ncols();
  let max_db = spectrogram
    .iter()
    .copied()
    .fold(f64::NEG_INFINITY, f64::max);
  let floor_db = max_db - DYNAMIC_RANGE_DB;
  let values = spectrogram
    .iter()
    .map(|db| (((db - floor_db) / DYNAMIC_RANGE_DB).clamp(0., 1.) * u8::MAX as f64).round() as u8)
    .collect();

  Ok(SpectrogramPreview {
    values,
    frame_count,
    mel_bins: MEL_BINS,
    duration_seconds,
  })
}

#[tauri::command]
#[specta::specta]
/// Gets a compact mel spectrogram from the same cached waveform used for playback.
pub async fn get_spectrogram_preview(
  app: AppHandle,
  state: State<'_, AppState>,
  audio_query: AudioQuery,
  speaker_id: StyleId,
) -> Result<SpectrogramPreview, String> {
  let wav = synthesize_cached(&app, &state, audio_query, speaker_id, None).await?;

  tauri::async_runtime::spawn_blocking(move || create_spectrogram_preview(wav))
    .await
    .map_err(|e| format!("Spectrogram task failed: {e}"))?
}

/// Synthesizes or retrieves a waveform without holding the shared cache lock during inference.
async fn synthesize_cached(
  app: &AppHandle,
  state: &AppState,
  audio_query: AudioQuery,
  speaker_id: StyleId,
  owner: Option<WaveformCacheOwner>,
) -> std::result::Result<Vec<u8>, String> {
  let query_string = serde_json::to_string(&audio_query).map_err(|e| e.to_string())?;
  let cache_key = (query_string, speaker_id);
  let (cell, evicted) = {
    let mut cache_guard = state.wav_lru.write().await;
    let cache = cache_guard.as_mut().ok_or("wav_lru is not initialized")?;
    if let Some(entry) = cache.get(&cache_key) {
      (entry.cell.clone(), None)
    } else {
      let cell = Arc::new(OnceCell::new());
      let evicted = cache.push(cache_key.clone(), WaveformCacheEntry::new(cell.clone()));
      (cell, evicted)
    }
  };
  if let Some((_, entry)) = evicted {
    emit_synthesis_events(app, eviction_events(entry));
  }

  let query_for_task = audio_query.clone();
  let wav = cell
    .get_or_try_init(|| async {
      run_core_task(state, move |core| {
        core
          .synthesis(&query_for_task, speaker_id)
          .map_err(|e| e.to_string())
      })
      .await
    })
    .await?;

  let evicted = {
    let mut cache_guard = state.wav_lru.write().await;
    let cache = cache_guard.as_mut().ok_or("wav_lru is not initialized")?;
    let is_current_cell = cache
      .get(&cache_key)
      .map(|entry| Arc::ptr_eq(&entry.cell, &cell))
      .unwrap_or(false);
    if is_current_cell {
      if let Some(owner) = owner {
        cache
          .get_mut(&cache_key)
          .expect("cache entry disappeared while locked")
          .add_owner(owner);
      }
      None
    } else {
      let mut entry = WaveformCacheEntry::new(cell.clone());
      if let Some(owner) = owner {
        entry.add_owner(owner);
      }
      cache.push(cache_key, entry)
    }
  };
  if let Some((_, entry)) = evicted {
    emit_synthesis_events(app, eviction_events(entry));
  }
  Ok(wav.clone())
}

#[tauri::command]
#[specta::specta]
pub async fn play_audio(
  app: AppHandle,
  state: State<'_, AppState>,
  audio_query: AudioQuery,
  speaker_id: StyleId,
) -> std::result::Result<(), String> {
  let wav = synthesize_cached(&app, &state, audio_query, speaker_id, None).await?;
  let playback_app = app.clone();
  let audio_player = AudioPlayer::play(wav, move || {
    if let Err(error) = playback_app.emit("audio-playback-finished", ()) {
      eprintln!("Failed to emit playback completion: {error}");
    }
  })
  .await?;
  state
    .audio_player
    .write()
    .map_err(|e| e.to_string())?
    .replace(audio_player);
  Ok(())
}

#[derive(Clone, serde::Deserialize, specta::Type)]
pub struct AudioSequenceItem {
  pub audio_query: AudioQuery,
  pub speaker_id: StyleId,
}

#[tauri::command]
#[specta::specta]
/// Synthesizes and queues multiple audio queries for uninterrupted playback.
pub async fn play_audio_sequence(
  app: AppHandle,
  state: State<'_, AppState>,
  items: Vec<AudioSequenceItem>,
) -> std::result::Result<(), String> {
  if items.is_empty() {
    return Ok(());
  }
  let mut wavs = Vec::with_capacity(items.len());
  for item in items {
    wavs.push(synthesize_cached(&app, &state, item.audio_query, item.speaker_id, None).await?);
  }
  let playback_app = app.clone();
  let audio_player = AudioPlayer::play_many(wavs, move || {
    if let Err(error) = playback_app.emit("audio-playback-finished", ()) {
      eprintln!("Failed to emit playback completion: {error}");
    }
  })
  .await?;
  state
    .audio_player
    .write()
    .map_err(|e| e.to_string())?
    .replace(audio_player);
  Ok(())
}

#[tauri::command]
#[specta::specta]
/// Stops the current audio playback, if any.
pub async fn stop_audio(state: State<'_, AppState>) -> std::result::Result<(), String> {
  let audio_player = state
    .audio_player
    .write()
    .map_err(|e| e.to_string())?
    .take();
  if let Some(audio_player) = audio_player {
    audio_player.stop().await;
  }
  Ok(())
}

/// Save the audio waveform to a file
#[tauri::command]
#[specta::specta]
pub async fn save_audio(
  app: AppHandle,
  state: State<'_, AppState>,
  path: String,
  audio_query: AudioQuery,
  speaker_id: StyleId,
) -> std::result::Result<String, String> {
  let waveform = synthesize_cached(&app, &state, audio_query, speaker_id, None).await?;
  std::fs::write(&path, waveform).map_err(|e| e.to_string())?;
  Ok(path)
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
pub async fn clear_caches(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
  let eviction_events = {
    let mut cache_guard = state.wav_lru.write().await;
    let cache = cache_guard.as_mut().ok_or("wav_lru is not initialized")?;
    let events = cache
      .iter()
      .flat_map(|(_, entry)| {
        entry
          .owners
          .iter()
          .map(|owner| owner.identity.event(SynthesisJobState::Evicted, None))
          .collect::<Vec<_>>()
      })
      .collect::<Vec<_>>();
    cache.clear();
    events
  };
  emit_synthesis_events(&app, eviction_events);
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
  let mut cache_guard = state.wav_lru.write().await;
  let cache = cache_guard.as_mut().ok_or("wav_lru is not initialized")?;
  if let Some(entry) = cache.get(&(query_string, speaker_id)) {
    if entry.cell.get().is_some() {
      return Ok(SynthState::Done);
    } else {
      return Ok(SynthState::Pending);
    }
  } else {
    return Ok(SynthState::UnInitialized);
  }
}
