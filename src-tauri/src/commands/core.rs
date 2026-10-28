use super::utils::{state_mut, state_ref};
use crate::async_job::run_cancellable;
use crate::config::manager::user_dictionary_path;
use crate::config::range::style_range;
use crate::config::CoreConfig;
use crate::post::{self, PostEdit, PostF0Analysis};
use crate::spectrogram::{
  create_spectrogram_preview, validate_spectrogram_request, SlidingSpectrogram, SpectrogramJob,
  SpectrogramJobEvent, SpectrogramJobIdentity, SpectrogramJobRequest, SLIDING_TICK,
};
use crate::streaming::{
  PlaybackCursor, RenderProgress, RenderedChunk, StreamPlan, DEFAULT_CHUNK_SCHEDULE,
};
use crate::synthesis::{
  eviction_events, SynthesisBackend, SynthesisJob, SynthesisJobEvent, SynthesisJobRequest,
  SynthesisJobState, WaveformCacheEntry, WaveformCacheOwner, WaveformCell,
};
use crate::AppState;
use crate::{
  audio::combine::concatenate_wavs,
  audio::lab::lab_from_audio_query_mapped,
  audio::stretch::TimeMap,
  audio::{AudioPlayer, PlaybackFeed},
  core::Core,
};

use futures_util::future::{select, Either};
use std::future::Future;
#[cfg(test)]
use std::io::Cursor;
use std::io::Write;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::{atomic::Ordering, Arc};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_specta::Event;
use tokio::sync::{oneshot, watch, OnceCell, OwnedSemaphorePermit};
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
  let _permit = state
    .core_task_gate
    .acquire()
    .await
    .map_err(|e| e.to_string())?;
  if state.core.read().await.is_none() {
    let core_config = config.clone();
    let core = tauri::async_runtime::spawn_blocking(move || Core::init(&core_config))
      .await
      .map_err(|e| format!("Core initialization task failed: {e}"))?
      .map_err(|e| e.to_string())?;
    let dictionary_path = user_dictionary_path();
    let core = tauri::async_runtime::spawn_blocking(move || {
      super::dictionary::apply_saved_dictionary(&core, &dictionary_path)?;
      Ok::<_, String>(core)
    })
    .await
    .map_err(|e| format!("Dictionary initialization task failed: {e}"))??;
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

/// Reloads the voicevox core using the supplied config, replacing the running instance.
/// In-flight tasks keep their old core reference; new work uses the reloaded one.
#[tauri::command]
#[specta::specta]
pub async fn reinit_core(
  app: AppHandle,
  state: State<'_, AppState>,
  config: CoreConfig,
) -> std::result::Result<(), String> {
  reinitialize_core(&app, &state, config).await
}

pub async fn reinitialize_core(
  app: &AppHandle,
  state: &AppState,
  config: CoreConfig,
) -> std::result::Result<(), String> {
  let _permit = state
    .core_task_gate
    .acquire()
    .await
    .map_err(|e| e.to_string())?;
  reinitialize_core_locked(app, state, config).await
}

/// The caller must hold core_task_gate while changing model files or the core.
pub(crate) async fn reinitialize_core_locked(
  app: &AppHandle,
  state: &AppState,
  config: CoreConfig,
) -> std::result::Result<(), String> {
  let core = tauri::async_runtime::spawn_blocking(move || Core::init(&config))
    .await
    .map_err(|e| format!("Core initialization task failed: {e}"))?
    .map_err(|e| e.to_string())?;
  let dictionary_path = user_dictionary_path();
  let core = tauri::async_runtime::spawn_blocking(move || {
    super::dictionary::apply_saved_dictionary(&core, &dictionary_path)?;
    Ok::<_, String>(core)
  })
  .await
  .map_err(|e| format!("Dictionary initialization task failed: {e}"))??;
  // Commit only after both synthesizers and the shared user dictionary are ready.
  discard_core_work(app, state).await?;
  state.core.write().await.replace(Arc::new(core));
  Ok(())
}

pub(crate) async fn discard_core_work(app: &AppHandle, state: &AppState) -> Result<(), String> {
  state.core_generation.fetch_add(1, Ordering::SeqCst);
  emit_synthesis_events(app, state.synthesis_queue.discard_all());
  emit_spectrogram_events(app, state.spectrogram_queue.discard_all());
  if let Some(cache) = state.wav_lru.write().await.as_mut() {
    cache.clear();
  }
  if let Some(cache) = state.query_lru.write().map_err(|e| e.to_string())?.as_mut() {
    cache.clear();
  }
  state.post_cache.clear();
  let player = state
    .audio_player
    .write()
    .map_err(|e| e.to_string())?
    .take();
  if let Some(player) = player {
    player.stop().await;
  }
  let _ = app.emit("audio-playback-finished", ());
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

/// Whether the loaded ONNX Runtime allows pitch noise and pitch completion.
#[tauri::command]
#[specta::specta]
pub async fn supports_pitch_control(
  state: State<'_, AppState>,
) -> std::result::Result<bool, String> {
  Ok(
    state
      .core
      .read()
      .await
      .as_ref()
      .ok_or("core is not initialized")?
      .supports_pitch_control(),
  )
}

fn ensure_core_generation(state: &AppState, generation: u64) -> Result<(), String> {
  if state.core_generation.load(Ordering::SeqCst) != generation {
    return Err("Voice setup changed; retry the operation".into());
  }
  Ok(())
}

fn generation_key(key: String, generation: u64) -> String {
  if generation == 0 {
    key
  } else {
    format!("{generation}:{key}")
  }
}

async fn run_core_task<T, F>(state: &AppState, task: F) -> Result<T, String>
where
  T: Send + 'static,
  F: FnOnce(Arc<Core>) -> Result<T, String> + Send + 'static,
{
  let generation = state.core_generation.load(Ordering::SeqCst);
  run_core_task_at(state, generation, task).await
}

/// Takes the core task gate and the core, failing when the core changed since `generation`.
async fn acquire_core(
  state: &AppState,
  generation: u64,
) -> Result<(OwnedSemaphorePermit, Arc<Core>), String> {
  let permit = state
    .core_task_gate
    .clone()
    .acquire_owned()
    .await
    .map_err(|_| "Core task worker is unavailable")?;
  ensure_core_generation(state, generation)?;
  let core = state
    .core
    .read()
    .await
    .as_ref()
    .cloned()
    .ok_or("core is not initialized")?;
  Ok((permit, core))
}

/// Same as [`run_core_task`], but only on the core of `generation`.
async fn run_core_task_at<T, F>(state: &AppState, generation: u64, task: F) -> Result<T, String>
where
  T: Send + 'static,
  F: FnOnce(Arc<Core>) -> Result<T, String> + Send + 'static,
{
  let (permit, core) = acquire_core(state, generation).await?;
  tauri::async_runtime::spawn_blocking(move || {
    let _permit = permit;
    task(core)
  })
  .await
  .map_err(|e| format!("Core task failed: {e}"))?
}

async fn run_nonblocking_synthesis_task(
  state: &AppState,
  audio_query: AudioQuery,
  speaker_id: StyleId,
) -> Result<Vec<u8>, String> {
  let generation = state.core_generation.load(Ordering::SeqCst);
  let (_permit, core) = acquire_core(state, generation).await?;
  core
    .synthesis_nonblocking_prepared(&audio_query, speaker_id)
    .await
    .map_err(|e| e.to_string())
}

async fn prepare_nonblocking_synthesis_task(
  state: &AppState,
  speaker_id: StyleId,
) -> Result<(), String> {
  let generation = state.core_generation.load(Ordering::SeqCst);
  let (_permit, core) = acquire_core(state, generation).await?;
  core
    .prepare_nonblocking_synthesis(speaker_id)
    .await
    .map_err(|e| e.to_string())
}

/// Encodes text into audio query
#[tauri::command]
#[specta::specta]
pub async fn audio_query(
  state: State<'_, AppState>,
  text: String,
  speaker_id: StyleId,
  seed: u32,
) -> std::result::Result<AudioQuery, String> {
  let noise = state_ref!(state, config_manager)
    .config
    .ui
    .pitch_noise_options(seed);
  let english = state_ref!(state, config_manager)
    .config
    .ui
    .english_options()
    // Without the downloaded models, OpenJTalk's reading is used.
    .filter(|_| crate::english::models_available());
  let generation = state.core_generation.load(Ordering::SeqCst);
  // The English reading options change the analysis, so they are part of the key.
  let text_key = match english {
    Some(options) => format!("{options:?}:{text}"),
    None => text.clone(),
  };
  let cache_key = (generation_key(text_key, generation), speaker_id);
  let cached = state_mut!(state, query_lru).get(&cache_key).cloned();
  // Cache the ordinary query so changing the seed or sigma cannot reuse old noise.
  let mut query = match cached {
    Some(query) => query,
    None => {
      let query = run_core_task(&state, move |core| {
        core
          .audio_query_with_english(&text, speaker_id, english)
          .map_err(|e| e.to_string())
      })
      .await?;
      ensure_core_generation(&state, generation)?;
      state_mut!(state, query_lru).put(cache_key, query.clone());
      query
    }
  };
  if noise.is_some() {
    query.accent_phrases = run_core_task(&state, move |core| {
      core
        .apply_pitch_noise(query.accent_phrases, speaker_id, noise)
        .map_err(|e| e.to_string())
    })
    .await?;
  }
  ensure_core_generation(&state, generation)?;
  Ok(query)
}

/// Creates the query the dictionary dialog plays for an entry's pronunciation and accent
#[tauri::command]
#[specta::specta]
pub async fn dictionary_preview_query(
  state: State<'_, AppState>,
  pronunciation: String,
  accent_type: u32,
  speaker_id: StyleId,
) -> std::result::Result<AudioQuery, String> {
  let kana = super::dictionary_preview_kana(&pronunciation, accent_type)?;
  run_core_task(&state, move |core| {
    core
      .audio_query_from_kana(&kana, speaker_id)
      .map_err(|e| e.to_string())
  })
  .await
}

/// Encodes text into accent phrases
#[tauri::command]
#[specta::specta]
pub async fn accent_phrases(
  state: State<'_, AppState>,
  text: String,
  speaker_id: StyleId,
  seed: u32,
) -> std::result::Result<Vec<AccentPhrase>, String> {
  let noise = state_ref!(state, config_manager)
    .config
    .ui
    .pitch_noise_options(seed);
  let english = state_ref!(state, config_manager)
    .config
    .ui
    .english_options()
    // Without the downloaded models, OpenJTalk's reading is used.
    .filter(|_| crate::english::models_available());
  run_core_task(&state, move |core| {
    core
      .accent_phrases_with_english(&text, speaker_id, english)
      .and_then(|ap| core.apply_pitch_noise(ap, speaker_id, noise))
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
  seed: u32,
) -> std::result::Result<Vec<AccentPhrase>, String> {
  let noise = state_ref!(state, config_manager)
    .config
    .ui
    .pitch_noise_options(seed);
  run_core_task(&state, move |core| {
    core
      .replace_mora(ap, style_id)
      .and_then(|ap| core.apply_pitch_noise(ap, style_id, noise))
      .map_err(|e| e.to_string())
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
  seed: u32,
) -> std::result::Result<Vec<AccentPhrase>, String> {
  let noise = state_ref!(state, config_manager)
    .config
    .ui
    .pitch_noise_options(seed);
  run_core_task(&state, move |core| {
    core
      .replace_mora_pitch(ap, style_id)
      .and_then(|ap| core.apply_pitch_noise(ap, style_id, noise))
      .map_err(|e| e.to_string())
  })
  .await
}

/// Complete the pitch suffix from a fixed mora pitch prefix.
#[tauri::command]
#[specta::specta]
pub async fn complete_mora_pitch(
  state: State<'_, AppState>,
  ap: Vec<AccentPhrase>,
  style_id: StyleId,
  pitch_prefix: Vec<f32>,
  seed: u32,
) -> std::result::Result<Vec<AccentPhrase>, String> {
  let options = state_ref!(state, config_manager)
    .config
    .ui
    .pitch_noise_options(seed)
    .unwrap_or_default();
  run_core_task(&state, move |core| {
    core
      .complete_mora_pitch(ap, style_id, &pitch_prefix, options)
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
  enqueue_synthesis(&app, &state, request, SynthesisBackend::Blocking)
}

#[tauri::command]
#[specta::specta]
/// Queues a cancellable synthesis request using VOICEVOX Core's experimental nonblocking API.
/// A newer request for the same block cancels its running nonblocking generation.
pub async fn synthesize_nonblocking(
  app: AppHandle,
  state: State<'_, AppState>,
  request: SynthesisJobRequest,
) -> std::result::Result<(), String> {
  enqueue_synthesis(&app, &state, request, SynthesisBackend::Nonblocking)
}

fn enqueue_synthesis(
  app: &AppHandle,
  state: &AppState,
  request: SynthesisJobRequest,
  backend: SynthesisBackend,
) -> std::result::Result<(), String> {
  validate_synthesis_request(&request)?;
  let mut query_key = serde_json::to_string(&request.audio_query).map_err(|e| e.to_string())?;
  if let Some(post) = &request.post {
    query_key.push_str(&serde_json::to_string(post).map_err(|e| e.to_string())?);
  }
  let job = SynthesisJob::new(request, query_key, backend);
  let events = state.synthesis_queue.enqueue(job);
  emit_synthesis_events(app, events);
  Ok(())
}

fn validate_synthesis_request(request: &SynthesisJobRequest) -> Result<(), String> {
  if request.block_id.trim().is_empty() {
    return Err("block_id must not be empty".into());
  }
  if request.hash.trim().is_empty() {
    return Err("hash must not be empty".into());
  }
  if let Some(post) = &request.post {
    post.validate()?;
  }
  Ok(())
}

#[tauri::command]
#[specta::specta]
/// Cancels queued work for one block. Running nonblocking inference is stopped; running blocking
/// inference is marked stale and its result is ignored.
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
      let cancellation = job.cancellation;
      let job = job.job;
      // A job can be cancelled after it was dequeued but before the worker starts it.
      // Skipping it here avoids emitting a misleading `Running` event and avoids
      // starting inference that the caller already abandoned.
      let result = if cancellation.is_cancelled() {
        None
      } else {
        emit_synthesis_events(&app, [job.identity.event(SynthesisJobState::Running, None)]);
        let state = app.state::<AppState>();
        let synthesis = synthesize_post_processed(
          &app,
          &state,
          job.request.audio_query,
          job.request.speaker_id,
          job.request.post.as_ref(),
          Some(WaveformCacheOwner {
            identity: job.identity.clone(),
          }),
          job.backend,
          None,
        );
        match job.backend {
          SynthesisBackend::Blocking => Some(synthesis.await),
          SynthesisBackend::Nonblocking => run_cancellable(&cancellation, synthesis).await,
        }
      };

      let is_current = {
        let state = app.state::<AppState>();
        state.synthesis_queue.finish(&job.identity)
      };
      if !is_current {
        continue;
      }
      let event = match result.expect("an uncancelled synthesis job must have a result") {
        Ok(_) => job.identity.event(SynthesisJobState::Completed, None),
        Err(error) => job.identity.event(SynthesisJobState::Failed, Some(error)),
      };
      emit_synthesis_events(&app, [event]);
    }
  });
}

#[tauri::command]
#[specta::specta]
/// Queues a cancellable spectrogram request backed by the shared waveform cache.
pub async fn request_spectrogram_preview(
  app: AppHandle,
  state: State<'_, AppState>,
  request: SpectrogramJobRequest,
) -> Result<(), String> {
  validate_spectrogram_request(&request)?;
  let query_key = serde_json::to_string(&request.audio_query).map_err(|e| e.to_string())?;
  let events = state
    .spectrogram_queue
    .enqueue(SpectrogramJob::new(request, query_key));
  emit_spectrogram_events(&app, events);
  Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_spectrogram_preview(
  app: AppHandle,
  state: State<'_, AppState>,
  block_id: String,
  generation_id: Option<u64>,
) -> Result<(), String> {
  let events = state.spectrogram_queue.cancel(&block_id, generation_id);
  emit_spectrogram_events(&app, events);
  Ok(())
}

fn emit_spectrogram_events(app: &AppHandle, events: impl IntoIterator<Item = SpectrogramJobEvent>) {
  for event in events {
    if let Err(error) = event.emit(app) {
      eprintln!("Failed to emit spectrogram job event: {error}");
    }
  }
}

pub fn start_spectrogram_worker(app: AppHandle) {
  tauri::async_runtime::spawn(async move {
    loop {
      let queued = {
        let state = app.state::<AppState>();
        state.spectrogram_queue.next().await
      };
      let cancellation = queued.cancellation;
      let job = queued.job;
      let result = if cancellation.is_cancelled() {
        None
      } else {
        emit_spectrogram_events(
          &app,
          [job.identity.event(SynthesisJobState::Running, None, None)],
        );
        let state = app.state::<AppState>();
        let (subscribe, subscription) = oneshot::channel();
        let synthesis = synthesize_cached(
          &app,
          &state,
          job.request.audio_query,
          job.request.speaker_id,
          None,
          SynthesisBackend::Nonblocking,
          None,
          Some(subscribe),
        );
        let synthesis =
          synthesize_with_sliding_preview(&app, &job.identity, synthesis, subscription);
        match run_cancellable(&cancellation, synthesis).await {
          None => None,
          Some(Err(error)) => Some(Err(error)),
          Some(Ok(wav)) => {
            let extraction = async move {
              tauri::async_runtime::spawn_blocking(move || create_spectrogram_preview(wav))
                .await
                .map_err(|e| format!("Spectrogram task failed: {e}"))?
            };
            run_cancellable(&cancellation, extraction).await
          }
        }
      };

      let is_current = {
        let state = app.state::<AppState>();
        state.spectrogram_queue.finish(&job.identity)
      };
      if !is_current {
        continue;
      }
      let event = match result.expect("an uncancelled spectrogram job must have a result") {
        Ok(preview) => job
          .identity
          .event(SynthesisJobState::Completed, None, Some(preview)),
        Err(error) => job
          .identity
          .event(SynthesisJobState::Failed, Some(error), None),
      };
      emit_spectrogram_events(&app, [event]);
    }
  });
}

/// Queues one item's waveform into a playback feed from wherever it becomes available: a
/// streamed render in progress, whoever started it, or the finished waveform.
struct PlaybackTap<'a> {
  feed: &'a PlaybackFeed,
  start_at: Duration,
  /// Created once the utterance's length and format are known. Shared by the task following
  /// the render and a render this playback takes over.
  cursor: std::sync::Mutex<Option<PlaybackCursor>>,
}

impl<'a> PlaybackTap<'a> {
  fn new(feed: &'a PlaybackFeed, start_at: Duration) -> Self {
    Self {
      feed,
      start_at,
      cursor: std::sync::Mutex::new(None),
    }
  }

  fn with_cursor<T>(
    &self,
    create: impl FnOnce() -> PlaybackCursor,
    use_cursor: impl FnOnce(&mut PlaybackCursor) -> T,
  ) -> T {
    let mut cursor = self
      .cursor
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    use_cursor(cursor.get_or_insert_with(create))
  }

  fn queue(&self, cursor: &PlaybackCursor, pieces: Vec<(Vec<u8>, Duration)>) {
    for (pcm, skip) in pieces {
      self
        .feed
        .pcm(pcm, cursor.sample_rate(), cursor.stereo(), skip);
    }
  }

  /// Queues every newly playable chunk of a render in progress.
  fn queue_progress(&self, progress: &RenderProgress) {
    self.with_cursor(
      || PlaybackCursor::for_progress(progress, self.start_at),
      |cursor| {
        let pieces = cursor.take_available(&progress.chunks);
        self.queue(cursor, pieces);
      },
    );
  }

  /// The frame a render started by this playback begins at: the play position, or the first
  /// frame not queued yet when taking over a render it was following.
  fn start_frame(&self, frame_length: usize, sample_rate: u32, stereo: bool) -> usize {
    self.with_cursor(
      || PlaybackCursor::new(frame_length, sample_rate, stereo, self.start_at),
      |cursor| cursor.next_frame(),
    )
  }

  /// Queues whatever the finished waveform has that is not queued yet.
  fn queue_rest(&self, wav: &[u8]) {
    let Some((sample_rate, stereo, pcm)) = pcm_from_wav(wav) else {
      // Not the core's WAV layout; play it whole unless streaming already queued audio.
      let mut cursor = self
        .cursor
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
      if cursor.is_none() {
        self.feed.wav(wav.to_vec(), self.start_at);
        *cursor = Some(PlaybackCursor::new(0, 24_000, false, Duration::ZERO));
      }
      return;
    };
    let bytes_per_frame = 256 * (sample_rate / 24_000) as usize * if stereo { 4 } else { 2 };
    let frame_length = pcm.len() / bytes_per_frame;
    self.with_cursor(
      || PlaybackCursor::new(frame_length, sample_rate, stereo, self.start_at),
      |cursor| {
        let piece = cursor.take(0..frame_length, pcm).into_iter().collect();
        self.queue(cursor, piece);
      },
    );
  }
}

/// The sample rate, channel layout and PCM of a 16-bit WAV in the core's layout: a 44-byte
/// header at a multiple of 24 kHz.
fn pcm_from_wav(wav: &[u8]) -> Option<(u32, bool, &[u8])> {
  if wav.len() < 44 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" || &wav[36..40] != b"data" {
    return None;
  }
  let channels = u16::from_le_bytes([wav[22], wav[23]]);
  let sample_rate = u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]);
  let bits = u16::from_le_bytes([wav[34], wav[35]]);
  if bits != 16
    || !matches!(channels, 1 | 2)
    || sample_rate == 0
    || !sample_rate.is_multiple_of(24_000)
  {
    return None;
  }
  Some((sample_rate, channels == 2, &wav[44..]))
}

/// Queues a render in progress into `tap` as its chunks are published. Runs until dropped.
async fn follow_render_into_playback(
  mut progress: watch::Receiver<Option<RenderProgress>>,
  tap: &PlaybackTap<'_>,
) -> std::convert::Infallible {
  loop {
    let snapshot = progress.borrow_and_update().clone();
    if let Some(snapshot) = snapshot {
      tap.queue_progress(&snapshot);
    }
    if progress.changed().await.is_err() {
      return std::future::pending().await;
    }
  }
}

fn streaming_synthesis_enabled(state: &AppState) -> bool {
  state
    .config_manager
    .read()
    .ok()
    .and_then(|manager| {
      manager
        .as_ref()
        .map(|manager| manager.getter().ui.streaming_synthesis)
    })
    .unwrap_or(true)
}

/// Renders a waveform chunk by chunk when the style's model supports segmented rendering,
/// publishing each chunk to `progress`. With a playback `tap`, rendering starts at its next
/// frame and the head is rendered last. Returns `None` for models that cannot stream.
///
/// The core task gate is taken per chunk, so other core work interleaves with long renders and
/// dropping the future stops between chunks.
async fn render_streamed(
  state: &AppState,
  generation: u64,
  audio_query: &AudioQuery,
  speaker_id: StyleId,
  backend: SynthesisBackend,
  tap: Option<&PlaybackTap<'_>>,
  progress: &watch::Sender<Option<RenderProgress>>,
) -> Result<Option<Vec<u8>>, String> {
  let audio = match backend {
    SynthesisBackend::Blocking => {
      let query = audio_query.clone();
      run_core_task_at(state, generation, move |core| {
        if !core
          .supports_streaming(speaker_id)
          .map_err(|e| e.to_string())?
        {
          return Ok(None);
        }
        core
          .prepare_streaming(&query, speaker_id)
          .map(Some)
          .map_err(|e| e.to_string())
      })
      .await?
    }
    SynthesisBackend::Nonblocking => {
      let (_permit, core) = acquire_core(state, generation).await?;
      if core.supports_streaming_nonblocking(speaker_id) {
        Some(
          core
            .prepare_streaming_nonblocking(audio_query, speaker_id)
            .await
            .map_err(|e| e.to_string())?,
        )
      } else {
        None
      }
    }
  };
  let Some(audio) = audio else {
    return Ok(None);
  };
  let audio = Arc::new(audio);
  let start_frame = tap.map_or(0, |tap| {
    tap.start_frame(
      audio.frame_length(),
      audio.output_sampling_rate(),
      audio.output_stereo(),
    )
  });
  let plan = StreamPlan::new(audio.frame_length(), DEFAULT_CHUNK_SCHEDULE, start_frame);
  progress.send_replace(Some(RenderProgress::new(
    audio.frame_length(),
    audio.output_sampling_rate(),
    audio.output_stereo(),
  )));
  let _reset_progress = ProgressReset(progress);
  let mut parts: Vec<Arc<Vec<u8>>> = std::iter::repeat_with(Default::default)
    .take(plan.chunks.len())
    .collect();
  for &index in &plan.order {
    let range = plan.chunks[index].clone();
    let chunk_started = Instant::now();
    let pcm = match backend {
      SynthesisBackend::Blocking => {
        let audio = audio.clone();
        run_core_task_at(state, generation, move |core| {
          core
            .render_streaming(&audio, range)
            .map_err(|e| e.to_string())
        })
        .await?
      }
      SynthesisBackend::Nonblocking => {
        let (_permit, core) = acquire_core(state, generation).await?;
        core
          .render_streaming_nonblocking(&audio, range)
          .await
          .map_err(|e| e.to_string())?
      }
    };
    let pcm = Arc::new(pcm);
    progress.send_modify(|progress| {
      if let Some(progress) = progress {
        progress.chunks.push(RenderedChunk {
          frames: plan.chunks[index].clone(),
          pcm: pcm.clone(),
          rendered_in: chunk_started.elapsed(),
        });
      }
    });
    parts[index] = pcm;
  }
  let pcm: Vec<u8> = parts.iter().flat_map(|part| part.iter().copied()).collect();
  Ok(Some(audio.wav(&pcm)))
}

/// Clears published render progress when a streamed render ends: finished, failed or cancelled.
struct ProgressReset<'a>(&'a watch::Sender<Option<RenderProgress>>);

