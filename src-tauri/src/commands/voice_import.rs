//! Voice import: recording from the microphone, and loading, aligning and
//! playing the voices of the voice tab (see [`crate::voice_import`]). Voices
//! live for the session only, by ID.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tauri_specta::Event;
use voicevox_core::AccentPhrase;

use crate::audio::decode::{decode_file, MonoAudio};
use crate::audio::record::Recording;
use crate::audio::AudioPlayer;
use crate::post::PostF0Analysis;
use crate::voice_import::{PreparedVoice, VoiceSegment};
use crate::AppState;

/// Voices kept at once; the least recently used one is dropped beyond it.
const VOICE_LIMIT: usize = 32;

/// The running recording and the loaded voices.
pub struct VoiceRecorder {
  recording: Option<Recording>,
  voices: lru::LruCache<String, Arc<PreparedVoice>>,
}

impl Default for VoiceRecorder {
  fn default() -> Self {
    Self {
      recording: None,
      voices: lru::LruCache::new(NonZeroUsize::new(VOICE_LIMIT).unwrap()),
    }
  }
}

pub(crate) type VoiceRecorderState = Mutex<VoiceRecorder>;

/// The microphone level while recording, about every 50 ms.
#[derive(Clone, Serialize, Deserialize, Type, Event)]
pub struct VoiceRecordingLevelEvent {
  /// Peak absolute sample since the previous event, in `[0, 1]`.
  pub peak: f32,
  pub seconds: f64,
  /// The recording reached its 60-second limit; stop it to keep what it has.
  pub full: bool,
}

/// A loaded voice: its ID for the other voice commands, and its trimmed
/// recording's f0 and spectrogram.
#[derive(Clone, Serialize, Type)]
pub struct LoadedVoice {
  pub voice_id: String,
  pub analysis: PostF0Analysis,
}

fn voice(state: &AppState, voice_id: &str) -> Result<Arc<PreparedVoice>, String> {
  state
    .voice_recorder
    .lock()
    .map_err(|e| e.to_string())?
    .voices
    .get(voice_id)
    .cloned()
    .ok_or_else(|| "The voice is no longer loaded".to_string())
}

async fn load(state: &AppState, audio: MonoAudio) -> Result<LoadedVoice, String> {
  let (voice, analysis) = tauri::async_runtime::spawn_blocking(move || {
    let voice = PreparedVoice::prepare(&audio)?;
    let analysis = voice.analysis();
    Ok::<_, String>((voice, analysis))
  })
  .await
  .map_err(|e| e.to_string())??;
  let voice_id = uuid::Uuid::new_v4().to_string();
  state
    .voice_recorder
    .lock()
    .map_err(|e| e.to_string())?
    .voices
    .put(voice_id.clone(), Arc::new(voice));
  Ok(LoadedVoice { voice_id, analysis })
}

/// Starts recording from the default microphone.
#[tauri::command]
#[specta::specta]
pub async fn start_voice_recording(
  app: AppHandle,
  state: State<'_, AppState>,
) -> Result<(), String> {
  if state
    .voice_recorder
    .lock()
    .map_err(|e| e.to_string())?
    .recording
    .is_some()
  {
    return Err("A recording is already running".into());
  }
  let recording = tauri::async_runtime::spawn_blocking(move || {
    Recording::start(move |level| {
      let _ = VoiceRecordingLevelEvent {
        peak: level.peak,
        seconds: level.seconds,
        full: level.full,
      }
      .emit(&app);
    })
  })
  .await
  .map_err(|e| e.to_string())??;
  let mut recorder = state.voice_recorder.lock().map_err(|e| e.to_string())?;
  if recorder.recording.is_some() {
    return Err("A recording is already running".into());
  }
  recorder.recording = Some(recording);
  Ok(())
}

