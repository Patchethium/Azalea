//! HTK-style `.lab` phoneme timing labels for lip sync, matching the format
//! VOICEVOX writes next to exported audio.

use std::fmt::Write;
use voicevox_core::AudioQuery;

use super::stretch::TimeMap;

/// Lab timestamps are in 100-nanosecond units.
const UNITS_PER_SECOND: f64 = 10_000_000.0;

struct LabWriter<'a> {
  text: String,
  /// Seconds into the synthesized waveform.
  seconds: f64,
  offset_seconds: f64,
  speed_scale: f64,
  /// Where each point of the synthesized waveform ends up in the output.
  map: &'a TimeMap,
}

impl LabWriter<'_> {
  fn timestamp(&self, seconds: f64) -> f64 {
    (self.map.to_target(seconds) + self.offset_seconds) * UNITS_PER_SECOND
  }

  /// Appends one `start end phoneme` line lasting `seconds` at speed 1.
  fn push(&mut self, seconds: f32, phoneme: &str) {
    let start = self.timestamp(self.seconds);
    self.seconds += f64::from(seconds) / self.speed_scale;
    let end = self.timestamp(self.seconds);
    // `write!` into a `String` cannot fail.
    let _ = writeln!(
      self.text,
      "{:.0} {:.0} {phoneme}",
      start.round(),
      end.round()
    );
  }
}

/// Generates the lab text for an audio query, one newline-terminated line per
/// phoneme. Durations are divided by the speed scale, leading and trailing
/// silence are labelled `pau`, and unvoiced vowels are lowercased except `N`.
pub fn lab_from_audio_query(query: &AudioQuery) -> String {
  lab_from_audio_query_at(query, 0.0)
}

/// Like [`lab_from_audio_query`], but with every timestamp shifted by
/// `offset_seconds`, for labels of a query placed later in a combined file.
pub fn lab_from_audio_query_at(query: &AudioQuery, offset_seconds: f64) -> String {
  lab_from_audio_query_mapped(query, offset_seconds, &TimeMap::identity())
}

/// Like [`lab_from_audio_query_at`], with every time passed through `map` first, for audio
/// whose timing was edited in post-processing.
pub fn lab_from_audio_query_mapped(
  query: &AudioQuery,
  offset_seconds: f64,
  map: &TimeMap,
) -> String {
  let mut lab = LabWriter {
    text: String::new(),
    seconds: 0.0,
    offset_seconds,
    speed_scale: f64::from(f32::from(query.speed_scale)),
    map,
  };
  lab.push(query.pre_phoneme_length.into(), "pau");
  for phrase in &query.accent_phrases {
    for mora in &phrase.moras {
      if let (Some(consonant), Some(length)) = (&mora.consonant, mora.consonant_length) {
        lab.push(length.into(), &consonant.to_string());
      }
      let vowel = mora.vowel.to_string();
      if vowel == "N" {
        lab.push(mora.vowel_length.into(), "N");
      } else {
        lab.push(mora.vowel_length.into(), &vowel.to_lowercase());
      }
    }
    if let Some(pause) = &phrase.pause_mora {
      lab.push(pause.vowel_length.into(), &pause.vowel.to_string());
    }
  }
  lab.push(query.post_phoneme_length.into(), "pau");
  lab.text
}

#[cfg(test)]
mod tests {
  use super::{lab_from_audio_query, lab_from_audio_query_at, lab_from_audio_query_mapped};
  use crate::audio::stretch::TimeMap;
  use voicevox_core::AudioQuery;

  fn query(speed_scale: f32) -> AudioQuery {
    serde_json::from_value(serde_json::json!({
      "accent_phrases": [
        {
          "moras": [
            { "text": "コ", "consonant": "k", "consonant_length": 0.05,
              "vowel": "o", "vowel_length": 0.1, "pitch": 5.5 },
            { "text": "ン", "consonant": null, "consonant_length": null,
              "vowel": "N", "vowel_length": 0.08, "pitch": 5.4 }
          ],
          "accent": 1,
          "pause_mora": { "text": "、", "consonant": null, "consonant_length": null,
            "vowel": "pau", "vowel_length": 0.2, "pitch": 0.0 }
        },
        {
          "moras": [
            { "text": "シ", "consonant": "sh", "consonant_length": 0.06,
              "vowel": "I", "vowel_length": 0.04, "pitch": 0.0 }
          ],
          "accent": 1,
          "pause_mora": null
        }
      ],
      "speedScale": speed_scale,
      "pitchScale": 0.0,
      "intonationScale": 1.0,
      "volumeScale": 1.0,
      "prePhonemeLength": 0.1,
      "postPhonemeLength": 0.15,
      "outputSamplingRate": 24000,
      "outputStereo": false,
      "kana": null
    }))
    .unwrap()
  }

  #[test]
  fn lab_lists_each_phoneme_with_cumulative_100ns_timestamps() {
    assert_eq!(
      lab_from_audio_query(&query(1.0)),
      "0 1000000 pau\n\
       1000000 1500000 k\n\
       1500000 2500000 o\n\
       2500000 3300000 N\n\
       3300000 5300000 pau\n\
       5300000 5900000 sh\n\
       5900000 6300000 i\n\
       6300000 7800000 pau\n"
    );
  }

  #[test]
  fn lab_durations_shrink_with_speed_scale() {
    let lab = lab_from_audio_query(&query(2.0));
    assert!(lab.starts_with("0 500000 pau\n500000 750000 k\n"));
    assert!(lab.ends_with("3150000 3900000 pau\n"));
  }

  #[test]
  fn lab_timestamps_start_at_the_given_offset() {
    let lab = lab_from_audio_query_at(&query(1.0), 1.5);
    assert!(lab.starts_with("15000000 16000000 pau\n16000000 16500000 k\n"));
    assert!(lab.ends_with("21300000 22800000 pau\n"));
    assert_eq!(lab.lines().count(), 8);
  }

  #[test]
  fn lab_timestamps_follow_post_processing_time_edits() {
    // The vowel of コ (0.15..0.25 s) is stretched to 0.15..0.35 s; later phonemes shift.
    let map = TimeMap::new([(0.15, 0.15), (0.25, 0.35)]);
    let lab = lab_from_audio_query_mapped(&query(1.0), 0.0, &map);
    assert!(lab.starts_with(
      "0 1000000 pau
1000000 1500000 k
1500000 3500000 o
"
    ));
    assert!(lab.ends_with(
      "7300000 8800000 pau
"
    ));
    let offset = lab_from_audio_query_mapped(&query(1.0), 1.0, &map);
    assert!(offset.starts_with(
      "10000000 11000000 pau
"
    ));
  }
}
