use std::collections::HashMap;

use voicevox_core::StyleId;

const RANGE_JSON: &str = include_str!("../assets/range.json");

pub type RangeMap = HashMap<StyleId, (f32, f32)>;

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
    assert!(ranges
      .values()
      .all(|(low, high)| { low.is_finite() && high.is_finite() && *low >= 0.0 && high >= low }));
  }
}
