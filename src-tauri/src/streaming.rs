//! Chunk planning for streaming synthesis through the fork's segmented rendering API.
use std::ops::Range;
use std::time::Duration;

use voicevox_core::{DEFAULT_STREAMING_CHUNK_FRAMES, STREAMING_FRAME_RATE};

/// Frames per rendered chunk. Chunks of this size match whole-utterance synthesis to within one
/// quantization step, so streamed and whole waveforms can share the waveform cache.
pub(crate) const STREAMING_CHUNK_FRAMES: usize = DEFAULT_STREAMING_CHUNK_FRAMES;

/// Rendering order for one utterance. Playback that starts mid-utterance renders the chunk
/// containing the start time first and the skipped head last, only to complete the waveform.
#[derive(Debug, PartialEq)]
pub(crate) struct StreamPlan {
  /// Consecutive frame ranges covering the utterance.
  pub chunks: Vec<Range<usize>>,
  /// Chunk indices in rendering order.
  pub order: Vec<usize>,
  /// Index of the first chunk to play; chunks before it are not played.
  pub first_played: usize,
  /// Time to skip within the first played chunk.
  pub skip: Duration,
}

impl StreamPlan {
  pub fn new(frame_length: usize, chunk_frames: usize, start_at: Duration) -> Self {
    let chunk_frames = chunk_frames.max(1);
    let chunks: Vec<_> = (0..frame_length)
      .step_by(chunk_frames)
      .map(|start| start..(start + chunk_frames).min(frame_length))
      .collect();
    // Truncating keeps the start frame at or before the start time.
    let start_frame = (start_at.as_secs_f64() * STREAMING_FRAME_RATE) as usize;
    let first_played = (start_frame / chunk_frames).min(chunks.len());
    let chunk_start =
      Duration::from_secs_f64((first_played * chunk_frames) as f64 / STREAMING_FRAME_RATE);
    let skip = if first_played < chunks.len() {
      start_at.saturating_sub(chunk_start)
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

#[cfg(test)]
mod tests {
  use super::*;

  fn seconds_at_frame(frame: usize) -> Duration {
    Duration::from_secs_f64(frame as f64 / STREAMING_FRAME_RATE)
  }

  #[test]
  fn playback_from_the_start_renders_chunks_in_order() {
    let plan = StreamPlan::new(120, 50, Duration::ZERO);
    assert_eq!(plan.chunks, vec![0..50, 50..100, 100..120]);
    assert_eq!(plan.order, vec![0, 1, 2]);
    assert_eq!(plan.first_played, 0);
    assert_eq!(plan.skip, Duration::ZERO);
    assert_eq!(plan.playback_skip(0), Some(Duration::ZERO));
  }

  #[test]
  fn seeking_renders_the_chunk_at_the_start_time_first_and_the_head_last() {
    let start_at = seconds_at_frame(130);
    let plan = StreamPlan::new(220, 50, start_at);
    assert_eq!(plan.order, vec![2, 3, 4, 0, 1]);
    assert_eq!(plan.first_played, 2);
    let skip = plan.skip.as_secs_f64();
    assert!((skip - seconds_at_frame(30).as_secs_f64()).abs() < 1e-6);
    assert_eq!(plan.playback_skip(1), None);
    assert_eq!(plan.playback_skip(2), Some(plan.skip));
    assert_eq!(plan.playback_skip(3), Some(Duration::ZERO));
  }

  #[test]
  fn seeking_past_the_end_plays_nothing_but_renders_everything() {
    let plan = StreamPlan::new(60, 50, Duration::from_secs(10));
    assert_eq!(plan.first_played, 2);
    assert_eq!(plan.order, vec![0, 1]);
    assert_eq!(plan.skip, Duration::ZERO);
    assert_eq!(plan.playback_skip(1), None);
  }

  #[test]
  fn empty_utterances_and_zero_chunk_sizes_do_not_panic() {
    let empty = StreamPlan::new(0, 50, Duration::from_secs(1));
    assert!(empty.chunks.is_empty() && empty.order.is_empty());
    let single_frames = StreamPlan::new(3, 0, Duration::ZERO);
    assert_eq!(single_frames.chunks, vec![0..1, 1..2, 2..3]);
  }
}