impl Drop for ProgressReset<'_> {
  fn drop(&mut self) {
    self.0.send_replace(None);
  }
}

/// Runs `synthesis` while following its streamed render, whoever started it, with a sliding
/// spectrogram window: columns are revealed a step at a time through
/// [`SpectrogramColumnsEvent`]s, paced over each chunk's render time. Chunks rendered before
/// following started are revealed at once. After a successful render the remaining columns
/// are still revealed at their pace before returning, so the last chunk does not pop.
async fn synthesize_with_sliding_preview<F>(
  app: &AppHandle,
  identity: &SpectrogramJobIdentity,
  synthesis: F,
  subscription: oneshot::Receiver<watch::Receiver<Option<RenderProgress>>>,
) -> Result<Vec<u8>, String>
where
  F: Future<Output = Result<Vec<u8>, String>>,
{
  enum Wake {
    Finished(Result<Vec<u8>, String>),
    Changed(bool),
    Tick,
  }

  let mut synthesis = Box::pin(synthesis);
  // `synthesize_cached` sends the subscription once it has found the cache entry.
  let mut progress = match select(synthesis.as_mut(), subscription).await {
    Either::Left((result, _)) => return result,
    Either::Right((Ok(progress), _)) => Some(progress),
    Either::Right((Err(_), _)) => return synthesis.await,
  };
  let mut sliding: Option<SlidingSpectrogram> = None;
  let mut paced = false;
  let mut finished: Option<Vec<u8>> = None;
  loop {
    let snapshot = progress
      .as_mut()
      .and_then(|progress| progress.borrow_and_update().clone());
    if let Some(snapshot) = snapshot {
      let now = Instant::now();
      let current = sliding
        .take()
        .filter(|sliding| sliding.follows(&snapshot))
        .unwrap_or_else(|| SlidingSpectrogram::new(&snapshot));
      let ingest_paced = paced;
      let ingested = tauri::async_runtime::spawn_blocking(move || {
        let mut current = current;
        current.ingest(&snapshot, now, ingest_paced);
        current
      })
      .await
      .map_err(|e| format!("Spectrogram task failed: {e}"))?;
      sliding = Some(ingested);
    }
    // Chunks seen at the first look were rendered before following started.
    paced = true;

    if let Some(current) = sliding.as_mut() {
      let due = current.due(Instant::now());
      if !due.is_empty() {
        if let Err(error) = identity.columns_event(current, due).emit(app) {
          eprintln!("Failed to emit spectrogram columns: {error}");
        }
      }
    }
    let pending = sliding
      .as_ref()
      .is_some_and(SlidingSpectrogram::has_pending);
    if finished.is_some() && !pending {
      return Ok(finished.take().expect("checked above"));
    }

    let tick = async {
      if pending {
        tokio::time::sleep(SLIDING_TICK).await;
      } else {
        std::future::pending::<()>().await;
      }
      Wake::Tick
    };
    let following = finished.is_none();
    let changed = async {
      match progress.as_mut() {
        Some(progress) if following => Wake::Changed(progress.changed().await.is_ok()),
        _ => std::future::pending().await,
      }
    };
    let completion = async {
      if following {
        Wake::Finished(synthesis.as_mut().await)
      } else {
        std::future::pending().await
      }
    };
    let wake = match select(
      Box::pin(completion),
      select(Box::pin(changed), Box::pin(tick)),
    )
    .await
    {
      Either::Left((wake, _)) => wake,
      Either::Right((Either::Left((wake, _)), _))
      | Either::Right((Either::Right((wake, _)), _)) => wake,
    };
    match wake {
      Wake::Finished(Err(error)) => return Err(error),
      Wake::Finished(Ok(wav)) => {
        finished = Some(wav);
        progress = None;
      }
      // The cache entry was dropped; nothing more will be published.
      Wake::Changed(false) => progress = None,
      Wake::Changed(true) | Wake::Tick => {}
    }
  }
}

