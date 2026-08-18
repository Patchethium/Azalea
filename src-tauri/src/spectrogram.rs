use std::io::Cursor;

use ndarray::Array1;
use rodio::Source;
use serde::{Deserialize, Serialize};
use voicevox_core::{AudioQuery, StyleId};

use crate::async_job::{LatestJob, LatestJobQueue, QueueEvent, QueueEventState, QueuedJob};
use crate::audio::spectal::MelSpec;
use crate::synthesis::SynthesisJobState;

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SpectrogramJobRequest {
  pub block_id: String,
  pub generation_id: u64,
  pub audio_query: AudioQuery,
  pub speaker_id: StyleId,
  pub hash: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpectrogramPreview {
  pub values: Vec<u8>,
  pub frame_count: usize,
  pub mel_bins: usize,
  pub duration_seconds: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct SpectrogramJobEvent {
  pub block_id: String,
  pub generation_id: u64,
  pub hash: String,
  pub state: SynthesisJobState,
  pub error: Option<String>,
  pub preview: Option<SpectrogramPreview>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SpectrogramJobIdentity {
  pub block_id: String,
  pub generation_id: u64,
  pub hash: String,
  pub query_key: String,
  pub speaker_id: StyleId,
}

impl SpectrogramJobIdentity {
  pub fn event(
    &self,
    state: SynthesisJobState,
    error: Option<String>,
    preview: Option<SpectrogramPreview>,
  ) -> SpectrogramJobEvent {
    SpectrogramJobEvent {
      block_id: self.block_id.clone(),
      generation_id: self.generation_id,
      hash: self.hash.clone(),
      state,
      error,
      preview,
    }
  }
}

#[derive(Clone)]
pub(crate) struct SpectrogramJob {
  pub request: SpectrogramJobRequest,
  pub identity: SpectrogramJobIdentity,
}

impl SpectrogramJob {
  pub fn new(request: SpectrogramJobRequest, query_key: String) -> Self {
    let identity = SpectrogramJobIdentity {
      block_id: request.block_id.clone(),
      generation_id: request.generation_id,
      hash: request.hash.clone(),
      query_key,
      speaker_id: request.speaker_id,
    };
    Self { request, identity }
  }
}

impl LatestJob for SpectrogramJob {
  type Key = String;
  type Identity = SpectrogramJobIdentity;

  fn key(&self) -> &Self::Key {
    &self.identity.block_id
  }

  fn generation_id(&self) -> u64 {
    self.identity.generation_id
  }

  fn identity(&self) -> &Self::Identity {
    &self.identity
  }
}

fn spectrogram_queue_event(event: QueueEvent<SpectrogramJobIdentity>) -> SpectrogramJobEvent {
  let state = match event.state {
    QueueEventState::Queued => SynthesisJobState::Queued,
    QueueEventState::Running => SynthesisJobState::Running,
    QueueEventState::Cancelled => SynthesisJobState::Cancelled,
    QueueEventState::Evicted => SynthesisJobState::Evicted,
  };
  event.identity.event(state, None, None)
}

pub(crate) struct SpectrogramQueue(LatestJobQueue<SpectrogramJob>);

impl Default for SpectrogramQueue {
  fn default() -> Self {
    Self(LatestJobQueue::default())
  }
}

impl SpectrogramQueue {
  pub fn enqueue(&self, job: SpectrogramJob) -> Vec<SpectrogramJobEvent> {
    self
      .0
      .enqueue(job)
      .into_iter()
      .map(spectrogram_queue_event)
      .collect()
  }

  pub async fn next(&self) -> QueuedJob<SpectrogramJob> {
    self.0.next().await
  }

  #[cfg(test)]
  fn pop_next(&self) -> Option<QueuedJob<SpectrogramJob>> {
    self.0.pop_next()
  }

  pub fn finish(&self, identity: &SpectrogramJobIdentity) -> bool {
    self.0.finish(identity)
  }

  pub fn cancel(&self, block_id: &str, generation_id: Option<u64>) -> Vec<SpectrogramJobEvent> {
    self
      .0
      .cancel(&block_id.to_owned(), generation_id)
      .into_iter()
      .map(spectrogram_queue_event)
      .collect()
  }
}

pub(crate) fn validate_spectrogram_request(request: &SpectrogramJobRequest) -> Result<(), String> {
  if request.block_id.trim().is_empty() {
    return Err("block_id must not be empty".into());
  }
  if request.hash.trim().is_empty() {
    return Err("hash must not be empty".into());
  }
  Ok(())
}

pub(crate) fn create_spectrogram_preview(wav: Vec<u8>) -> Result<SpectrogramPreview, String> {
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

#[cfg(test)]
mod tests {
  use serde_json::json;

  use super::*;

  fn request(block_id: &str, generation_id: u64, hash: &str) -> SpectrogramJobRequest {
    SpectrogramJobRequest {
      block_id: block_id.into(),
      generation_id,
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
    }
  }

  #[test]
  fn request_validation_rejects_blank_identifiers() {
    assert_eq!(
      validate_spectrogram_request(&request(" ", 1, "hash")),
      Err("block_id must not be empty".into())
    );
    assert_eq!(
      validate_spectrogram_request(&request("block", 1, "\n")),
      Err("hash must not be empty".into())
    );
    assert!(validate_spectrogram_request(&request("block", 1, "hash")).is_ok());
  }

  #[test]
  fn newer_preview_cancels_running_and_pending_generations_for_the_same_block() {
    let queue = SpectrogramQueue::default();
    let job = |generation_id| {
      let request = request("block", generation_id, &format!("hash-{generation_id}"));
      let query_key = serde_json::to_string(&request.audio_query).unwrap();
      SpectrogramJob::new(request, query_key)
    };
    queue.enqueue(job(1));
    let running = queue.pop_next().unwrap();

    let second_events = queue.enqueue(job(2));
    let third_events = queue.enqueue(job(3));

    assert_eq!(second_events.len(), 2);
    assert_eq!(second_events[0].generation_id, 1);
    assert_eq!(second_events[0].state, SynthesisJobState::Cancelled);
    assert_eq!(second_events[1].generation_id, 2);
    assert_eq!(second_events[1].state, SynthesisJobState::Queued);
    assert_eq!(third_events.len(), 2);
    assert_eq!(third_events[0].generation_id, 2);
    assert_eq!(third_events[0].state, SynthesisJobState::Cancelled);
    assert_eq!(third_events[1].generation_id, 3);
    assert_eq!(third_events[1].state, SynthesisJobState::Queued);
    assert!(running.cancellation.is_cancelled());
    assert!(!queue.finish(&running.job.identity));
    assert_eq!(queue.pop_next().unwrap().job.identity.generation_id, 3);
  }
}
