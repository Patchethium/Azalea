use std::collections::HashMap;

use voicevox_core::StyleId;

const RANGE_JSON: &str = include_str!("../assets/range.json");

pub const PITCH_HISTOGRAM_BINS: usize = 128;

#[derive(Clone, serde::Deserialize, serde::Serialize, specta::Type)]
pub struct PitchRange {
  pub min: f32,
  pub max: f32,
  pub histogram_min: f32,
  pub histogram_max: f32,
  pub histogram: Vec<u32>,
}

impl PitchRange {
  pub fn from_samples(mut values: Vec<f32>) -> Self {
    values.retain(|value| value.is_finite() && *value > 0.1);
    values.sort_by(f32::total_cmp);
    let target_count = ((values.len() as f32 * 0.97).ceil() as usize).max(1);
    let (min, max) = values
      .windows(target_count)
      .map(|window| (window[0], window[window.len() - 1]))
      .min_by(|a, b| (a.1 - a.0).total_cmp(&(b.1 - b.0)))
      .unwrap_or((0.0, 0.0));
    // Give a constant voiced distribution an editable range too.
    let padding = if min == max && min > 0.0 {
      0.1
    } else {
      (max - min) * 0.3
    };
    let histogram_min = (min - padding).clamp(0.0, 6.5);
    let histogram_max = (max + padding).clamp(0.0, 6.5);
    let mut histogram = vec![0; PITCH_HISTOGRAM_BINS];
    if histogram_max > histogram_min {
      for value in values {
        if value < histogram_min || value > histogram_max {
          continue;
        }
        let index = ((value - histogram_min) / (histogram_max - histogram_min)
          * PITCH_HISTOGRAM_BINS as f32) as usize;
        histogram[index.min(PITCH_HISTOGRAM_BINS - 1)] += 1;
      }
    }
    Self {
      min,
      max,
      histogram_min,
      histogram_max,
      histogram,
    }
  }
}

pub type RangeMap = HashMap<StyleId, PitchRange>;

pub fn get_range() -> RangeMap {
  serde_json::from_str(RANGE_JSON).expect("Built-in range.json is invalid; this is a bug")
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn built_in_ranges_are_finite_and_ordered() {
    let ranges = get_range();

    assert!(!ranges.is_empty());
    for range in ranges.values() {
      assert!(range.min.is_finite() && range.max.is_finite());
      assert!(range.min >= 0.0 && range.max >= range.min);
      assert!(range.histogram_min.is_finite() && range.histogram_max.is_finite());
      assert!(range.histogram_min >= 0.0 && range.histogram_max <= 6.5);
      assert!(range.histogram_max >= range.histogram_min);
      assert_eq!(range.histogram.len(), PITCH_HISTOGRAM_BINS);
      if range.max > 0.0 {
        assert!(range.histogram.iter().sum::<u32>() > 0);
      }
    }
  }

  #[test]
  fn histogram_keeps_the_narrowest_97_percent_and_padded_samples() {
    let mut samples = vec![5.0; 96];
    samples.extend([4.9, 5.1, 4.89, 6.5]);
    let range = PitchRange::from_samples(samples);
    assert_eq!((range.min, range.max), (4.9, 5.0));
    assert!((range.histogram_min - 4.87).abs() < 1e-5);
    assert!((range.histogram_max - 5.03).abs() < 1e-5);
    assert_eq!(range.histogram.iter().sum::<u32>(), 98);
    assert_eq!(range.histogram.iter().max(), Some(&96));
  }

  #[test]
  fn histogram_handles_empty_constant_and_boundary_samples() {
    let empty = PitchRange::from_samples(vec![0.0, 0.1, -1.0, f32::NAN, f32::INFINITY]);
    assert_eq!((empty.min, empty.max), (0.0, 0.0));
    assert_eq!(empty.histogram, vec![0; PITCH_HISTOGRAM_BINS]);
    let constant = PitchRange::from_samples(vec![5.0; 10]);
    assert!(constant.histogram_min < 5.0 && constant.histogram_max > 5.0);
    assert_eq!(constant.histogram.iter().sum::<u32>(), 10);
    let boundary = PitchRange::from_samples(vec![0.11, 6.5]);
    assert_eq!((boundary.histogram_min, boundary.histogram_max), (0.0, 6.5));
    assert_eq!(boundary.histogram[127], 1);
    assert_eq!(boundary.histogram.iter().sum::<u32>(), 2);
  }
}
