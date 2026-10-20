//! Chunk planning for streaming synthesis through the fork's segmented rendering API.
use std::ops::Range;
use std::sync::Arc;
use std::time::Duration;

use voicevox_core::{DEFAULT_STREAMING_CHUNK_FRAMES, STREAMING_FRAME_RATE};

/// Samples per channel in one frame at the core's native 24 kHz.
const NATIVE_SAMPLES_PER_FRAME: usize = 256;
const NATIVE_SAMPLING_RATE: u32 = 24_000;

/// One rendered chunk of a streamed waveform.
#[derive(Clone, Debug)]
pub struct RenderedChunk {
  pub frames: Range<usize>,
  /// 16-bit little-endian PCM, interleaved when stereo.
  pub pcm: Arc<Vec<u8>>,
  /// Time from requesting the chunk to receiving it, including waiting for the core.
  pub rendered_in: Duration,
}

/// The chunks of a streamed render so far, in rendering order, so consumers such as the
/// spectrogram preview can follow a render they did not start.
#[derive(Clone, Debug)]
pub struct RenderProgress {
  pub frame_length: usize,
  pub sample_rate: u32,
  pub stereo: bool,
  pub chunks: Vec<RenderedChunk>,
}

impl RenderProgress {
  pub fn new(frame_length: usize, sample_rate: u32, stereo: bool) -> Self {
    Self {
      frame_length,
      sample_rate,
      stereo,
      chunks: Vec::new(),
    }
  }

  /// Samples per channel in one frame. The core upsamples by repeating samples, so output
  /// rates are whole multiples of 24 kHz and every frame has the same number of samples.
  pub fn samples_per_frame(&self) -> usize {
    NATIVE_SAMPLES_PER_FRAME * (self.sample_rate / NATIVE_SAMPLING_RATE).max(1) as usize
  }

  pub fn channels(&self) -> usize {
    if self.stereo {
      2
    } else {
      1
    }
  }
}

/// Chunk sizes for one stream. Each chunk is vocoded with 14 frames of context on both sides,
/// so small chunks start playback early but repeat work; the first played chunk is small and
/// each later one doubles up to `max_frames`. Doubling keeps every chunk's render shorter than
/// the playback of the chunk before it on any machine rendering faster than about half of real
/// time.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChunkSchedule {
  pub first_frames: usize,
  pub max_frames: usize,
}

impl ChunkSchedule {
  /// Chunk sizes in frames, starting with the first played chunk.
  fn sizes(self) -> impl Iterator<Item = usize> {
    let first = self.first_frames.max(1);
    let max = self.max_frames.max(first);
    std::iter::successors(Some(first), move |&size| Some((size * 2).min(max)))
  }

  /// Chunks are never shorter than this, except for a whole range that is shorter. Chunks of at
  /// least this many frames match whole-utterance synthesis to within one quantization step.
  fn min_frames(self) -> usize {
    self.first_frames.max(1)
  }
}

pub const DEFAULT_CHUNK_SCHEDULE: ChunkSchedule = ChunkSchedule {
  first_frames: DEFAULT_STREAMING_CHUNK_FRAMES,
  max_frames: 400,
};

/// The frame playing at `start_at`, truncated so playback never starts late. A tiny epsilon
/// keeps times on a frame boundary from rounding down to the frame before.
pub fn start_frame(start_at: Duration) -> usize {
  (start_at.as_secs_f64() * STREAMING_FRAME_RATE + 1e-6) as usize
}

/// Rendering order for one utterance. Rendering from a start frame (playback that starts
/// mid-utterance, or takes over a render it was following) renders from there first and the
/// head last, only to complete the waveform.
#[derive(Debug, PartialEq)]
pub struct StreamPlan {
  /// Consecutive frame ranges covering the utterance.
  pub chunks: Vec<Range<usize>>,
  /// Chunk indices in rendering order.
  pub order: Vec<usize>,
  /// Index of the chunk starting at the start frame; chunks before it are the head.
  pub first_played: usize,
}

impl StreamPlan {
  pub fn new(frame_length: usize, schedule: ChunkSchedule, start_frame: usize) -> Self {
    let start_frame = start_frame.min(frame_length);
    let max = schedule.max_frames.max(schedule.min_frames());
    let mut chunks = split(
      0..start_frame,
      std::iter::repeat(max),
      schedule.min_frames(),
    );
    let first_played = chunks.len();
    chunks.extend(split(
      start_frame..frame_length,
      schedule.sizes(),
      schedule.min_frames(),
    ));
    let order = (first_played..chunks.len())
      .chain(0..first_played)
      .collect();
    Self {
      chunks,
      order,
      first_played,
    }
  }
}

/// Queues a waveform for playback in frame order from a start position, from whatever audio is
/// available: chunks of a render in progress, whoever started it, or the finished waveform.
/// Each frame is queued once, so a render that is followed and then taken over continues
/// seamlessly.
#[derive(Debug)]
pub struct PlaybackCursor {
  frame_length: usize,
  sample_rate: u32,
  stereo: bool,
  next_frame: usize,
  /// Time to skip within the first queued audio, below one frame.
  skip: Duration,
  queued_any: bool,
}

