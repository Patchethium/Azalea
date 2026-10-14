//! HTK-style `.lab` phoneme timing labels for lip sync, matching the format
//! VOICEVOX writes next to exported audio.

use std::fmt::Write;
use voicevox_core::AudioQuery;

/// Lab timestamps are in 100-nanosecond units.
const UNITS_PER_SECOND: f64 = 10_000_000.0;

struct LabWriter {
  text: String,
  timestamp: f64,
  speed_scale: f64,
}

impl LabWriter {
  /// Appends one `start end phoneme` line lasting `seconds` at speed 1.
  fn push(&mut self, seconds: f32, phoneme: &str) {
    let start = self.timestamp;
    self.timestamp += f64::from(seconds) * UNITS_PER_SECOND / self.speed_scale;
    // `write!` into a `String` cannot fail.
    let _ = writeln!(
      self.text,
      "{:.0} {:.0} {phoneme}",
      start.round(),
      self.timestamp.round()
    );
  }
}

/// Generates the lab text for an audio query, one newline-terminated line per
/// phoneme. Durations are divided by the speed scale, leading and trailing
/// silence are labelled `pau`, and unvoiced vowels are lowercased except `N`.
pub fn lab_from_audio_query(query: &AudioQuery) -> String {
  let mut lab = LabWriter {
    text: String::new(),
    timestamp: 0.0,
    speed_scale: f64::from(query.speed_scale),
  };
  lab.push(query.pre_phoneme_length, "pau");
  for phrase in &query.accent_phrases {
    for mora in &phrase.moras {
      if let (Some(consonant), Some(length)) = (&mora.consonant, mora.consonant_length) {
        lab.push(length, consonant);
      }
      if mora.vowel == "N" {
        lab.push(mora.vowel_length, "N");
      } else {
        lab.push(mora.vowel_length, &mora.vowel.to_lowercase());
      }
    }
    if let Some(pause) = &phrase.pause_mora {
      lab.push(pause.vowel_length, &pause.vowel);
    }
  }
  lab.push(query.post_phoneme_length, "pau");
  lab.text
}

#[cfg(test)]
mod tests {
  use super::lab_from_audio_query;
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
}
