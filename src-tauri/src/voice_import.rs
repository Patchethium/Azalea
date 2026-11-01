//! Voice import: turns a recording of the user reading a block's text into
//! that block's mora durations and pitches.
//!
//! The snfa forced aligner (its model downloaded as
//! [`ExtraPack::AlignerModel`](crate::commands::ExtraPack)) times each phoneme
//! of the block's own query, WORLD's Harvest estimates f0, and each voiced
//! mora takes the mean log f0 over its vowel. The pitches are the speaker's
//! own; the frontend maps them into the style's range before applying them.

use std::sync::OnceLock;

use typed_floats::{NonNaNFinite, PositiveFinite};
use voicevox_core::AccentPhrase;

use crate::audio::decode::{resample, MonoAudio};
use crate::audio::world::{self, F0Range, FRAME_PERIOD_MS};
use crate::config::manager::aligner_model_dir;

/// The model file in the aligner pack.
const MODEL_FILE: &str = "jp.safetensors";
/// Silence trimming before alignment, as snfa's README suggests.
const TRIM_TOP_DB: f64 = 20.0;
const TRIM_FRAME_LENGTH: usize = 2048;
const TRIM_HOP_LENGTH: usize = 512;
/// Shortest phoneme length written, so no phoneme disappears.
const MIN_PHONEME_SECONDS: f64 = 0.01;

static ALIGNER: OnceLock<snfa::Aligner> = OnceLock::new();

/// Whether the downloaded aligner model is in place.
pub fn model_available() -> bool {
  crate::commands::pack_present(crate::commands::ExtraPack::AlignerModel)
}

/// Supplies an already loaded aligner in place of the downloaded file, for
/// tests.
pub fn provide_aligner(aligner: snfa::Aligner) {
  let _ = ALIGNER.set(aligner);
}

/// Loads the downloaded model once. Failures are not cached, so a model
/// downloaded later is picked up.
fn aligner() -> Result<&'static snfa::Aligner, String> {
  if let Some(aligner) = ALIGNER.get() {
    return Ok(aligner);
  }
  if !model_available() {
    return Err("The voice import model is not downloaded".into());
  }
  let aligner = snfa::Aligner::from_path(aligner_model_dir()?.join(MODEL_FILE))
    .map_err(|e| format!("Failed to load the voice import model: {e}"))?;
  Ok(ALIGNER.get_or_init(|| aligner))
}

/// The block's query with the recording's timing and the speaker's pitch.
#[derive(Clone, Debug, serde::Serialize, specta::Type)]
pub struct VoiceImport {
  /// The input phrases with every mora and pause length replaced and each
  /// voiced mora's pitch set to the speaker's mean log f0 (0 elsewhere).
  pub accent_phrases: Vec<AccentPhrase>,
  /// Natural-log f0 of the trimmed recording every `frame_period_ms`, 0 when
  /// unvoiced.
  pub f0: Vec<f32>,
  pub frame_period_ms: f32,
  /// Length of the trimmed recording in seconds.
  pub duration: f32,
}

/// Whether VOICEVOX predicts a pitch for a mora with this vowel. Unvoiced
/// vowels (uppercase), `cl` and pauses have none.
fn is_voiced(vowel: &str) -> bool {
  matches!(vowel, "a" | "i" | "u" | "e" | "o" | "N")
}

/// The snfa phoneme for a VOICEVOX one. The model is uncased, so devoiced
/// vowels and `N` are lowercased, and the labialized `kw` and `gw`, which it
/// lacks, fall back to `k` and `g`.
fn snfa_phoneme(phoneme: &str) -> String {
  match phoneme {
    "kw" => "k".into(),
    "gw" => "g".into(),
    _ => phoneme.to_lowercase(),
  }
}

/// The phonemes to align, in order: each mora's consonant and vowel, then the
/// phrase's pause.
fn transcript(phrases: &[AccentPhrase]) -> Vec<String> {
  let mut phonemes = Vec::new();
  for phrase in phrases {
    for mora in &phrase.moras {
      if let Some(consonant) = &mora.consonant {
        phonemes.push(snfa_phoneme(&consonant.to_string()));
      }
      phonemes.push(snfa_phoneme(&mora.vowel.to_string()));
    }
    if phrase.pause_mora.is_some() {
      phonemes.push("pau".into());
    }
  }
  phonemes
}

fn length(segment: &snfa::Segment) -> Result<PositiveFinite<f32>, String> {
  let seconds = f64::from(segment.end_ms.saturating_sub(segment.start_ms)) / 1000.0;
  PositiveFinite::<f32>::new(seconds.max(MIN_PHONEME_SECONDS) as f32).map_err(|e| e.to_string())
}