impl PlaybackCursor {
  pub fn new(frame_length: usize, sample_rate: u32, stereo: bool, start_at: Duration) -> Self {
    let next_frame = start_frame(start_at).min(frame_length);
    let skip = start_at
      .saturating_sub(Duration::from_secs_f64(
        next_frame as f64 / STREAMING_FRAME_RATE,
      ))
      .min(Duration::from_secs_f64(1. / STREAMING_FRAME_RATE));
    Self {
      frame_length,
      sample_rate,
      stereo,
      next_frame,
      skip,
      queued_any: false,
    }
  }

  /// A cursor for `progress`'s utterance.
  pub fn for_progress(progress: &RenderProgress, start_at: Duration) -> Self {
    Self::new(
      progress.frame_length,
      progress.sample_rate,
      progress.stereo,
      start_at,
    )
  }

  /// The first frame not queued yet; a render taking over continues from here.
  pub fn next_frame(&self) -> usize {
    self.next_frame
  }

  pub fn sample_rate(&self) -> u32 {
    self.sample_rate
  }

  pub fn stereo(&self) -> bool {
    self.stereo
  }

  pub fn is_complete(&self) -> bool {
    self.next_frame >= self.frame_length
  }

  fn bytes_per_frame(&self) -> usize {
    let progress = RenderProgress::new(self.frame_length, self.sample_rate, self.stereo);
    progress.samples_per_frame() * progress.channels() * 2
  }

  /// The PCM to queue next and the time to skip at its start, when `frames` contains the
  /// next frame to play; `pcm` covers exactly `frames`.
  pub fn take(&mut self, frames: Range<usize>, pcm: &[u8]) -> Option<(Vec<u8>, Duration)> {
    if self.is_complete() || !frames.contains(&self.next_frame) {
      return None;
    }
    let offset = (self.next_frame - frames.start) * self.bytes_per_frame();
    let piece = pcm.get(offset..)?.to_vec();
    self.next_frame = frames.end.min(self.frame_length);
    let skip = if self.queued_any {
      Duration::ZERO
    } else {
      self.skip
    };
    self.queued_any = true;
    Some((piece, skip))
  }

  /// Everything playable from `chunks`, in frame order, until a frame is missing.
  pub fn take_available(&mut self, chunks: &[RenderedChunk]) -> Vec<(Vec<u8>, Duration)> {
    let mut pieces = Vec::new();
    while let Some(piece) = chunks
      .iter()
      .find_map(|chunk| self.take(chunk.frames.clone(), &chunk.pcm))
    {
      pieces.push(piece);
    }
    pieces
  }
}

/// Splits `range` into chunks of the given sizes, merging a remainder shorter than `min_frames`
/// into the chunk before it.
fn split(
  range: Range<usize>,
  sizes: impl Iterator<Item = usize>,
  min_frames: usize,
) -> Vec<Range<usize>> {
  let mut chunks: Vec<Range<usize>> = Vec::new();
  let mut start = range.start;
  for size in sizes {
    if start >= range.end {
      break;
    }
    let end = (start + size.max(1)).min(range.end);
    match chunks.last_mut() {
      Some(last) if end - start < min_frames => last.end = end,
      _ => chunks.push(start..end),
    }
    start = end;
  }
  chunks
}

#[cfg(test)]
// Chunk lists are slices of ranges, often with a single chunk.
#[allow(clippy::single_range_in_vec_init)]
mod tests {
  use super::*;

  const SCHEDULE: ChunkSchedule = ChunkSchedule {
    first_frames: 50,
    max_frames: 200,
  };

  fn seconds_at_frame(frame: f64) -> Duration {
    Duration::from_secs_f64(frame / STREAMING_FRAME_RATE)
  }

  fn assert_covers(plan: &StreamPlan, frame_length: usize) {
    let mut end = 0;
    for chunk in &plan.chunks {
      assert_eq!(chunk.start, end);
      assert!(chunk.end > chunk.start);
      end = chunk.end;
    }
    assert_eq!(end, frame_length);
    let mut order = plan.order.clone();
    order.sort_unstable();
    assert_eq!(order, (0..plan.chunks.len()).collect::<Vec<_>>());
  }

  #[test]
  fn chunks_double_from_the_first_size_up_to_the_maximum() {
    let plan = StreamPlan::new(1000, SCHEDULE, 0);
    assert_eq!(
      plan.chunks,
      vec![
        0..50,
        50..150,
        150..350,
        350..550,
        550..750,
        750..950,
        950..1000
      ]
    );
    assert_eq!(plan.order, (0..7).collect::<Vec<_>>());
    assert_eq!(plan.first_played, 0);
    assert_covers(&plan, 1000);
  }

  #[test]
  fn a_short_remainder_joins_the_chunk_before_it() {
    let plan = StreamPlan::new(170, SCHEDULE, 0);
    assert_eq!(plan.chunks, vec![0..50, 50..170]);
    let short = StreamPlan::new(30, SCHEDULE, 0);
    assert_eq!(short.chunks, vec![0..30]);
  }

