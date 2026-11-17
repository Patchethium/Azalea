//! Voice import: turns a recording of the user reading a block's text into
//! that block's mora durations and pitches.
//!
//! A recording is prepared once ([`PreparedVoice`]): resampled for the
//! aligner, trimmed, and analyzed with WORLD's Harvest. The chosen forced
//! aligner ([`VoiceAligner`]: snfa, its model downloaded as
//! [`ExtraPack::AlignerModel`](crate::commands::ExtraPack), or pydomino, see
//! [`domino`]) then times each
//! phoneme of the block's own query as [`VoiceSegment`]s, which the user may
//! adjust, and [`PreparedVoice::accent_phrases`] turns the segments into mora
//! lengths and pitches: each voiced mora takes the mean log f0 over its
//! vowel. The pitches are the speaker's own; the frontend maps them into the
//! style's range before applying them.

pub mod domino;

use std::sync::OnceLock;

use typed_floats::{NonNaNFinite, PositiveFinite};
use voicevox_core::AccentPhrase;

use crate::audio::decode::{resample, MonoAudio};
use crate::audio::world::{self, F0Range, FRAME_PERIOD_MS};
use crate::config::manager::aligner_model_dir;
use crate::config::types::VoiceAligner;
use crate::post::{display_spectrogram, f0_analysis, PostF0Analysis};

/// The model file in the aligner pack.
const MODEL_FILE: &str = "jp.safetensors";
/// The sample rate both aligners' models take.
pub const ALIGNER_SAMPLE_RATE: u32 = 16_000;
/// Silence trimming before alignment, as snfa's README suggests.
const TRIM_TOP_DB: f64 = 20.0;
const TRIM_FRAME_LENGTH: usize = 2048;
const TRIM_HOP_LENGTH: usize = 512;
/// Shortest phoneme length written, so no phoneme disappears.
pub const MIN_PHONEME_SECONDS: f64 = 0.01;
/// Harvest's search range for human voices: WORLD's default.
const VOICE_F0_RANGE: F0Range = F0Range {
  floor: 71.0,
  ceil: 800.0,
};

static ALIGNER: OnceLock<snfa::Aligner> = OnceLock::new();

/// Which aligner to use and how many threads it may take (0 for the
/// runtime's default), as the core's `cpu_num_threads`. snfa ignores the
/// thread count.
#[derive(Clone, Copy, Debug, Default)]
pub struct AlignOptions {
  pub aligner: VoiceAligner,
  pub cpu_num_threads: u16,
}

/// Whether `aligner`'s downloaded model is in place.
pub fn model_available(aligner: VoiceAligner) -> bool {
  match aligner {
    VoiceAligner::Snfa => {
      ALIGNER.get().is_some()
        || crate::commands::pack_present(crate::commands::ExtraPack::AlignerModel)
    }
    VoiceAligner::Pydomino => domino::model_available(),
  }
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
  if !model_available(VoiceAligner::Snfa) {
    return Err("The snfa model is not downloaded".into());
  }
  let aligner = snfa::Aligner::from_path(aligner_model_dir()?.join(MODEL_FILE))
    .map_err(|e| format!("Failed to load the snfa model: {e}"))?;
  if aligner.sample_rate() != ALIGNER_SAMPLE_RATE {
    return Err(format!(
      "The snfa model expects {} Hz audio",
      aligner.sample_rate()
    ));
  }
  Ok(ALIGNER.get_or_init(|| aligner))
}

/// One aligned phoneme of a recording, in seconds from the trimmed start.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct VoiceSegment {
  pub phoneme: String,
  pub start: f64,
  pub end: f64,
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

/// VOICEVOX's phonemes to align, in order: each mora's consonant and vowel,
/// then the phrase's pause.
fn voicevox_transcript(phrases: &[AccentPhrase]) -> Vec<String> {
  let mut phonemes = Vec::new();
  for phrase in phrases {
    for mora in &phrase.moras {
      if let Some(consonant) = &mora.consonant {
        phonemes.push(consonant.to_string());
      }
      phonemes.push(mora.vowel.to_string());
    }
    if phrase.pause_mora.is_some() {
      phonemes.push("pau".into());
    }
  }
  phonemes
}

/// The names segments carry, whichever aligner timed them: snfa's phonemes
/// for [`voicevox_transcript`].
fn transcript(phrases: &[AccentPhrase]) -> Vec<String> {
  voicevox_transcript(phrases)
    .iter()
    .map(|phoneme| snfa_phoneme(phoneme))
    .collect()
}

