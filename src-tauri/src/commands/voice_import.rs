//! Voice import: recording from the microphone, and aligning a recording or an
//! audio file to a block's query (see [`crate::voice_import`]).

use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_specta::Event;
use voicevox_core::AccentPhrase;

use crate::audio::decode::{decode_file, MonoAudio};
use crate::audio::record::Recording;
use crate::voice_import::{import_voice, VoiceImport};
use crate::AppState;

/// The running recording, and the last finished one, which analysis reads.
#[derive(Default)]
pub struct VoiceRecorder {
  recording: Option<Recording>,
  recorded: Option<MonoAudio>,
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

/// Where the voice to import comes from.
#[derive(Clone, Debug, Deserialize, Type)]
pub enum VoiceSource {
  /// The last finished recording.
  Recording,
  /// An audio file the user picked.
  File(String),
}

/// Starts recording from the default microphone, discarding any earlier
/// recording.
#[tauri::command]
#[specta::specta]
pub async fn start_voice_recording(
  app: AppHandle,
  state: State<'_, AppState>,
) -> Result<(), String> {
  {
    let mut recorder = state.voice_recorder.lock().map_err(|e| e.to_string())?;
    if recorder.recording.is_some() {
      return Err("A recording is already running".into());
    }
    recorder.recorded = None;
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

/// Stops recording, keeps the audio for analysis and returns its length in
/// seconds.
#[tauri::command]
#[specta::specta]
pub async fn stop_voice_recording(state: State<'_, AppState>) -> Result<f64, String> {
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
  let seconds = audio.seconds();
  state
    .voice_recorder
    .lock()
    .map_err(|e| e.to_string())?
    .recorded = Some(audio);
  Ok(seconds)
}

/// Stops recording and discards the running and the last recording.
#[tauri::command]
#[specta::specta]
pub async fn cancel_voice_recording(state: State<'_, AppState>) -> Result<(), String> {
  let recording = {
    let mut recorder = state.voice_recorder.lock().map_err(|e| e.to_string())?;
    recorder.recorded = None;
    recorder.recording.take()
  };
  drop(recording);
  Ok(())
}

/// Aligns the voice to `accent_phrases` (a block's current query) and returns
/// them with the voice's timing and unmapped pitch.
#[tauri::command]
#[specta::specta]
pub async fn analyze_voice_import(
  state: State<'_, AppState>,
  source: VoiceSource,
  accent_phrases: Vec<AccentPhrase>,
) -> Result<VoiceImport, String> {
  let recorded = match &source {
    VoiceSource::Recording => Some(
      state
        .voice_recorder
        .lock()
        .map_err(|e| e.to_string())?
        .recorded
        .clone()
        .ok_or("Nothing has been recorded")?,
    ),
    VoiceSource::File(_) => None,
  };
  tauri::async_runtime::spawn_blocking(move || {
    let audio = match (recorded, source) {
      (Some(audio), _) => audio,
      (None, VoiceSource::File(path)) => decode_file(&PathBuf::from(path))?,
      (None, VoiceSource::Recording) => unreachable!("recordings are read above"),
    };
    import_voice(&audio, accent_phrases)
  })
  .await
  .map_err(|e| e.to_string())?
}