/// Synthesizes or retrieves a waveform without holding the shared cache lock during inference.
/// With streaming synthesis enabled, a cache miss on a model that supports it renders in
/// chunks. With a playback `tap`, the waveform is queued for playback as it becomes available,
/// including the chunks of a render another caller already started.
// Each optional observer (owner, playback tap, progress subscription) serves a different caller.
#[allow(clippy::too_many_arguments)]
async fn synthesize_cached(
  app: &AppHandle,
  state: &AppState,
  audio_query: AudioQuery,
  speaker_id: StyleId,
  owner: Option<WaveformCacheOwner>,
  backend: SynthesisBackend,
  tap: Option<&PlaybackTap<'_>>,
  subscribe: Option<oneshot::Sender<watch::Receiver<Option<RenderProgress>>>>,
) -> std::result::Result<Vec<u8>, String> {
  let query_string = serde_json::to_string(&audio_query).map_err(|e| e.to_string())?;
  let generation = state.core_generation.load(Ordering::SeqCst);
  let cache_key = (generation_key(query_string, generation), speaker_id);
  let (cell, evicted) = {
    let mut cache_guard = state.wav_lru.write().await;
    ensure_core_generation(state, generation)?;
    let cache = cache_guard.as_mut().ok_or("wav_lru is not initialized")?;
    if let Some(entry) = cache.get(&cache_key) {
      (entry.cell.clone(), None)
    } else {
      let cell = Arc::new(WaveformCell::default());
      let evicted = cache.push(cache_key.clone(), WaveformCacheEntry::new(cell.clone()));
      (cell, evicted)
    }
  };
  if let Some((_, entry)) = evicted {
    emit_synthesis_events(app, eviction_events(entry));
  }
  if let Some(subscribe) = subscribe {
    let _ = subscribe.send(cell.progress.subscribe());
  }

  let query_for_task = audio_query.clone();
  let progress = &cell.progress;
  let initialization = initialize_waveform_cell(&cell.wav, move || async move {
    // Load the nonblocking model only when this caller renders, so a caller following another
    // render does not take the core gate from it.
    if backend == SynthesisBackend::Nonblocking {
      prepare_nonblocking_synthesis_task(state, speaker_id).await?;
    }
    if streaming_synthesis_enabled(state) {
      if let Some(wav) = render_streamed(
        state,
        generation,
        &query_for_task,
        speaker_id,
        backend,
        tap,
        progress,
      )
      .await?
      {
        return Ok(wav);
      }
    }
    match backend {
      SynthesisBackend::Blocking => {
        run_core_task(state, move |core| {
          core
            .synthesis(&query_for_task, speaker_id)
            .map_err(|e| e.to_string())
        })
        .await
      }
      SynthesisBackend::Nonblocking => {
        run_nonblocking_synthesis_task(state, query_for_task, speaker_id).await
      }
    }
  });
  let wav = match tap {
    None => initialization.await?,
    Some(tap) => {
      // While another caller renders this waveform, play its chunks as they arrive.
      let following = follow_render_into_playback(cell.progress.subscribe(), tap);
      let wav = match select(Box::pin(initialization), Box::pin(following)).await {
        Either::Left((result, _)) => result?,
        Either::Right((never, _)) => match never {},
      };
      tap.queue_rest(&wav);
      wav
    }
  };

  ensure_core_generation(state, generation)?;
  let evicted = {
    let mut cache_guard = state.wav_lru.write().await;
    ensure_core_generation(state, generation)?;
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
  Ok(wav)
}

/// Coalesces waveform and spectrogram consumers of the same cache entry so only one initializer
/// performs inference. If that initializer is cancelled, `OnceCell` leaves the entry empty and a
/// waiting consumer may take over.
async fn initialize_waveform_cell<F, Fut>(
  cell: &OnceCell<Vec<u8>>,
  initialize: F,
) -> Result<Vec<u8>, String>
where
  F: FnOnce() -> Fut,
  Fut: Future<Output = Result<Vec<u8>, String>>,
{
  cell.get_or_try_init(initialize).await.cloned()
}

/// Like [`synthesize_cached`], then applies `post` f0 edits with WORLD when there are any.
/// The base waveform is cached as usual; its WORLD analysis and the edited result are cached
/// in [`post::PostCache`]. Edited items cannot stream, so a playback `tap` gets the finished
/// waveform.
#[allow(clippy::too_many_arguments)]
async fn synthesize_post_processed(
  app: &AppHandle,
  state: &AppState,
  audio_query: AudioQuery,
  speaker_id: StyleId,
  post: Option<&PostEdit>,
  owner: Option<WaveformCacheOwner>,
  backend: SynthesisBackend,
  tap: Option<&PlaybackTap<'_>>,
) -> Result<Vec<u8>, String> {
  let Some(edit) = post.filter(|edit| !edit.is_empty()) else {
    return synthesize_cached(
      app,
      state,
      audio_query,
      speaker_id,
      owner,
      backend,
      tap,
      None,
    )
    .await;
  };
  edit.validate()?;
  let generation = state.core_generation.load(Ordering::SeqCst);
  let key = post_key(&audio_query, speaker_id, generation)?;
  let base = synthesize_cached(
    app,
    state,
    audio_query,
    speaker_id,
    owner,
    backend,
    None,
    None,
  )
  .await?;
  let wav = state
    .post_cache
    .render(&key, base, edit, post_f0_range(speaker_id))
    .await?;
  ensure_core_generation(state, generation)?;
  if let Some(tap) = tap {
    tap.queue_rest(&wav);
  }
  Ok(wav)
}

fn post_key(
  audio_query: &AudioQuery,
  speaker_id: StyleId,
  generation: u64,
) -> Result<post::PostKey, String> {
  let query_string = serde_json::to_string(audio_query).map_err(|e| e.to_string())?;
  Ok((generation_key(query_string, generation), speaker_id))
}

fn post_f0_range(speaker_id: StyleId) -> crate::audio::world::F0Range {
  post::f0_range(style_range(speaker_id))
}

#[tauri::command]
#[specta::specta]
/// Synthesizes (or reuses) the waveform and estimates its frame-level f0 with WORLD for the
/// post-processing tab.
pub async fn analyze_post_f0(
  app: AppHandle,
  state: State<'_, AppState>,
  audio_query: AudioQuery,
  speaker_id: StyleId,
) -> Result<PostF0Analysis, String> {
  let generation = state.core_generation.load(Ordering::SeqCst);
  let key = post_key(&audio_query, speaker_id, generation)?;
  let base = synthesize_cached(
    &app,
    &state,
    audio_query,
    speaker_id,
    None,
    SynthesisBackend::Blocking,
    None,
    None,
  )
  .await?;
  let analysis = state
    .post_cache
    .analysis(&key, base, post_f0_range(speaker_id))
    .await?;
  ensure_core_generation(&state, generation)?;
  Ok(analysis.summary())
}

#[tauri::command]
#[specta::specta]
/// Plays one audio query. With streaming synthesis, playback starts after the first chunk.
pub async fn play_audio(
  app: AppHandle,
  state: State<'_, AppState>,
  audio_query: AudioQuery,
  speaker_id: StyleId,
  post: Option<PostEdit>,
  start_time_seconds: Option<f64>,
) -> std::result::Result<(), String> {
  let start_at = playback_start_duration(start_time_seconds)?;
  let item = AudioSequenceItem {
    audio_query,
    speaker_id,
    post,
  };
  start_playback(app, &state, vec![item], start_at, false).await
}

#[derive(Clone, serde::Deserialize, specta::Type)]
pub struct AudioSequenceItem {
  pub audio_query: AudioQuery,
  pub speaker_id: StyleId,
  /// Post-processing f0 edits applied after synthesis.
  #[serde(default)]
  pub post: Option<PostEdit>,
}

#[tauri::command]
#[specta::specta]
/// Synthesizes and queues multiple audio queries for uninterrupted playback. With streaming
/// synthesis, playback starts after the first chunk and later items render while it plays.
pub async fn play_audio_sequence(
  app: AppHandle,
  state: State<'_, AppState>,
  items: Vec<AudioSequenceItem>,
  start_time_seconds: Option<f64>,
) -> std::result::Result<(), String> {
  if items.is_empty() {
    return Ok(());
  }
  let start_at = playback_start_duration(start_time_seconds)?;
  start_playback(app, &state, items, start_at, true).await
}

/// Starts playing `items` and returns once audio is queued. Rendering continues in a producer
/// task owned by the player, so stopping playback also stops rendering. Errors after playback
/// started are reported through the `audio-playback-failed` event.
async fn start_playback(
  app: AppHandle,
  state: &AppState,
  items: Vec<AudioSequenceItem>,
  start_at: Duration,
  report_items: bool,
) -> Result<(), String> {
  let generation = state.core_generation.load(Ordering::SeqCst);
  let item_started_app = app.clone();
  let finished_app = app.clone();
  let failed_app = app.clone();
  let (mut audio_player, feed) = AudioPlayer::stream(
    move |index| {
      if !report_items {
        return;
      }
      if let Err(error) = item_started_app.emit("audio-sequence-item-started", index) {
        eprintln!("Failed to emit audio sequence progress: {error}");
      }
    },
    move || {
      if let Err(error) = finished_app.emit("audio-playback-finished", ()) {
        eprintln!("Failed to emit playback completion: {error}");
      }
    },
    move |message| {
      if let Err(error) = failed_app.emit("audio-playback-failed", message) {
        eprintln!("Failed to emit playback failure: {error}");
      }
    },
  )
  .await?;
  let producer_app = app.clone();
  let producer = tauri::async_runtime::spawn(async move {
    let state = producer_app.state::<AppState>();
    match feed_playback(&producer_app, &state, items, start_at, &feed).await {
      Ok(()) => feed.finish(),
      Err(error) => feed.fail(error),
    }
  });
  audio_player.attach_producer(producer);
  audio_player.wait_started().await?;
  let _permit = state
    .core_task_gate
    .acquire()
    .await
    .map_err(|e| e.to_string())?;
  ensure_core_generation(state, generation)?;
  state
    .audio_player
    .write()
    .map_err(|e| e.to_string())?
    .replace(audio_player);
  Ok(())
}

/// Synthesizes `items` into `feed`. With streaming synthesis, each item is queued as it renders
/// so playback overlaps synthesis; otherwise every item is synthesized before any plays.
async fn feed_playback(
  app: &AppHandle,
  state: &AppState,
  items: Vec<AudioSequenceItem>,
  start_at: Duration,
  feed: &PlaybackFeed,
) -> Result<(), String> {
  let streaming = streaming_synthesis_enabled(state);
  let mut wavs = Vec::new();
  for (index, item) in items.into_iter().enumerate() {
    // The start position is on the synthesized timeline; time edits move it.
    let item_start = match (index, item.post.as_ref()) {
      (0, Some(post)) if !post.time.is_empty() => {
        post.validate()?;
        Duration::from_secs_f64(post.time_map().to_target(start_at.as_secs_f64()).max(0.0))
      }
      (0, _) => start_at,
      _ => Duration::ZERO,
    };
    if streaming {
      feed.begin_item(index);
    }
    let tap = PlaybackTap::new(feed, item_start);
    let wav = synthesize_post_processed(
      app,
      state,
      item.audio_query,
      item.speaker_id,
      item.post.as_ref(),
      None,
      SynthesisBackend::Blocking,
      streaming.then_some(&tap),
    )
    .await?;
    if !streaming {
      wavs.push((wav, item_start));
    }
  }
  for (index, (wav, item_start)) in wavs.into_iter().enumerate() {
    feed.begin_item(index);
    feed.wav(wav, item_start);
  }
  Ok(())
}

fn playback_start_duration(start_time_seconds: Option<f64>) -> Result<std::time::Duration, String> {
  let Some(seconds) = start_time_seconds else {
    return Ok(std::time::Duration::ZERO);
  };
  std::time::Duration::try_from_secs_f64(seconds)
    .map_err(|_| "Playback start time must be a finite, non-negative number".to_string())
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

fn numbered_audio_path(path: &Path, number: usize) -> PathBuf {
  let mut file_name = path
    .file_stem()
    .unwrap_or_else(|| path.as_os_str())
    .to_os_string();
  file_name.push(format!("({number})"));
  if let Some(extension) = path.extension() {
    file_name.push(".");
    file_name.push(extension);
  }
  path.with_file_name(file_name)
}

fn next_available_audio_path(path: &Path) -> Result<PathBuf, String> {
  if !path.exists() {
    return Ok(path.to_path_buf());
  }

  let mut number = 2usize;
  loop {
    let candidate = numbered_audio_path(path, number);
    if !candidate.exists() {
      return Ok(candidate);
    }
    number = number
      .checked_add(1)
      .ok_or("Could not find an available audio filename")?;
  }
}

#[tauri::command]
#[specta::specta]
pub fn resolve_audio_save_path(path: String) -> Result<String, String> {
  Ok(
    next_available_audio_path(Path::new(&path))?
      .to_string_lossy()
      .into_owned(),
  )
}

fn write_audio_file(
  path: &Path,
  waveform: &[u8],
  prevent_overwrite: bool,
) -> Result<PathBuf, String> {
  if !prevent_overwrite {
    std::fs::write(path, waveform).map_err(|e| e.to_string())?;
    return Ok(path.to_path_buf());
  }

  let mut number = 1usize;
  loop {
    let candidate = if number == 1 {
      path.to_path_buf()
    } else {
      numbered_audio_path(path, number)
    };
    match std::fs::OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&candidate)
    {
      Ok(mut file) => {
        file.write_all(waveform).map_err(|e| e.to_string())?;
        return Ok(candidate);
      }
      Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
        number = number
          .checked_add(1)
          .ok_or("Could not find an available audio filename")?;
      }
      Err(error) => return Err(error.to_string()),
    }
  }
}