  #[test]
  fn plans_from_a_start_frame_render_the_head_last() {
    assert_eq!(start_frame(seconds_at_frame(430.5)), 430);
    let plan = StreamPlan::new(700, SCHEDULE, 430);
    assert_eq!(
      plan.chunks,
      vec![0..200, 200..430, 430..480, 480..580, 580..700]
    );
    assert_eq!(plan.first_played, 2);
    assert_eq!(plan.order, vec![2, 3, 4, 0, 1]);
    assert_covers(&plan, 700);
  }

  #[test]
  fn plans_from_past_the_end_render_everything_as_head() {
    let plan = StreamPlan::new(260, SCHEDULE, 10_000);
    assert_eq!(plan.chunks, vec![0..200, 200..260]);
    assert_eq!(plan.first_played, 2);
    assert_eq!(plan.order, vec![0, 1]);
  }

  #[test]
  fn empty_utterances_and_degenerate_schedules_do_not_panic() {
    let empty = StreamPlan::new(0, SCHEDULE, 100);
    assert!(empty.chunks.is_empty() && empty.order.is_empty());
    let zero = ChunkSchedule {
      first_frames: 0,
      max_frames: 0,
    };
    assert_eq!(StreamPlan::new(3, zero, 0).chunks, vec![0..1, 1..2, 2..3]);
    let inverted = ChunkSchedule {
      first_frames: 100,
      max_frames: 10,
    };
    assert_eq!(
      StreamPlan::new(250, inverted, 0).chunks,
      vec![0..100, 100..250]
    );
  }

  /// Mono 24 kHz PCM whose every sample holds its frame index, so slices are recognizable.
  fn frame_pcm(frames: Range<usize>) -> Vec<u8> {
    frames
      .flat_map(|frame| std::iter::repeat_n((frame as i16).to_le_bytes(), 256).flatten())
      .collect()
  }

  fn chunk(frames: Range<usize>) -> RenderedChunk {
    RenderedChunk {
      pcm: Arc::new(frame_pcm(frames.clone())),
      frames,
      rendered_in: Duration::ZERO,
    }
  }

  fn queued_frames(pieces: &[(Vec<u8>, Duration)]) -> Vec<i16> {
    let mut frames: Vec<i16> = Vec::new();
    for (pcm, _) in pieces {
      let (samples, _) = pcm.as_chunks::<2>();
      for sample in samples.iter().step_by(256) {
        frames.push(i16::from_le_bytes(*sample));
      }
    }
    frames
  }

  #[test]
  fn the_cursor_queues_contiguous_audio_from_the_start_position() {
    let mut cursor = PlaybackCursor::new(100, 24_000, false, seconds_at_frame(30.5));
    assert_eq!(cursor.next_frame(), 30);
    // A later chunk waits for the one containing the start frame.
    assert!(cursor.take_available(&[chunk(50..100)]).is_empty());
    let pieces = cursor.take_available(&[chunk(50..100), chunk(0..50)]);
    assert_eq!(queued_frames(&pieces), (30..100).collect::<Vec<i16>>());
    assert!((pieces[0].1.as_secs_f64() - seconds_at_frame(0.5).as_secs_f64()).abs() < 1e-6);
    assert_eq!(pieces[1].1, Duration::ZERO);
    assert!(cursor.is_complete());
    assert!(cursor.take(0..100, &frame_pcm(0..100)).is_none());
  }

  #[test]
  fn the_cursor_queues_each_frame_once_across_overlapping_sources() {
    let mut cursor = PlaybackCursor::new(100, 24_000, false, Duration::ZERO);
    // Following a render, then taking over from the next frame, then the finished waveform.
    let followed = cursor.take_available(&[chunk(0..50)]);
    assert_eq!(cursor.next_frame(), 50);
    let taken_over = cursor.take_available(&[chunk(0..50), chunk(50..70)]);
    let rest = cursor.take(0..100, &frame_pcm(0..100)).unwrap();
    let mut pieces = followed;
    pieces.extend(taken_over);
    pieces.push(rest);
    assert_eq!(queued_frames(&pieces), (0..100).collect::<Vec<i16>>());
  }

  #[test]
  fn the_cursor_handles_stereo_and_upsampled_audio() {
    let mut cursor = PlaybackCursor::new(4, 48_000, true, seconds_at_frame(2.));
    // 48 kHz stereo frames are 512 samples of 2 channels: 2048 bytes.
    let pcm: Vec<u8> = (0..4u8).flat_map(|frame| vec![frame; 2048]).collect();
    let (piece, skip) = cursor.take(0..4, &pcm).unwrap();
    assert_eq!(piece.len(), 2 * 2048);
    assert_eq!(piece[0], 2);
    assert!(skip < Duration::from_micros(1));
    assert!(cursor.is_complete());
  }

  #[test]
  fn a_start_past_the_end_queues_nothing() {
    let mut cursor = PlaybackCursor::new(10, 24_000, false, Duration::from_secs(5));
    assert!(cursor.is_complete());
    assert!(cursor.take_available(&[chunk(0..10)]).is_empty());
  }
}
