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

/// Rendering order for one utterance. Playback that starts mid-utterance renders from the start
/// frame first and the skipped head last, only to complete the waveform.
#[derive(Debug, PartialEq)]
pub struct StreamPlan {
  /// Consecutive frame ranges covering the utterance.
  pub chunks: Vec<Range<usize>>,
  /// Chunk indices in rendering order.
  pub order: Vec<usize>,
  /// Index of the first chunk to play; chunks before it are not played.
  pub first_played: usize,
  /// Time to skip within the first played chunk, below one frame.
  pub skip: Duration,
}

impl StreamPlan {
  pub fn new(frame_length: usize, schedule: ChunkSchedule, start_at: Duration) -> Self {
    // Truncating keeps the start frame at or before the start time.
    let start_frame = ((start_at.as_secs_f64() * STREAMING_FRAME_RATE) as usize).min(frame_length);
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
    let skip = if first_played < chunks.len() {
      start_at.saturating_sub(Duration::from_secs_f64(
        start_frame as f64 / STREAMING_FRAME_RATE,
      ))
    } else {
      Duration::ZERO
    };
    let order = (first_played..chunks.len())
      .chain(0..first_played)
      .collect();
    Self {
      chunks,
      order,
      first_played,
      skip,
    }
  }

  /// Time to skip at the start of the chunk at `index`, or `None` when it is not played.
  pub fn playback_skip(&self, index: usize) -> Option<Duration> {
    match index.cmp(&self.first_played) {
      std::cmp::Ordering::Less => None,
      std::cmp::Ordering::Equal => Some(self.skip),
      std::cmp::Ordering::Greater => Some(Duration::ZERO),
    }
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
    let plan = StreamPlan::new(1000, SCHEDULE, Duration::ZERO);
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
    assert_eq!(plan.skip, Duration::ZERO);
    assert_eq!(plan.playback_skip(0), Some(Duration::ZERO));
    assert_covers(&plan, 1000);
  }

  #[test]
  fn a_short_remainder_joins_the_chunk_before_it() {
    let plan = StreamPlan::new(170, SCHEDULE, Duration::ZERO);
    assert_eq!(plan.chunks, vec![0..50, 50..170]);
    let short = StreamPlan::new(30, SCHEDULE, Duration::ZERO);
    assert_eq!(short.chunks, vec![0..30]);
  }

  #[test]
  fn seeking_streams_from_the_start_frame_and_renders_the_head_last() {
    let start_at = seconds_at_frame(430.5);
    let plan = StreamPlan::new(700, SCHEDULE, start_at);
    assert_eq!(
      plan.chunks,
      vec![0..200, 200..430, 430..480, 480..580, 580..700]
    );
    assert_eq!(plan.first_played, 2);
    assert_eq!(plan.order, vec![2, 3, 4, 0, 1]);
    let skip = plan.skip.as_secs_f64();
    assert!((skip - seconds_at_frame(0.5).as_secs_f64()).abs() < 1e-6);
    assert_eq!(plan.playback_skip(1), None);
    assert_eq!(plan.playback_skip(2), Some(plan.skip));
    assert_eq!(plan.playback_skip(3), Some(Duration::ZERO));
    assert_covers(&plan, 700);
  }

  #[test]
  fn seeking_past_the_end_plays_nothing_but_renders_everything() {
    let plan = StreamPlan::new(260, SCHEDULE, Duration::from_secs(10));
    assert_eq!(plan.chunks, vec![0..200, 200..260]);
    assert_eq!(plan.first_played, 2);
    assert_eq!(plan.order, vec![0, 1]);
    assert_eq!(plan.skip, Duration::ZERO);
    assert_eq!(plan.playback_skip(1), None);
  }

  #[test]
  fn empty_utterances_and_degenerate_schedules_do_not_panic() {
    let empty = StreamPlan::new(0, SCHEDULE, Duration::from_secs(1));
    assert!(empty.chunks.is_empty() && empty.order.is_empty());
    let zero = ChunkSchedule {
      first_frames: 0,
      max_frames: 0,
    };
    assert_eq!(
      StreamPlan::new(3, zero, Duration::ZERO).chunks,
      vec![0..1, 1..2, 2..3]
    );
    let inverted = ChunkSchedule {
      first_frames: 100,
      max_frames: 10,
    };
    assert_eq!(
      StreamPlan::new(250, inverted, Duration::ZERO).chunks,
      vec![0..100, 100..250]
    );
  }
}