/// Extra files written beside an exported WAV, sharing its file stem.
#[derive(Clone, Debug, Default, serde::Deserialize, specta::Type)]
pub struct AudioSidecars {
  /// Text written as a UTF-8 `.txt` file, when set.
  pub text: Option<String>,
  /// Whether to write a `.lab` phoneme timing file for lip sync.
  pub lab: bool,
}

/// Writes the requested sidecar files next to `audio_path`, replacing any
/// existing files with the same names.
fn write_audio_sidecars(
  audio_path: &Path,
  audio_query: &AudioQuery,
  post: Option<&PostEdit>,
  sidecars: &AudioSidecars,
) -> Result<(), String> {
  write_sidecar_files(audio_path, sidecars, || {
    lab_from_audio_query_mapped(audio_query, 0.0, &post_time_map(post))
  })
}

/// Where each point of a synthesized waveform ends up after its post-processing time edits.
fn post_time_map(post: Option<&PostEdit>) -> TimeMap {
  post.map_or_else(TimeMap::identity, PostEdit::time_map)
}

/// Writes the `.txt` and `.lab` sidecars beside `audio_path`, generating the
/// lab text only when it is requested.
fn write_sidecar_files(
  audio_path: &Path,
  sidecars: &AudioSidecars,
  lab: impl FnOnce() -> String,
) -> Result<(), String> {
  let write = |extension: &str, contents: &str| {
    let path = audio_path.with_extension(extension);
    std::fs::write(&path, contents).map_err(|e| format!("{}: {e}", path.display()))
  };
  if let Some(text) = &sidecars.text {
    write("txt", text)?;
  }
  if sidecars.lab {
    write("lab", &lab())?;
  }
  Ok(())
}

