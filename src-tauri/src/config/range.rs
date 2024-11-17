use std::collections::HashMap;

use crate::voicevox_sys::metas::StyleId;

const RANGE_JSON: &'static str = include_str!("../assets/range.json");

pub type RangeMap = HashMap<StyleId, (f32, f32)>;

pub fn get_range() -> RangeMap {
  serde_json::from_str(RANGE_JSON).unwrap()
}
