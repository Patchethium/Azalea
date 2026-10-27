//! Time-scale modification for post-processing: a piecewise-linear time map applied with WSOLA
//! (waveform-similarity overlap-add).
//!
//! WSOLA rebuilds the output from short Hann-windowed pieces of the original waveform. Each
//! piece is taken near where the time map says the output should come from, at the offset
//! whose waveform best continues the previous piece, so voiced sounds stay periodic. Only the
//! spans the map stretches or squeezes, plus a short margin, come from WSOLA; elsewhere the
//! output is the original samples, shifted by whole samples, so untouched audio is bit-exact.

/// WSOLA piece length.
const FRAME_SECONDS: f64 = 0.02;
/// How far from its mapped position a piece may be taken to match the previous one.
const TOLERANCE_SECONDS: f64 = 0.005;
/// Audio around stretched spans that is also taken from WSOLA, before crossfading.
const MARGIN_SECONDS: f64 = 0.02;
/// Raised-cosine crossfade length between WSOLA and the original waveform.
const FADE_SECONDS: f64 = 0.015;

/// A monotonic piecewise-linear map from source seconds (the waveform being edited) to target
/// seconds (the output). It starts at (0, 0); after the last point, time keeps the last
/// point's offset.
#[derive(Clone, Debug, PartialEq)]
pub struct TimeMap {
  points: Vec<(f64, f64)>,
}

impl TimeMap {
  /// `anchors` must be validated: finite, positive and strictly increasing on both axes.
  pub fn new(anchors: impl IntoIterator<Item = (f64, f64)>) -> Self {
    let mut points = vec![(0.0, 0.0)];
    points.extend(anchors);
    Self { points }
  }

  pub fn identity() -> Self {
    Self::new([])
  }

  pub fn is_identity(&self) -> bool {
    self
      .points
      .iter()
      .all(|(source, target)| (source - target).abs() < 1e-9)
  }

  fn map(points: impl Iterator<Item = (f64, f64)> + Clone, x: f64) -> f64 {
    let mut previous = (0.0, 0.0);
    for point in points {
      if x <= point.0 {
        let span = point.0 - previous.0;
        return if span <= 0.0 {
          point.1
        } else {
          previous.1 + (x - previous.0) * (point.1 - previous.1) / span
        };
      }
      previous = point;
    }
    x + previous.1 - previous.0
  }

  pub fn to_target(&self, source: f64) -> f64 {
    Self::map(self.points.iter().copied(), source)
  }

  pub fn to_source(&self, target: f64) -> f64 {
    Self::map(self.points.iter().map(|(s, t)| (*t, *s)), target)
  }

  /// The target/source rate of the span containing target time `target`.
  fn rate_at(&self, target: f64) -> f64 {
    let mut previous = (0.0, 0.0);
    for &(source, point_target) in &self.points {
      if target < point_target {
        let span = source - previous.0;
        return if span <= 0.0 {
          1.0
        } else {
          (point_target - previous.1) / span
        };
      }
      previous = (source, point_target);
    }
    1.0
  }
}

/// Raised-cosine smoothing of a 0/1 mask over `fade` samples on each side, so crossfades
/// between two renderings have no clicks.
pub(crate) fn smooth_mask(hard: &[f64], fade: usize) -> Vec<f64> {
  let length = hard.len();
  let fade = fade.max(1);
  let kernel: Vec<f64> = (0..=2 * fade)
    .map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / (2 * fade) as f64).cos())
    .collect();
  let total: f64 = kernel.iter().sum();
  // Prefix sums let samples away from an edge skip the convolution.
  let mut prefix = vec![0.0; length + 1];
  for i in 0..length {
    prefix[i + 1] = prefix[i] + hard[i];
  }
  (0..length)
    .map(|i| {
      let lo = i.saturating_sub(fade);
      let hi = (i + fade + 1).min(length);
      let sum = prefix[hi] - prefix[lo];
      if sum == 0.0 {
        0.0
      } else if sum == (hi - lo) as f64 {
        1.0
      } else {
        let weighted: f64 = (lo..hi).map(|j| hard[j] * kernel[j + fade - i]).sum();
        (weighted / total).clamp(0.0, 1.0)
      }
    })
    .collect()
}