/// Writes the aligned lengths into `phrases`. `segments` are the aligner's
/// output for [`transcript`] with the edge pauses it pads, which only absorb
/// the recording's leading and trailing silence. Returns each mora's vowel
/// span in milliseconds, in flattened order without pauses.
fn apply_durations(
  phrases: &mut [AccentPhrase],
  segments: &[snfa::Segment],
) -> Result<Vec<(u32, u32)>, String> {
  let expected = transcript(phrases).len() + 2;
  if segments.len() != expected {
    return Err(format!(
      "The alignment has {} segments, expected {expected}",
      segments.len()
    ));
  }
  let mut segments = segments[1..segments.len() - 1].iter();
  let mut spans = Vec::new();
  let mut next = || segments.next().ok_or("The alignment ended early");
  for phrase in phrases {
    for mora in &mut phrase.moras {
      if mora.consonant.is_some() {
        mora.consonant_length = Some(length(next()?)?);
      }
      let vowel = next()?;
      mora.vowel_length = length(vowel)?;
      spans.push((vowel.start_ms, vowel.end_ms));
    }
    if let Some(pause) = &mut phrase.pause_mora {
      pause.vowel_length = length(next()?)?;
    }
  }
  Ok(spans)
}

/// Mean natural-log f0 of the voiced frames in `[start_ms, end_ms)`.
fn mean_log_f0(f0: &[f64], (start_ms, end_ms): (u32, u32)) -> Option<f64> {
  let first = (f64::from(start_ms) / FRAME_PERIOD_MS).ceil() as usize;
  let last = (f64::from(end_ms) / FRAME_PERIOD_MS).ceil() as usize;
  let voiced: Vec<f64> = f0
    .get(first..last.min(f0.len()))
    .unwrap_or_default()
    .iter()
    .filter(|f| **f > 0.0)
    .map(|f| f.ln())
    .collect();
  (!voiced.is_empty()).then(|| voiced.iter().sum::<f64>() / voiced.len() as f64)
}

/// Fills the gaps of `values` (voiced moras Harvest found no voiced frame in)
/// linearly from the measured values around them, holding the first and last
/// measured values at the edges.
fn interpolate(values: &mut [Option<f64>]) -> Result<(), String> {
  let measured: Vec<(usize, f64)> = values
    .iter()
    .enumerate()
    .filter_map(|(i, v)| v.map(|v| (i, v)))
    .collect();
  let (Some(&first), Some(&last)) = (measured.first(), measured.last()) else {
    return Err("No voice was detected in the recording".into());
  };
  for (i, value) in values.iter_mut().enumerate() {
    if value.is_some() {
      continue;
    }
    let after = measured.partition_point(|(j, _)| *j < i);
    *value = Some(if after == 0 {
      first.1
    } else if after == measured.len() {
      last.1
    } else {
      let (i0, v0) = measured[after - 1];
      let (i1, v1) = measured[after];
      v0 + (v1 - v0) * (i - i0) as f64 / (i1 - i0) as f64
    });
  }
  Ok(())
}

/// Sets each voiced mora's pitch to its vowel's mean log f0 and every other
/// mora's to 0. `spans` come from [`apply_durations`].
fn apply_pitch(
  phrases: &mut [AccentPhrase],
  spans: &[(u32, u32)],
  f0: &[f64],
) -> Result<(), String> {
  let voiced: Vec<bool> = phrases
    .iter()
    .flat_map(|phrase| &phrase.moras)
    .map(|mora| is_voiced(&mora.vowel.to_string()))
    .collect();
  if voiced.len() != spans.len() {
    return Err("The alignment does not match the moras".into());
  }
  // Only voiced moras are interpolated, so unvoiced ones do not count as gaps.
  let mut measured: Vec<Option<f64>> = spans
    .iter()
    .zip(&voiced)
    .filter(|(_, voiced)| **voiced)
    .map(|(span, _)| mean_log_f0(f0, *span))
    .collect();
  if !measured.is_empty() {
    interpolate(&mut measured)?;
  }
  let mut measured = measured.into_iter().flatten();
  let moras = phrases
    .iter_mut()
    .flat_map(|phrase| phrase.moras.iter_mut());
  for (mora, voiced) in moras.zip(voiced) {
    let pitch = if voiced {
      measured.next().unwrap_or(0.0)
    } else {
      0.0
    };
    mora.pitch = NonNaNFinite::<f32>::new(pitch as f32).map_err(|e| e.to_string())?;
  }
  Ok(())
}