/// Lab text for blocks placed one after another in a combined file, with each
/// block's timestamps shifted to where its waveform begins.
fn combined_lab(
  queries: &[AudioQuery],
  posts: &[Option<PostEdit>],
  offsets_seconds: &[f64],
) -> String {
  queries
    .iter()
    .zip(posts)
    .zip(offsets_seconds)
    .map(|((query, post), offset)| {
      lab_from_audio_query_mapped(query, *offset, &post_time_map(post.as_ref()))
    })
    .collect()
}

/// Concatenates the synthesized blocks and writes them as one WAV with
/// combined sidecars. Returns the path actually written.
fn write_combined_audio(
  path: &Path,
  queries: &[AudioQuery],
  posts: &[Option<PostEdit>],
  wavs: &[Vec<u8>],
  prevent_overwrite: bool,
  sidecars: &AudioSidecars,
) -> Result<PathBuf, String> {
  let combined = concatenate_wavs(wavs)?;
  let saved_path = write_audio_file(path, &combined.wav, prevent_overwrite)?;
  write_sidecar_files(&saved_path, sidecars, || {
    combined_lab(queries, posts, &combined.offsets_seconds)
  })?;
  Ok(saved_path)
}

/// Save the audio waveform to a file, plus any requested sidecar files.
#[tauri::command]
#[specta::specta]
pub async fn save_audio(
  app: AppHandle,
  state: State<'_, AppState>,
  path: String,
  audio_query: AudioQuery,
  speaker_id: StyleId,
  post: Option<PostEdit>,
  prevent_overwrite: bool,
  sidecars: AudioSidecars,
) -> std::result::Result<String, String> {
  let waveform = synthesize_post_processed(
    &app,
    &state,
    audio_query.clone(),
    speaker_id,
    post.as_ref(),
    None,
    SynthesisBackend::Blocking,
    None,
  )
  .await?;
  let saved_path = write_audio_file(Path::new(&path), &waveform, prevent_overwrite)?;
  write_audio_sidecars(&saved_path, &audio_query, post.as_ref(), &sidecars)?;
  Ok(saved_path.to_string_lossy().into_owned())
}