/// The sample of `samples` at `index`, or silence outside it.
fn sample(samples: &[f64], index: isize) -> f64 {
  usize::try_from(index)
    .ok()
    .and_then(|index| samples.get(index))
    .copied()
    .unwrap_or(0.0)
}

/// Applies `map` to every channel. Piece positions are chosen on the channels' mix so stereo
/// stays coherent. Returns the channels unchanged for an identity map.
pub fn time_warp(channels: &[Vec<f64>], sample_rate: u32, map: &TimeMap) -> Vec<Vec<f64>> {
  if map.is_identity() || channels.is_empty() {
    return channels.to_vec();
  }
  let fs = f64::from(sample_rate);
  let source_length = channels[0].len();
  let output_length = (map.to_target(source_length as f64 / fs) * fs)
    .round()
    .max(0.0) as usize;
  let mono: Vec<f64> = (0..source_length)
    .map(|i| channels.iter().map(|c| c[i]).sum::<f64>() / channels.len() as f64)
    .collect();

  let frame = ((fs * FRAME_SECONDS) as usize).max(4) & !1;
  let half = frame / 2;
  let hop = half;
  let tolerance = (fs * TOLERANCE_SECONDS) as isize;
  let window: Vec<f64> = (0..frame)
    .map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / frame as f64).cos())
    .collect();

  let mut warped = vec![vec![0.0; output_length + frame]; channels.len()];
  let mut norm = vec![0.0; output_length + frame];
  let mut previous: Option<isize> = None;
  let mut center = 0usize;
  while center < output_length + half {
    let target = (map.to_source(center as f64 / fs) * fs).round() as isize;
    let best = match previous {
      None => target,
      Some(previous) => {
        let natural = previous + hop as isize;
        if (natural - target).abs() <= 1 {
          natural
        } else {
          // The candidate whose piece best continues the previous one.
          let mut best = target;
          let mut best_score = f64::NEG_INFINITY;
          for candidate in target - tolerance..=target + tolerance {
            let score: f64 = (0..frame as isize)
              .map(|k| {
                sample(&mono, candidate - half as isize + k)
                  * sample(&mono, natural - half as isize + k)
              })
              .sum();
            if score > best_score {
              best = candidate;
              best_score = score;
            }
          }
          best
        }
      }
    };
    for k in 0..frame {
      let output = center + k;
      if output < half {
        continue;
      }
      let output = output - half;
      let source = best - half as isize + k as isize;
      for (channel, out) in channels.iter().zip(warped.iter_mut()) {
        out[output] += sample(channel, source) * window[k];
      }
      norm[output] += window[k];
    }
    previous = Some(best);
    center += hop;
  }

  // Outside stretched spans, copy the original samples shifted by whole samples.
  let margin = (fs * MARGIN_SECONDS) as usize;
  let mut hard = vec![0.0; output_length];
  for (i, value) in hard.iter_mut().enumerate() {
    if (map.rate_at(i as f64 / fs) - 1.0).abs() > 1e-9 {
      *value = 1.0;
    }
  }
  let mut widened = hard.clone();
  for (i, value) in hard.iter().enumerate() {
    if *value == 1.0 {
      let lo = i.saturating_sub(margin);
      let hi = (i + margin + 1).min(output_length);
      widened[lo..hi].fill(1.0);
    }
  }
  let mask = smooth_mask(&widened, (fs * FADE_SECONDS) as usize);
  channels
    .iter()
    .zip(warped)
    .map(|(channel, warped)| {
      (0..output_length)
        .map(|i| {
          let weight = mask[i];
          let original = if weight < 1.0 {
            let source = (map.to_source(i as f64 / fs) * fs).round() as isize;
            sample(channel, source)
          } else {
            0.0
          };
          let stretched = if weight > 0.0 && norm[i] > 1e-9 {
            warped[i] / norm[i]
          } else {
            0.0
          };
          original * (1.0 - weight) + stretched * weight
        })
        .collect()
    })
    .collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  const FS: u32 = 24_000;

  fn tone(seconds: f64, f0: f64) -> Vec<f64> {
    (0..(seconds * f64::from(FS)) as usize)
      .map(|i| {
        let phase = 2.0 * std::f64::consts::PI * f0 * i as f64 / f64::from(FS);
        (1..=6)
          .map(|h| (h as f64 * phase).sin() / h as f64)
          .sum::<f64>()
          * 0.2
      })
      .collect()
  }

  /// Fundamental estimated by autocorrelation between 80 and 400 Hz.
  fn pitch(samples: &[f64]) -> f64 {
    let fs = f64::from(FS);
    let lag = (fs as usize / 400..fs as usize / 80)
      .max_by(|a, b| {
        let score = |lag: usize| -> f64 {
          (0..samples.len() - lag)
            .map(|i| samples[i] * samples[i + lag])
            .sum()
        };
        score(*a).total_cmp(&score(*b))
      })
      .unwrap();
    fs / lag as f64
  }

  #[test]
  fn time_map_maps_both_ways_and_keeps_the_last_offset() {
    let map = TimeMap::new([(1.0, 2.0), (2.0, 2.5)]);
    assert!(!map.is_identity());
    assert_eq!(map.to_target(0.5), 1.0);
    assert_eq!(map.to_target(1.5), 2.25);
    assert_eq!(map.to_target(3.0), 3.5);
    assert_eq!(map.to_source(1.0), 0.5);
    assert_eq!(map.to_source(2.25), 1.5);
    assert_eq!(map.to_source(3.5), 3.0);
    assert_eq!(map.rate_at(0.5), 2.0);
    assert_eq!(map.rate_at(2.2), 0.5);
    assert_eq!(map.rate_at(9.0), 1.0);
    assert!(TimeMap::new([(1.0, 1.0)]).is_identity());
    assert!(TimeMap::identity().is_identity());
  }

  #[test]
  fn identity_maps_return_the_input() {
    let channels = vec![tone(0.2, 200.0)];
    assert_eq!(time_warp(&channels, FS, &TimeMap::identity()), channels);
    assert!(time_warp(&[], FS, &TimeMap::new([(0.1, 0.2)])).is_empty());
  }

  #[test]
  fn stretching_keeps_pitch_and_untouched_samples() {
    let original = tone(1.0, 200.0);
    let channels = vec![original.clone(), original.clone()];
    // Stretch 0.4..0.5 s to 0.4..0.6 s; everything after shifts by 0.1 s.
    let map = TimeMap::new([(0.4, 0.4), (0.5, 0.6)]);
    let warped = time_warp(&channels, FS, &map);
    assert_eq!(warped.len(), 2);
    assert_eq!(warped[0], warped[1]);
    let output = &warped[0];
    assert_eq!(output.len(), 26_400);
    // Before the stretched span (minus margin and fade), the original is kept bit for bit.
    assert_eq!(output[..8_000], original[..8_000]);
    // After it, the original continues 0.1 s (2400 samples) later.
    assert_eq!(output[16_000..], original[13_600..]);
    // Inside, the pitch is unchanged.
    let inside = &output[10_400..13_600];
    assert!((pitch(inside) - 200.0).abs() < 5.0, "{}", pitch(inside));
    assert!(inside.iter().all(|v| v.is_finite() && v.abs() < 1.0));
  }

  #[test]
  fn squeezing_shortens_the_output() {
    let original = tone(1.0, 150.0);
    let map = TimeMap::new([(0.2, 0.2), (0.8, 0.5)]);
    let output = &time_warp(&[original.clone()], FS, &map)[0];
    assert_eq!(output.len(), 16_800);
    assert_eq!(output[15_000..], original[22_200..]);
    assert!((pitch(&output[6_000..10_000]) - 150.0).abs() < 5.0);
  }

  #[test]
  fn smoothing_fades_between_regions() {
    let mut hard = vec![0.0; 100];
    hard[40..60].fill(1.0);
    let mask = smooth_mask(&hard, 5);
    assert_eq!(mask[0], 0.0);
    assert_eq!(mask[50], 1.0);
    assert!(mask[37] > 0.0 && mask[37] < 1.0);
    assert!(mask.windows(2).all(|w| (w[0] - w[1]).abs() < 0.5));
  }
}