/// Aligns `audio` to `phrases` and returns them with the recording's timing
/// and the speaker's pitch.
pub fn import_voice(audio: &MonoAudio, phrases: Vec<AccentPhrase>) -> Result<VoiceImport, String> {
  let aligner = aligner()?;
  audio.check_length()?;
  if phrases.iter().all(|phrase| phrase.moras.is_empty()) {
    return Err("The text has nothing to read".into());
  }
  let audio = resample(audio, aligner.sample_rate())?;
  let range = snfa::trim_audio(
    &audio.samples,
    TRIM_TOP_DB,
    TRIM_FRAME_LENGTH,
    TRIM_HOP_LENGTH,
  )
  .ok_or("The recording is too short")?;
  let samples = &audio.samples[range];
  let phonemes = transcript(&phrases);
  let segments = aligner
    .align(samples, &phonemes, true)
    .map_err(|e| match e {
      snfa::Error::AudioTooShort | snfa::Error::TooManyPhonemes { .. } => {
        "The recording is too short for this text".to_string()
      }
      e => format!("Failed to align the recording: {e}"),
    })?;
  let mut phrases = phrases;
  let spans = apply_durations(&mut phrases, &segments)?;
  let x: Vec<f64> = samples.iter().map(|&s| f64::from(s)).collect();
  let f0 = world::harvest(&x, audio.sample_rate, F0Range::default())?;
  apply_pitch(&mut phrases, &spans, &f0)?;
  Ok(VoiceImport {
    accent_phrases: phrases,
    f0: f0
      .iter()
      .map(|&f| if f > 0.0 { f.ln() as f32 } else { 0.0 })
      .collect(),
    frame_period_ms: FRAME_PERIOD_MS as f32,
    duration: samples.len() as f32 / audio.sample_rate as f32,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  /// snfa's Japanese phoneme set, without the blank.
  const SNFA_PHONEMES: &[&str] = &[
    "a", "b", "by", "ch", "cl", "d", "dy", "e", "f", "g", "gy", "h", "hy", "i", "j", "k", "ky",
    "m", "my", "n", "ny", "o", "p", "py", "r", "ry", "s", "sh", "t", "ts", "ty", "u", "v", "w",
    "y", "z", "pau",
  ];

  #[test]
  fn every_voicevox_phoneme_maps_into_the_snfa_set() {
    // `Consonant` and `NonConsonant` of voicevox_core, without `sil`, which
    // never appears in a mora.
    let voicevox = [
      "b", "by", "ch", "d", "dy", "f", "g", "gw", "gy", "h", "hy", "j", "k", "kw", "ky", "m", "my",
      "n", "ny", "p", "py", "r", "ry", "s", "sh", "t", "ts", "ty", "v", "w", "y", "z", "pau", "A",
      "E", "I", "N", "O", "U", "a", "cl", "e", "i", "o", "u",
    ];
    for phoneme in voicevox {
      let mapped = snfa_phoneme(phoneme);
      assert!(
        SNFA_PHONEMES.contains(&mapped.as_str()),
        "{phoneme} -> {mapped}"
      );
    }
  }

  /// Phrases of `(consonant, vowel)` moras, each phrase optionally followed by
  /// a pause.
  fn phrases(spec: &[(&[(Option<&str>, &str)], bool)]) -> Vec<AccentPhrase> {
    spec
      .iter()
      .map(|(moras, pause)| {
        let mora = |consonant: Option<&str>, vowel: &str| {
          serde_json::json!({
            "text": "ア",
            "consonant": consonant,
            "consonant_length": consonant.map(|_| 0.05),
            "vowel": vowel,
            "vowel_length": 0.1,
            "pitch": 5.5,
          })
        };
        serde_json::from_value(serde_json::json!({
          "accent": 1,
          "moras": moras.iter().map(|(c, v)| mora(*c, v)).collect::<Vec<_>>(),
          "pause_mora": pause.then(|| mora(None, "pau")),
          "is_interrogative": false,
        }))
        .unwrap()
      })
      .collect()
  }

  fn segment(phoneme: &str, start_ms: u32, end_ms: u32) -> snfa::Segment {
    snfa::Segment {
      phoneme: phoneme.into(),
      start_ms,
      end_ms,
    }
  }

  #[test]
  fn transcript_lists_consonants_vowels_and_pauses() {
    let phrases = phrases(&[
      (&[(Some("k"), "o"), (None, "N")], true),
      (&[(Some("ch"), "I"), (Some("kw"), "a"), (None, "cl")], false),
    ]);
    assert_eq!(
      transcript(&phrases),
      ["k", "o", "n", "pau", "ch", "i", "k", "a", "cl"]
    );
  }

  #[test]
  fn durations_follow_the_segments_between_the_edge_pauses() {
    let mut phrases = phrases(&[
      (&[(Some("k"), "o"), (None, "N")], true),
      (&[(None, "a")], false),
    ]);
    let segments = [
      segment("pau", 0, 300),
      segment("k", 300, 340),
      segment("o", 340, 500),
      segment("n", 500, 580),
      segment("pau", 580, 900),
      segment("a", 900, 1000),
      segment("pau", 1000, 1400),
    ];
    let spans = apply_durations(&mut phrases, &segments).unwrap();
    assert_eq!(spans, [(340, 500), (500, 580), (900, 1000)]);
    let ko = &phrases[0].moras[0];
    assert!((f32::from(ko.consonant_length.unwrap()) - 0.04).abs() < 1e-6);
    assert!((f32::from(ko.vowel_length) - 0.16).abs() < 1e-6);
    assert!((f32::from(phrases[0].moras[1].vowel_length) - 0.08).abs() < 1e-6);
    let pause = phrases[0].pause_mora.as_ref().unwrap();
    assert!((f32::from(pause.vowel_length) - 0.32).abs() < 1e-6);
    assert!((f32::from(phrases[1].moras[0].vowel_length) - 0.1).abs() < 1e-6);
  }

  #[test]
  fn durations_never_reach_zero_and_mismatched_alignments_are_rejected() {
    let mut phrases = phrases(&[(&[(None, "a")], false)]);
    let segments = [
      segment("pau", 0, 10),
      segment("a", 10, 10),
      segment("pau", 10, 20),
    ];
    apply_durations(&mut phrases, &segments).unwrap();
    assert_eq!(f32::from(phrases[0].moras[0].vowel_length), 0.01);
    assert!(apply_durations(&mut phrases, &segments[..2]).is_err());
  }

  #[test]
  fn mean_log_f0_averages_voiced_frames_inside_the_span() {
    // Frames every 5 ms: 0, 5, 10, 15 ms.
    let f0 = [100.0, 200.0, 0.0, 400.0];
    let mean = mean_log_f0(&f0, (5, 20)).unwrap();
    assert!((mean - (200f64.ln() + 400f64.ln()) / 2.0).abs() < 1e-12);
    assert_eq!(mean_log_f0(&f0, (10, 15)), None);
    assert_eq!(mean_log_f0(&f0, (40, 60)), None);
  }

  #[test]
  fn interpolation_fills_gaps_and_holds_the_edges() {
    let mut values = [None, Some(1.0), None, None, Some(4.0), None];
    interpolate(&mut values).unwrap();
    assert_eq!(
      values,
      [
        Some(1.0),
        Some(1.0),
        Some(2.0),
        Some(3.0),
        Some(4.0),
        Some(4.0)
      ]
    );
    assert!(interpolate(&mut [None, None]).is_err());
  }

  #[test]
  fn pitch_is_measured_on_voiced_moras_and_zero_elsewhere() {
    // a (voiced, measured), U (unvoiced), cl, o (voiced, no voiced frame).
    let mut phrases = phrases(&[(
      &[
        (None, "a"),
        (Some("s"), "U"),
        (None, "cl"),
        (Some("t"), "o"),
      ],
      false,
    )]);
    let spans = [(0, 20), (20, 40), (40, 60), (60, 80)];
    let mut f0 = vec![0.0; 16];
    f0[..4].fill(150.0);
    f0[4..8].fill(300.0);
    apply_pitch(&mut phrases, &spans, &f0).unwrap();
    let pitches: Vec<f32> = phrases[0]
      .moras
      .iter()
      .map(|m| f32::from(m.pitch))
      .collect();
    assert!((pitches[0] - 150f32.ln()).abs() < 1e-5);
    assert_eq!(pitches[1], 0.0);
    assert_eq!(pitches[2], 0.0);
    // The unvoiced U's frames do not count; o holds the last measured value.
    assert!((pitches[3] - 150f32.ln()).abs() < 1e-5);
  }

  #[test]
  fn a_recording_without_voice_is_rejected() {
    let mut phrases = phrases(&[(&[(None, "a")], false)]);
    assert!(apply_pitch(&mut phrases, &[(0, 50)], &[0.0; 20])
      .unwrap_err()
      .contains("No voice"));
    assert!(apply_pitch(&mut phrases, &[], &[0.0; 20]).is_err());
  }

  #[test]
  fn text_without_voiced_moras_keeps_every_pitch_at_zero() {
    let mut phrases = phrases(&[(&[(Some("s"), "U"), (None, "cl")], false)]);
    apply_pitch(&mut phrases, &[(0, 20), (20, 40)], &[0.0; 10]).unwrap();
    assert!(phrases[0].moras.iter().all(|m| f32::from(m.pitch) == 0.0));
  }
}