/// Synthesizes every item in order and saves them as one combined WAV, plus
/// any requested sidecar files. Each item's configured leading and trailing
/// silence is already part of its waveform, so blocks are joined directly.
/// With `prevent_overwrite`, the file is created exclusively and numbered
/// `(n)` on collision. Returns the path actually written.
#[tauri::command]
#[specta::specta]
pub async fn save_combined_audio(
  app: AppHandle,
  state: State<'_, AppState>,
  path: String,
  items: Vec<AudioSequenceItem>,
  prevent_overwrite: bool,
  sidecars: AudioSidecars,
) -> std::result::Result<String, String> {
  if items.is_empty() {
    return Err("There is no audio to combine".into());
  }
  let mut queries = Vec::with_capacity(items.len());
  let mut posts = Vec::with_capacity(items.len());
  let mut wavs = Vec::with_capacity(items.len());
  for item in items {
    wavs.push(
      synthesize_post_processed(
        &app,
        &state,
        item.audio_query.clone(),
        item.speaker_id,
        item.post.as_ref(),
        None,
        SynthesisBackend::Blocking,
        None,
      )
      .await?,
    );
    queries.push(item.audio_query);
    posts.push(item.post);
  }
  let path = PathBuf::from(path);
  let saved_path = tauri::async_runtime::spawn_blocking(move || {
    write_combined_audio(&path, &queries, &posts, &wavs, prevent_overwrite, &sidecars)
  })
  .await
  .map_err(|e| e.to_string())??;
  Ok(saved_path.to_string_lossy().into_owned())
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
  state.post_cache.clear();
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
  let key = generation_key(query_string, state.core_generation.load(Ordering::SeqCst));
  if let Some(entry) = cache.get(&(key, speaker_id)) {
    if entry.cell.wav.get().is_some() {
      return Ok(SynthState::Done);
    } else {
      return Ok(SynthState::Pending);
    }
  } else {
    return Ok(SynthState::UnInitialized);
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;
  use std::sync::atomic::{AtomicUsize, Ordering};

  fn wav(channels: u16, sample_rate: u32, frames: usize) -> Vec<u8> {
    let mut cursor = Cursor::new(Vec::new());
    {
      let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
      };
      let mut writer = hound::WavWriter::new(&mut cursor, spec).unwrap();
      for frame in 0..frames {
        for channel in 0..channels {
          let phase = 2.0 * std::f64::consts::PI * (220.0 + 220.0 * channel as f64) * frame as f64
            / sample_rate as f64;
          writer.write_sample((phase.sin() * 8_000.0) as i16).unwrap();
        }
      }
      writer.finalize().unwrap();
    }
    cursor.into_inner()
  }

  fn synthesis_request(block_id: &str, hash: &str) -> SynthesisJobRequest {
    SynthesisJobRequest {
      block_id: block_id.into(),
      generation_id: 1,
      audio_query: serde_json::from_value(json!({
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
      .unwrap(),
      speaker_id: StyleId(1),
      hash: hash.into(),
      post: None,
    }
  }

  /// Mono 24 kHz PCM whose every sample holds its frame index.
  fn frame_pcm(frames: std::ops::Range<usize>) -> Vec<u8> {
    frames
      .flat_map(|frame| std::iter::repeat_n((frame as i16).to_le_bytes(), 256).flatten())
      .collect()
  }

  #[test]
  fn playback_follows_another_render_takes_over_and_finishes_from_the_waveform() {
    use crate::audio::player::FeedMessage;
    tauri::async_runtime::block_on(async {
      let (feed, messages) = PlaybackFeed::for_test();
      let tap = PlaybackTap::new(&feed, Duration::ZERO);
      let mut progress = RenderProgress::new(100, 24_000, false);
      progress.chunks.push(RenderedChunk {
        frames: 0..40,
        pcm: Arc::new(frame_pcm(0..40)),
        rendered_in: Duration::ZERO,
      });
      let (publisher, subscription) = watch::channel(Some(progress));
      let following = follow_render_into_playback(subscription, &tap);
      let idle = tokio::time::sleep(Duration::from_millis(20));
      let _ = select(Box::pin(following), Box::pin(idle)).await;
      drop(publisher);

      // A render taken over now continues where following stopped.
      assert_eq!(tap.start_frame(100, 24_000, false), 40);
      tap.queue_rest(&voicevox_core::wav_from_s16le(
        &frame_pcm(0..100),
        24_000,
        false,
      ));
      // A non-core WAV after streaming started is not queued again.
      tap.queue_rest(b"not a wave file");

      let queued: Vec<i16> = messages
        .try_iter()
        .flat_map(|message| match message {
          FeedMessage::Pcm { pcm, skip, .. } => {
            assert_eq!(skip, Duration::ZERO);
            let (samples, _) = pcm.as_chunks::<2>();
            samples
              .iter()
              .step_by(256)
              .map(|sample| i16::from_le_bytes(*sample))
              .collect::<Vec<_>>()
          }
          other => panic!("unexpected feed message {other:?}"),
        })
        .collect();
      assert_eq!(queued, (0..100).collect::<Vec<i16>>());
    });
  }

  #[test]
  fn playback_of_an_unrecognized_waveform_queues_it_whole_once() {
    use crate::audio::player::FeedMessage;
    let (feed, messages) = PlaybackFeed::for_test();
    let tap = PlaybackTap::new(&feed, Duration::from_millis(5));
    tap.queue_rest(b"not a wave file");
    tap.queue_rest(b"not a wave file");
    let queued: Vec<FeedMessage> = messages.try_iter().collect();
    assert_eq!(queued.len(), 1);
    assert!(matches!(
      &queued[0],
      FeedMessage::Wav { skip, .. } if *skip == Duration::from_millis(5)
    ));
  }

  #[test]
  fn core_wavs_are_recognized_and_other_layouts_are_not() {
    let wav = voicevox_core::wav_from_s16le(&[1, 0, 2, 0], 48_000, true);
    assert_eq!(
      pcm_from_wav(&wav),
      Some((48_000, true, &[1u8, 0, 2, 0][..]))
    );
    assert_eq!(pcm_from_wav(&wav[..40]), None);
    assert_eq!(
      pcm_from_wav(&voicevox_core::wav_from_s16le(&[], 44_100, false)),
      None
    );
  }

  #[test]
  fn synthesis_request_validation_rejects_blank_identifiers() {
    assert_eq!(
      validate_synthesis_request(&synthesis_request(" ", "hash")),
      Err("block_id must not be empty".into())
    );
    assert_eq!(
      validate_synthesis_request(&synthesis_request("block", "\n")),
      Err("hash must not be empty".into())
    );
    assert!(validate_synthesis_request(&synthesis_request("block", "hash")).is_ok());
  }

  #[test]
  fn audio_sidecars_share_the_saved_audio_stem() {
    let directory = tempfile::tempdir().unwrap();
    let audio = directory.path().join("voice.sample(2).wav");
    let query: AudioQuery = serde_json::from_value(serde_json::json!({
      "accent_phrases": [],
      "speedScale": 1.0,
      "pitchScale": 0.0,
      "intonationScale": 1.0,
      "volumeScale": 1.0,
      "prePhonemeLength": 0.1,
      "postPhonemeLength": 0.1,
      "outputSamplingRate": 24000,
      "outputStereo": false,
      "kana": null
    }))
    .unwrap();

    write_audio_sidecars(&audio, &query, None, &AudioSidecars::default()).unwrap();
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);

    let sidecars = AudioSidecars {
      text: Some("こんにちは".into()),
      lab: true,
    };
    write_audio_sidecars(&audio, &query, None, &sidecars).unwrap();
    assert_eq!(
      std::fs::read_to_string(directory.path().join("voice.sample(2).txt")).unwrap(),
      "こんにちは"
    );
    assert_eq!(
      std::fs::read_to_string(directory.path().join("voice.sample(2).lab")).unwrap(),
      "0 1000000 pau\n1000000 2000000 pau\n"
    );

    let blocked = directory.path().join("blocked.wav");
    std::fs::create_dir(blocked.with_extension("txt")).unwrap();
    let error = write_audio_sidecars(&blocked, &query, None, &sidecars).unwrap_err();
    assert!(error.contains("blocked.txt"), "{error}");
  }

  fn silent_query(pre: f32, post: f32) -> AudioQuery {
    serde_json::from_value(json!({
      "accent_phrases": [],
      "speedScale": 1.0,
      "pitchScale": 0.0,
      "intonationScale": 1.0,
      "volumeScale": 1.0,
      "prePhonemeLength": pre,
      "postPhonemeLength": post,
      "outputSamplingRate": 24000,
      "outputStereo": false,
      "kana": null
    }))
    .unwrap()
  }

  #[test]
  fn combined_lab_offsets_each_block_by_its_waveform_start() {
    let queries = [silent_query(0.1, 0.1), silent_query(0.2, 0.3)];
    assert_eq!(
      combined_lab(&queries, &[None, None], &[0.0, 0.25]),
      "0 1000000 pau\n1000000 2000000 pau\n\
       2500000 4500000 pau\n4500000 7500000 pau\n"
    );
  }

  #[test]
  fn combined_audio_writes_one_wav_with_combined_sidecars() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("project.wav");
    let queries = [silent_query(0.1, 0.1), silent_query(0.1, 0.1)];
    let wavs = [wav(1, 24_000, 4_800), wav(1, 24_000, 2_400)];
    let sidecars = AudioSidecars {
      text: Some("一\n二".into()),
      lab: true,
    };

    let saved =
      write_combined_audio(&path, &queries, &[None, None], &wavs, true, &sidecars).unwrap();
    assert_eq!(saved, path);
    let reader = hound::WavReader::open(&saved).unwrap();
    assert_eq!(reader.spec().sample_rate, 24_000);
    assert_eq!(reader.duration(), 7_200);
    assert_eq!(
      std::fs::read_to_string(directory.path().join("project.txt")).unwrap(),
      "一\n二"
    );
    let lab = std::fs::read_to_string(directory.path().join("project.lab")).unwrap();
    assert!(lab.contains("\n2000000 3000000 pau\n"), "{lab}");

    let error = write_combined_audio(
      &directory.path().join("mismatch.wav"),
      &queries,
      &[None, None],
      &[wav(1, 24_000, 10), wav(1, 48_000, 10)],
      true,
      &AudioSidecars::default(),
    )
    .unwrap_err();
    assert!(error.contains("sample rate"), "{error}");
    assert!(!directory.path().join("mismatch.wav").exists());
  }

  #[test]
  fn silent_combined_export_numbers_existing_files_exclusively() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("project.wav");
    std::fs::write(&path, b"existing").unwrap();
    let queries = [silent_query(0.1, 0.1)];
    let wavs = [wav(1, 24_000, 10)];
    let sidecars = AudioSidecars {
      text: Some("text".into()),
      lab: false,
    };

    let second = write_combined_audio(&path, &queries, &[None], &wavs, true, &sidecars).unwrap();
    let third = write_combined_audio(&path, &queries, &[None], &wavs, true, &sidecars).unwrap();
    assert_eq!(second, directory.path().join("project(2).wav"));
    assert_eq!(third, directory.path().join("project(3).wav"));
    assert_eq!(std::fs::read(&path).unwrap(), b"existing");
    assert!(directory.path().join("project(2).txt").exists());
    assert!(!directory.path().join("project(2).lab").exists());

    let overwritten =
      write_combined_audio(&path, &queries, &[None], &wavs, false, &sidecars).unwrap();
    assert_eq!(overwritten, path);
    assert_ne!(std::fs::read(&path).unwrap(), b"existing");
  }

  #[test]
  fn prevent_overwrite_uses_numbered_audio_paths() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("voice.sample.wav");

    let first = write_audio_file(&path, b"first", true).unwrap();
    assert_eq!(
      next_available_audio_path(&path).unwrap(),
      directory.path().join("voice.sample(2).wav")
    );
    let second = write_audio_file(&path, b"second", true).unwrap();
    assert_eq!(
      next_available_audio_path(&path).unwrap(),
      directory.path().join("voice.sample(3).wav")
    );
    let third = write_audio_file(&path, b"third", true).unwrap();

    assert_eq!(first, path);
    assert_eq!(second, directory.path().join("voice.sample(2).wav"));
    assert_eq!(third, directory.path().join("voice.sample(3).wav"));
    assert_eq!(std::fs::read(&first).unwrap(), b"first");
    assert_eq!(std::fs::read(&second).unwrap(), b"second");
    assert_eq!(std::fs::read(&third).unwrap(), b"third");

    let overwritten = write_audio_file(&path, b"replacement", false).unwrap();
    assert_eq!(overwritten, path);
    assert_eq!(std::fs::read(overwritten).unwrap(), b"replacement");
  }

  #[test]
  fn waveform_and_spectrogram_consumers_share_one_in_flight_cache_initialization() {
    tauri::async_runtime::block_on(async {
      let cell = Arc::new(OnceCell::new());
      let initialization_count = Arc::new(AtomicUsize::new(0));
      let (started_tx, started_rx) = tokio::sync::oneshot::channel();
      let (release_tx, release_rx) = tokio::sync::oneshot::channel();

      let waveform_cell = cell.clone();
      let waveform_count = initialization_count.clone();
      let waveform = tauri::async_runtime::spawn(async move {
        initialize_waveform_cell(&waveform_cell, || async move {
          waveform_count.fetch_add(1, Ordering::SeqCst);
          started_tx.send(()).unwrap();
          release_rx.await.unwrap();
          Ok(vec![1, 2, 3])
        })
        .await
      });
      started_rx.await.unwrap();

      let preview_cell = cell.clone();
      let preview_count = initialization_count.clone();
      let preview = tauri::async_runtime::spawn(async move {
        initialize_waveform_cell(&preview_cell, || async move {
          preview_count.fetch_add(1, Ordering::SeqCst);
          Ok(vec![9, 9, 9])
        })
        .await
      });
      tokio::task::yield_now().await;
      release_tx.send(()).unwrap();

      assert_eq!(waveform.await.unwrap().unwrap(), vec![1, 2, 3]);
      assert_eq!(preview.await.unwrap().unwrap(), vec![1, 2, 3]);
      assert_eq!(initialization_count.load(Ordering::SeqCst), 1);
    });
  }

  #[test]
  fn spectrogram_preview_is_compact_normalized_and_duration_aware() {
    let preview = create_spectrogram_preview(wav(1, 24_000, 12_000)).unwrap();

    assert_eq!(preview.mel_bins, 96);
    assert!(preview.frame_count > 1);
    assert_eq!(preview.values.len(), preview.frame_count * preview.mel_bins);
    assert!((preview.duration_seconds - 0.5).abs() < 1e-6);
    assert!(preview.values.iter().any(|value| *value > 0));
  }

  #[test]
  fn spectrogram_preview_downmixes_stereo_and_handles_short_audio() {
    let stereo = create_spectrogram_preview(wav(2, 48_000, 48)).unwrap();

    assert_eq!(stereo.frame_count, 1);
    assert_eq!(stereo.values.len(), 96);
    assert!((stereo.duration_seconds - 0.001).abs() < 1e-9);
  }

  #[test]
  fn playback_start_duration_accepts_unset_and_rejects_invalid_values() {
    assert_eq!(
      playback_start_duration(None).unwrap(),
      std::time::Duration::ZERO
    );
    assert_eq!(
      playback_start_duration(Some(1.25)).unwrap(),
      std::time::Duration::from_millis(1250)
    );
    for invalid in [f64::NAN, f64::INFINITY, -0.1] {
      assert!(playback_start_duration(Some(invalid)).is_err());
    }
  }

  #[test]
  fn spectrogram_preview_rejects_malformed_wav_data() {
    let error = create_spectrogram_preview(b"not a wave file".to_vec()).unwrap_err();

    assert!(error.contains("Failed to decode WAV audio"));
  }
}