fn length(segment: &VoiceSegment) -> Result<PositiveFinite<f32>, String> {
  let seconds = (segment.end - segment.start).max(MIN_PHONEME_SECONDS);
  PositiveFinite::<f32>::new(seconds as f32).map_err(|e| e.to_string())
}

/// Checks that `segments` are [`transcript`]'s phonemes between the edge
/// pauses the aligner pads, contiguous and in order within `duration`.
fn validate_segments(
  phrases: &[AccentPhrase],
  segments: &[VoiceSegment],
  duration: f64,
) -> Result<(), String> {
  let mut expected = vec!["pau".to_string()];
  expected.extend(transcript(phrases));
  expected.push("pau".into());
  if segments.len() != expected.len()
    || segments
      .iter()
      .zip(&expected)
      .any(|(segment, phoneme)| segment.phoneme != *phoneme)
  {
    return Err("The alignment does not match the text".into());
  }
  let ordered = segments.iter().all(|segment| {
    segment.start.is_finite() && segment.end.is_finite() && segment.start <= segment.end
  }) && segments.windows(2).all(|pair| pair[0].end == pair[1].start);
  let first = segments.first().map_or(0.0, |segment| segment.start);
  let last = segments.last().map_or(0.0, |segment| segment.end);
  if !ordered || first < 0.0 || last > duration + 1e-6 {
    return Err("The alignment is not in order".into());
  }
  Ok(())
}

/// Writes the segments' lengths into `phrases`. The edge pauses only absorb
/// the recording's leading and trailing silence; the query's own
/// `pre_phoneme_length` and `post_phoneme_length` stay. Returns each mora's
/// vowel span in seconds, in flattened order without pauses.
fn apply_durations(
  phrases: &mut [AccentPhrase],
  segments: &[VoiceSegment],
) -> Result<Vec<(f64, f64)>, String> {
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
      spans.push((vowel.start, vowel.end));
    }
    if let Some(pause) = &mut phrase.pause_mora {
      pause.vowel_length = length(next()?)?;
    }
  }
  Ok(spans)
}