/// Stops recording and loads the recording as a voice.
#[tauri::command]
#[specta::specta]
pub async fn stop_voice_recording(state: State<'_, AppState>) -> Result<LoadedVoice, String> {
  let recording = state
    .voice_recorder
    .lock()
    .map_err(|e| e.to_string())?
    .recording
    .take()
    .ok_or("No recording is running")?;
  let audio = tauri::async_runtime::spawn_blocking(move || recording.finish())
    .await
    .map_err(|e| e.to_string())??;
  load(&state, audio).await
}

/// Stops recording and discards it.
#[tauri::command]
#[specta::specta]
pub async fn cancel_voice_recording(state: State<'_, AppState>) -> Result<(), String> {
  let recording = state
    .voice_recorder
    .lock()
    .map_err(|e| e.to_string())?
    .recording
    .take();
  drop(recording);
  Ok(())
}

/// Loads an audio file as a voice.
#[tauri::command]
#[specta::specta]
pub async fn load_voice_file(
  state: State<'_, AppState>,
  path: String,
) -> Result<LoadedVoice, String> {
  let audio = tauri::async_runtime::spawn_blocking(move || decode_file(&PathBuf::from(path)))
    .await
    .map_err(|e| e.to_string())??;
  load(&state, audio).await
}

/// Times the phonemes of `accent_phrases` (a block's current query) in the
/// voice, with an edge pause before and after them.
#[tauri::command]
#[specta::specta]
pub async fn align_voice(
  state: State<'_, AppState>,
  voice_id: String,
  accent_phrases: Vec<AccentPhrase>,
) -> Result<Vec<VoiceSegment>, String> {
  let voice = voice(&state, &voice_id)?;
  tauri::async_runtime::spawn_blocking(move || voice.align(&accent_phrases))
    .await
    .map_err(|e| e.to_string())?
}

/// `accent_phrases` with the lengths of `segments` and the speaker's own
/// pitch (natural-log f0, 0 for unvoiced moras), before range mapping.
#[tauri::command]
#[specta::specta]
pub async fn voice_accent_phrases(
  state: State<'_, AppState>,
  voice_id: String,
  accent_phrases: Vec<AccentPhrase>,
  segments: Vec<VoiceSegment>,
) -> Result<Vec<AccentPhrase>, String> {
  let voice = voice(&state, &voice_id)?;
  tauri::async_runtime::spawn_blocking(move || voice.accent_phrases(accent_phrases, &segments))
    .await
    .map_err(|e| e.to_string())?
}

/// Plays the voice's trimmed recording from `start_time_seconds`, replacing
/// any playback. Completion is reported like block playback, through
/// `audio-playback-finished`.
#[tauri::command]
#[specta::specta]
pub async fn play_voice(
  app: AppHandle,
  state: State<'_, AppState>,
  voice_id: String,
  start_time_seconds: Option<f64>,
) -> Result<(), String> {
  let start_at = match start_time_seconds {
    Some(seconds) => Duration::try_from_secs_f64(seconds)
      .map_err(|_| "Playback start time must be a finite, non-negative number".to_string())?,
    None => Duration::ZERO,
  };
  let voice = voice(&state, &voice_id)?;
  let wav = tauri::async_runtime::spawn_blocking(move || voice.wav())
    .await
    .map_err(|e| e.to_string())??;
  let previous = state
    .audio_player
    .write()
    .map_err(|e| e.to_string())?
    .take();
  if let Some(previous) = previous {
    previous.stop().await;
  }
  let player = AudioPlayer::play(wav, start_at, move || {
    if let Err(error) = app.emit("audio-playback-finished", ()) {
      eprintln!("Failed to emit playback completion: {error}");
    }
  })
  .await?;
  state
    .audio_player
    .write()
    .map_err(|e| e.to_string())?
    .replace(player);
  Ok(())
}

/// Forgets a voice.
#[tauri::command]
#[specta::specta]
pub async fn remove_voice(state: State<'_, AppState>, voice_id: String) -> Result<(), String> {
  state
    .voice_recorder
    .lock()
    .map_err(|e| e.to_string())?
    .voices
    .pop(&voice_id);
  Ok(())
}
