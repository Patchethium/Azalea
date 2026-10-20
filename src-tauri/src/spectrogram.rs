use std::collections::VecDeque;
use std::io::Cursor;
use std::ops::Range;
use std::time::{Duration, Instant};

use ndarray::Array1;
use rodio::Source;
use serde::{Deserialize, Serialize};
use voicevox_core::{AudioQuery, StyleId};

use crate::async_job::{LatestJob, LatestJobQueue, QueueEvent, QueueEventState, QueuedJob};
use crate::audio::spectal::MelSpec;
use crate::streaming::RenderProgress;
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

/// Columns of a spectrogram preview revealed while a streamed render is in progress. Decibels
/// are raw: the frontend normalizes them to its loudest revealed column, as the finished
/// preview is normalized to its loudest column.
#[derive(Clone, Debug, Deserialize, Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct SpectrogramColumnsEvent {
  pub block_id: String,
  pub generation_id: u64,
  pub hash: String,
  /// Columns, mel bins and duration of the finished preview.
  pub frame_count: usize,
  pub mel_bins: usize,
  pub duration_seconds: f64,
  pub columns: Vec<usize>,
  /// `mel_bins` decibels per entry of `columns`, in the same order, lowest bin first.
  pub decibels: Vec<f32>,
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
  pub fn columns_event(
    &self,
    sliding: &SlidingSpectrogram,
    columns: Vec<(usize, Vec<f64>)>,
  ) -> SpectrogramColumnsEvent {
    let mut indices = Vec::with_capacity(columns.len());
    let mut decibels = Vec::with_capacity(columns.len() * MEL_BINS);
    for (column, values) in columns {
      indices.push(column);
      decibels.extend(values.into_iter().map(|db| db as f32));
    }
    SpectrogramColumnsEvent {
      block_id: self.block_id.clone(),
      generation_id: self.generation_id,
      hash: self.hash.clone(),
      frame_count: sliding.frame_count,
      mel_bins: MEL_BINS,
      duration_seconds: sliding.duration_seconds,
      columns: indices,
      decibels,
    }
  }

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

  /// Drops work orphaned by a previous frontend session and resets generation tracking.
  pub fn discard_all(&self) -> Vec<SpectrogramJobEvent> {
    self
      .0
      .discard_all()
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

const FFT_SIZE: usize = 1024;
const MEL_BINS: usize = 96;
const HOP_LENGTH: usize = 256;
const DYNAMIC_RANGE_DB: f64 = 80.;

fn downmix(frame: &[i16]) -> f64 {
  frame.iter().map(|sample| *sample as f64).sum::<f64>() / (frame.len() as f64 * i16::MAX as f64)
}

pub(crate) fn create_spectrogram_preview(wav: Vec<u8>) -> Result<SpectrogramPreview, String> {
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
    .map(downmix)
    .collect::<Array1<_>>();
  Ok(preview_from_mono(mono, sample_rate))
}

/// Columns revealed per sliding-window step.
pub(crate) const SLIDING_STEP_COLUMNS: usize = 2;
/// Steps that fall due within one display frame are sent together.
pub(crate) const SLIDING_TICK: Duration = Duration::from_millis(16);

/// Follows a streamed render with a sliding STFT window. Each chunk completes some windows;
/// only those columns are computed, then revealed [`SLIDING_STEP_COLUMNS`] at a time, spread
/// over the time the chunk took to render, so the preview fills smoothly about one chunk
/// behind the render instead of jumping a whole chunk at once.
pub(crate) struct SlidingSpectrogram {
  extractor: MelSpec,
  frame_length: usize,
  sample_rate: u32,
  stereo: bool,
  mono: Vec<f64>,
  /// Rendered sample ranges, sorted and merged.
  rendered: Vec<Range<usize>>,
  computed: Vec<bool>,
  /// Computed columns not revealed yet, with their decibels, in reveal order.
  pending: VecDeque<(usize, Vec<f64>)>,
  ingested_chunks: usize,
  /// When every pending column should be revealed.
  deadline: Option<Instant>,
  pub frame_count: usize,
  pub duration_seconds: f64,
}

impl SlidingSpectrogram {
  pub fn new(progress: &RenderProgress) -> Self {
    let total = progress.frame_length * progress.samples_per_frame();
    let extractor = MelSpec::new(
      FFT_SIZE,
      MEL_BINS,
      HOP_LENGTH,
      progress.sample_rate as usize,
    );
    let frame_count = extractor.frame_count(total);
    Self {
      extractor,
      frame_length: progress.frame_length,
      sample_rate: progress.sample_rate,
      stereo: progress.stereo,
      mono: vec![0.; total],
      rendered: Vec::new(),
      computed: vec![false; frame_count],
      pending: VecDeque::new(),
      ingested_chunks: 0,
      deadline: None,
      frame_count,
      duration_seconds: total as f64 / progress.sample_rate as f64,
    }
  }

  /// Whether `progress` continues the render this window follows, rather than a new one.
  pub fn follows(&self, progress: &RenderProgress) -> bool {
    progress.frame_length == self.frame_length
      && progress.sample_rate == self.sample_rate
      && progress.stereo == self.stereo
      && progress.chunks.len() >= self.ingested_chunks
  }

  /// Adds the chunks rendered since the last call and computes the columns whose window they
  /// complete. With `paced`, each chunk's columns are revealed over its render time; otherwise
  /// (chunks rendered before following started) they are due at once.
  pub fn ingest(&mut self, progress: &RenderProgress, now: Instant, paced: bool) {
    let channels = progress.channels();
    let samples_per_frame = progress.samples_per_frame();
    let total = self.mono.len();
    for chunk in &progress.chunks[self.ingested_chunks..] {
      let start = (chunk.frames.start * samples_per_frame).min(total);
      let (samples, _) = chunk.pcm.as_chunks::<2>();
      let samples: Vec<i16> = samples.iter().copied().map(i16::from_le_bytes).collect();
      let mut end = start;
      for (sample, frame) in self.mono[start..]
        .iter_mut()
        .zip(samples.chunks_exact(channels))
      {
        *sample = downmix(frame);
        end += 1;
      }
      self.add_rendered(start..end);

      // Columns whose window overlaps this chunk may have become complete.
      let first = start.saturating_sub(FFT_SIZE) / HOP_LENGTH;
      let last = (end / HOP_LENGTH).min(self.frame_count.saturating_sub(1));
      for column in first..=last {
        if self.computed[column] || !self.window_rendered(column) {
          continue;
        }
        self.computed[column] = true;
        let decibels = self.extractor.column(&self.mono, column);
        self.pending.push_back((column, decibels));
      }
      let base = self.deadline.map_or(now, |deadline| deadline.max(now));
      self.deadline = Some(if paced {
        base + chunk.rendered_in
      } else {
        base
      });
    }
    self.ingested_chunks = progress.chunks.len();
  }

  fn add_rendered(&mut self, range: Range<usize>) {
    self.rendered.push(range);
    self.rendered.sort_unstable_by_key(|range| range.start);
    let mut merged: Vec<Range<usize>> = Vec::with_capacity(self.rendered.len());
    for range in self.rendered.drain(..) {
      match merged.last_mut() {
        Some(last) if range.start <= last.end => last.end = last.end.max(range.end),
        _ => merged.push(range),
      }
    }
    self.rendered = merged;
  }

  fn window_rendered(&self, column: usize) -> bool {
    let window = self.extractor.window_range(column, self.mono.len());
    self
      .rendered
      .iter()
      .any(|range| range.start <= window.start && window.end <= range.end)
  }

  pub fn has_pending(&self) -> bool {
    !self.pending.is_empty()
  }

  /// Columns to reveal at `now`: whole steps, spread evenly until the deadline, at least one
  /// step per tick and everything left once the deadline is within a tick.
  pub fn due(&mut self, now: Instant) -> Vec<(usize, Vec<f64>)> {
    if self.pending.is_empty() {
      return Vec::new();
    }
    let remaining_steps = self.pending.len().div_ceil(SLIDING_STEP_COLUMNS);
    let left = self.deadline.map_or(Duration::ZERO, |deadline| {
      deadline.saturating_duration_since(now)
    });
    let steps = if left <= SLIDING_TICK {
      remaining_steps
    } else {
      let share = SLIDING_TICK.as_secs_f64() / left.as_secs_f64();
      ((remaining_steps as f64 * share).ceil() as usize).clamp(1, remaining_steps)
    };
    let columns = (steps * SLIDING_STEP_COLUMNS).min(self.pending.len());
    self.pending.drain(..columns).collect()
  }
}

/// Mel spectrogram of `mono`, normalized to its loudest value.
fn preview_from_mono(mono: Array1<f64>, sample_rate: usize) -> SpectrogramPreview {
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

  SpectrogramPreview {
    values,
    frame_count,
    mel_bins: MEL_BINS,
    duration_seconds,
  }
}

#[cfg(test)]
// Chunk lists are slices of ranges, often with a single chunk.
#[allow(clippy::single_range_in_vec_init)]
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

  /// A 220 Hz tone of `frames` synthesis frames as 16-bit PCM.
  fn tone_pcm(frames: usize, sample_rate: u32, stereo: bool) -> Vec<u8> {
    let samples_per_frame = 256 * (sample_rate / 24_000) as usize;
    let channels = if stereo { 2 } else { 1 };
    (0..frames * samples_per_frame)
      .flat_map(|index| {
        let phase = index as f64 * 220. * std::f64::consts::TAU / sample_rate as f64;
        let sample = ((phase.sin() * 8_000.) as i16).to_le_bytes();
        std::iter::repeat_n(sample, channels).flatten()
      })
      .collect()
  }

  const RENDERED_IN: Duration = Duration::from_millis(160);

  fn progress_with(
    frame_length: usize,
    sample_rate: u32,
    stereo: bool,
    chunks: &[std::ops::Range<usize>],
  ) -> RenderProgress {
    let pcm = tone_pcm(frame_length, sample_rate, stereo);
    let bytes_per_frame = 256 * (sample_rate / 24_000) as usize * if stereo { 4 } else { 2 };
    let mut progress = RenderProgress::new(frame_length, sample_rate, stereo);
    for frames in chunks {
      progress.chunks.push(crate::streaming::RenderedChunk {
        frames: frames.clone(),
        pcm: std::sync::Arc::new(
          pcm[frames.start * bytes_per_frame..frames.end * bytes_per_frame].to_vec(),
        ),
        rendered_in: RENDERED_IN,
      });
    }
    progress
  }

  /// Whole-signal mel decibels of the tone, column by column.
  fn whole_columns(frame_length: usize, sample_rate: u32) -> Vec<Vec<f64>> {
    let pcm = tone_pcm(frame_length, sample_rate, false);
    let (samples, _) = pcm.as_chunks::<2>();
    let mono: Array1<f64> = samples
      .iter()
      .map(|bytes| downmix(&[i16::from_le_bytes(*bytes)]))
      .collect();
    let mut extractor = MelSpec::new(FFT_SIZE, MEL_BINS, HOP_LENGTH, sample_rate as usize);
    let whole = extractor.process(mono);
    (0..whole.ncols())
      .map(|column| whole.column(column).to_vec())
      .collect()
  }

  fn indices(columns: &[(usize, Vec<f64>)]) -> Vec<usize> {
    columns.iter().map(|(column, _)| *column).collect()
  }

  #[test]
  fn chunks_rendered_before_following_are_revealed_at_once() {
    let now = Instant::now();
    let progress = progress_with(40, 24_000, false, &[0..10]);
    let mut sliding = SlidingSpectrogram::new(&progress);
    // 40 frames are 10240 samples, giving 37 columns of 256-sample hops.
    assert_eq!(sliding.frame_count, 37);
    assert!((sliding.duration_seconds - 40. * 256. / 24_000.).abs() < 1e-9);
    sliding.ingest(&progress, now, false);
    // 10 frames are 2560 samples: windows starting at 0..=1536 fit, which is 7 columns.
    let due = sliding.due(now);
    assert_eq!(indices(&due), (0..7).collect::<Vec<_>>());
    let whole = whole_columns(40, 24_000);
    for (column, decibels) in &due {
      assert_eq!(decibels, &whole[*column]);
    }
    assert!(!sliding.has_pending());
  }

  #[test]
  fn paced_columns_slide_two_at_a_time_until_the_chunk_render_time_passes() {
    let now = Instant::now();
    let mut progress = progress_with(40, 24_000, false, &[0..10]);
    let mut sliding = SlidingSpectrogram::new(&progress);
    sliding.ingest(&progress, now, false);
    sliding.due(now);

    progress = progress_with(40, 24_000, false, &[0..10, 10..30]);
    sliding.ingest(&progress, now, true);
    // Frames 10..30 complete windows starting at 1792..=6656: columns 7..=26, ten steps.
    let first = sliding.due(now);
    assert_eq!(indices(&first), vec![7, 8]);
    let halfway = sliding.due(now + RENDERED_IN / 2);
    assert_eq!(indices(&halfway), vec![9, 10, 11, 12]);
    let rest = sliding.due(now + RENDERED_IN);
    assert_eq!(indices(&rest), (13..27).collect::<Vec<_>>());
    assert!(sliding.due(now + RENDERED_IN).is_empty());
  }

  #[test]
  fn columns_across_a_chunk_boundary_wait_for_the_next_chunk() {
    let now = Instant::now();
    let mut progress = progress_with(40, 24_000, false, &[0..10]);
    let mut sliding = SlidingSpectrogram::new(&progress);
    sliding.ingest(&progress, now, false);
    assert_eq!(sliding.due(now).last().map(|(column, _)| *column), Some(6));
    progress = progress_with(40, 24_000, false, &[0..10, 10..12]);
    sliding.ingest(&progress, now, false);
    // Frame 12 ends at sample 3072, completing the windows that start at 1792 and 2048.
    assert_eq!(indices(&sliding.due(now)), vec![7, 8]);
  }

  #[test]
  fn out_of_order_chunks_reveal_the_columns_they_cover() {
    let now = Instant::now();
    let progress = progress_with(40, 48_000, true, &[20..40]);
    let mut sliding = SlidingSpectrogram::new(&progress);
    sliding.ingest(&progress, now, false);
    let due = indices(&sliding.due(now));
    // At 48 kHz a frame is 512 samples, so frames 20.. start at sample 10240 (column 40).
    assert_eq!(due.first(), Some(&40));
    assert_eq!(due.last(), Some(&(sliding.frame_count - 1)));
    assert_eq!(due.len(), sliding.frame_count - 40);
  }

  #[test]
  fn a_complete_render_reveals_every_column_with_whole_signal_values() {
    let now = Instant::now();
    let progress = progress_with(30, 24_000, false, &[10..30, 0..10]);
    let mut sliding = SlidingSpectrogram::new(&progress);
    sliding.ingest(&progress, now, false);
    let mut due = sliding.due(now);
    due.sort_by_key(|(column, _)| *column);
    let whole = whole_columns(30, 24_000);
    assert_eq!(indices(&due), (0..whole.len()).collect::<Vec<_>>());
    for (column, decibels) in &due {
      assert_eq!(decibels, &whole[*column]);
    }
  }

  #[test]
  fn a_restarted_render_is_not_followed_as_a_continuation() {
    let progress = progress_with(40, 24_000, false, &[0..10, 10..20]);
    let mut sliding = SlidingSpectrogram::new(&progress);
    sliding.ingest(&progress, Instant::now(), false);
    assert!(sliding.follows(&progress));
    assert!(!sliding.follows(&progress_with(40, 24_000, false, &[0..10])));
    assert!(!sliding.follows(&progress_with(40, 48_000, false, &[0..10, 10..20])));
    assert!(!sliding.follows(&RenderProgress::new(41, 24_000, false)));
  }

  #[test]
  fn columns_events_carry_the_finished_preview_geometry() {
    let progress = progress_with(40, 24_000, false, &[0..10]);
    let mut sliding = SlidingSpectrogram::new(&progress);
    sliding.ingest(&progress, Instant::now(), false);
    let due = sliding.due(Instant::now());
    let event = request("block", 3, "hash");
    let identity = SpectrogramJob::new(event, "query".into()).identity;
    let columns = identity.columns_event(&sliding, due);
    assert_eq!(columns.frame_count, 37);
    assert_eq!(columns.mel_bins, MEL_BINS);
    assert_eq!(columns.columns, (0..7).collect::<Vec<_>>());
    assert_eq!(columns.decibels.len(), 7 * MEL_BINS);
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