/// Mean natural-log f0 of the voiced frames in `[start, end)` seconds.
fn mean_log_f0(f0: &[f64], (start, end): (f64, f64)) -> Option<f64> {
  let first = (start * 1000.0 / FRAME_PERIOD_MS - 1e-9).ceil().max(0.0) as usize;
  let last = (end * 1000.0 / FRAME_PERIOD_MS - 1e-9).ceil().max(0.0) as usize;
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
  spans: &[(f64, f64)],
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

/// A recording ready to align: mono at the aligner's sample rate with its
/// leading and trailing silence trimmed, and its f0.
pub struct PreparedVoice {
  samples: Vec<f32>,
  sample_rate: u32,
  f0: Vec<f64>,
}

impl PreparedVoice {
  pub fn prepare(audio: &MonoAudio) -> Result<Self, String> {
    audio.check_length()?;
    let audio = resample(audio, ALIGNER_SAMPLE_RATE)?;
    let range = snfa::trim_audio(
      &audio.samples,
      TRIM_TOP_DB,
      TRIM_FRAME_LENGTH,
      TRIM_HOP_LENGTH,
    )
    .ok_or("The recording is too short")?;
    let samples = audio.samples[range].to_vec();
    let x: Vec<f64> = samples.iter().map(|&s| f64::from(s)).collect();
    let f0 = world::harvest(&x, audio.sample_rate, VOICE_F0_RANGE)?;
    Ok(Self {
      samples,
      sample_rate: audio.sample_rate,
      f0,
    })
  }

  /// Length of the trimmed recording in seconds.
  pub fn duration(&self) -> f64 {
    self.samples.len() as f64 / f64::from(self.sample_rate)
  }

  /// The f0 contour and spectrogram the voice tab draws.
  pub fn analysis(&self) -> PostF0Analysis {
    let x: Vec<f64> = self.samples.iter().map(|&s| f64::from(s)).collect();
    let spectrogram = display_spectrogram(&x, self.sample_rate, self.f0.len());
    f0_analysis(&self.f0, VOICE_F0_RANGE, self.duration(), &spectrogram)
  }

  /// The trimmed recording as 16-bit mono WAV, for playback.
  pub fn wav(&self) -> Result<Vec<u8>, String> {
    self.wav_range(0.0, None)
  }

  /// A sample-bounded part of the recording, with an exclusive end.
  pub fn wav_range(&self, start: f64, end: Option<f64>) -> Result<Vec<u8>, String> {
    let end = end.unwrap_or(self.duration());
    if !start.is_finite()
      || start < 0.0
      || !end.is_finite()
      || end <= start
      || start >= self.duration()
    {
      return Err("Playback range must have finite, non-negative times with end after start within the recording".into());
    }
    let start = (start * f64::from(self.sample_rate)).round() as usize;
    let end = ((end * f64::from(self.sample_rate)).round() as usize).min(self.samples.len());
    if start >= end {
      return Err("Playback range contains no audio samples".into());
    }
    let spec = hound::WavSpec {
      channels: 1,
      sample_rate: self.sample_rate,
      bits_per_sample: 16,
      sample_format: hound::SampleFormat::Int,
    };
    let mut wav = std::io::Cursor::new(Vec::new());
    let mut writer = hound::WavWriter::new(&mut wav, spec).map_err(|e| e.to_string())?;
    for sample in &self.samples[start..end] {
      let value = (sample * 32767.0).round().clamp(-32768.0, 32767.0) as i16;
      writer.write_sample(value).map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())?;
    Ok(wav.into_inner())
  }

  /// Times the phonemes of `phrases` in the recording, with an edge pause
  /// before and after them.
  pub fn align(
    &self,
    phrases: &[AccentPhrase],
    options: AlignOptions,
  ) -> Result<Vec<VoiceSegment>, String> {
    if phrases.iter().all(|phrase| phrase.moras.is_empty()) {
      return Err("The text has nothing to read".into());
    }
    let mut segments = match options.aligner {
      VoiceAligner::Snfa => self.align_snfa(phrases)?,
      VoiceAligner::Pydomino => self.align_domino(phrases, options.cpu_num_threads)?,
    };
    // The aligner's frames can end short of the last samples.
    let duration = self.duration();
    if let Some(last) = segments.last_mut() {
      last.end = last.end.max(duration);
    }
    Ok(segments)
  }

  fn align_domino(
    &self,
    phrases: &[AccentPhrase],
    cpu_num_threads: u16,
  ) -> Result<Vec<VoiceSegment>, String> {
    let mut phonemes = vec!["pau".to_string()];
    phonemes.extend(voicevox_transcript(phrases));
    phonemes.push("pau".into());
    let spans = domino::align(&self.samples, &phonemes, cpu_num_threads)?;
    let mut names = vec!["pau".to_string()];
    names.extend(transcript(phrases));
    names.push("pau".into());
    // The model's frames can run a little past the last samples.
    let duration = self.duration();
    Ok(
      names
        .into_iter()
        .zip(spans)
        .map(|(phoneme, (start, end))| VoiceSegment {
          phoneme,
          start: start.min(duration),
          end: end.min(duration),
        })
        .collect(),
    )
  }

  fn align_snfa(&self, phrases: &[AccentPhrase]) -> Result<Vec<VoiceSegment>, String> {
    let segments = aligner()?
      .align(&self.samples, &transcript(phrases), true)
      .map_err(|e| match e {
        snfa::Error::AudioTooShort | snfa::Error::TooManyPhonemes { .. } => {
          "The recording is too short for this text".to_string()
        }
        e => format!("Failed to align the recording: {e}"),
      })?;
    Ok(
      segments
        .into_iter()
        .map(|segment| VoiceSegment {
          phoneme: segment.phoneme,
          start: f64::from(segment.start_ms) / 1000.0,
          end: f64::from(segment.end_ms) / 1000.0,
        })
        .collect(),
    )
  }

  /// `phrases` with the lengths of `segments` and the speaker's pitch.
  pub fn accent_phrases(
    &self,
    mut phrases: Vec<AccentPhrase>,
    segments: &[VoiceSegment],
  ) -> Result<Vec<AccentPhrase>, String> {
    validate_segments(&phrases, segments, self.duration())?;
    let spans = apply_durations(&mut phrases, segments)?;
    apply_pitch(&mut phrases, &spans, &self.f0)?;
    Ok(phrases)
  }
}

/// Aligns `audio` to `phrases` and returns them with the recording's timing
/// and the speaker's pitch.
pub fn import_voice(
  audio: &MonoAudio,
  phrases: Vec<AccentPhrase>,
  options: AlignOptions,
) -> Result<Vec<AccentPhrase>, String> {
  let voice = PreparedVoice::prepare(audio)?;
  let segments = voice.align(&phrases, options)?;
  voice.accent_phrases(phrases, &segments)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn voice_playback_range_contains_only_selected_samples() {
    let voice = PreparedVoice {
      samples: vec![0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
      sample_rate: 10,
      f0: vec![],
    };
    let read = |start, end| {
      hound::WavReader::new(std::io::Cursor::new(voice.wav_range(start, end).unwrap()))
        .unwrap()
        .samples::<i16>()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
    };
    assert_eq!(read(0.2, Some(0.5)), vec![6553, 9830, 13107]);
    assert_eq!(read(0.8, None), vec![26214, 29490]);
    assert_eq!(read(0.8, Some(2.0)), read(0.8, None));
    for (start, end) in [
      (f64::NAN, Some(0.5)),
      (-0.1, Some(0.5)),
      (0.5, Some(f64::INFINITY)),
      (0.5, Some(0.5)),
      (0.6, Some(0.5)),
      (1.1, None),
      (0.2, Some(0.21)),
    ] {
      assert!(voice.wav_range(start, end).is_err(), "{start:?}..{end:?}");
    }
  }

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

  fn segment(phoneme: &str, start_ms: u32, end_ms: u32) -> VoiceSegment {
    VoiceSegment {
      phoneme: phoneme.into(),
      start: f64::from(start_ms) / 1000.0,
      end: f64::from(end_ms) / 1000.0,
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
    assert_eq!(spans, [(0.34, 0.5), (0.5, 0.58), (0.9, 1.0)]);
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
  fn segments_must_follow_the_text_in_order() {
    let phrases = phrases(&[(&[(Some("k"), "o")], false)]);
    let valid = [
      segment("pau", 0, 100),
      segment("k", 100, 150),
      segment("o", 150, 300),
      segment("pau", 300, 400),
    ];
    assert!(validate_segments(&phrases, &valid, 0.4).is_ok());
    let mut wrong_phoneme = valid.clone();
    wrong_phoneme[2].phoneme = "a".into();
    assert!(validate_segments(&phrases, &wrong_phoneme, 0.4).is_err());
    assert!(validate_segments(&phrases, &valid[..3], 0.4).is_err());
    let mut gap = valid.clone();
    gap[2].start = 0.16;
    assert!(validate_segments(&phrases, &gap, 0.4).is_err());
    let mut backwards = valid.clone();
    backwards[1].end = 0.09;
    backwards[2].start = 0.09;
    assert!(validate_segments(&phrases, &backwards, 0.4).is_err());
    assert!(validate_segments(&phrases, &valid, 0.3).is_err());
    let mut nan = valid.clone();
    nan[3].end = f64::NAN;
    assert!(validate_segments(&phrases, &nan, 0.4).is_err());
  }

  #[test]
  fn mean_log_f0_averages_voiced_frames_inside_the_span() {
    // Frames every 5 ms: 0, 5, 10, 15 ms.
    let f0 = [100.0, 200.0, 0.0, 400.0];
    let mean = mean_log_f0(&f0, (0.005, 0.02)).unwrap();
    assert!((mean - (200f64.ln() + 400f64.ln()) / 2.0).abs() < 1e-12);
    assert_eq!(mean_log_f0(&f0, (0.01, 0.015)), None);
    assert_eq!(mean_log_f0(&f0, (0.04, 0.06)), None);
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
    let spans = [(0.0, 0.02), (0.02, 0.04), (0.04, 0.06), (0.06, 0.08)];
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
    assert!(apply_pitch(&mut phrases, &[(0.0, 0.05)], &[0.0; 20])
      .unwrap_err()
      .contains("No voice"));
    assert!(apply_pitch(&mut phrases, &[], &[0.0; 20]).is_err());
  }

  #[test]
  fn text_without_voiced_moras_keeps_every_pitch_at_zero() {
    let mut phrases = phrases(&[(&[(Some("s"), "U"), (None, "cl")], false)]);
    apply_pitch(&mut phrases, &[(0.0, 0.02), (0.02, 0.04)], &[0.0; 10]).unwrap();
    assert!(phrases[0].moras.iter().all(|m| f32::from(m.pitch) == 0.0));
  }
}
