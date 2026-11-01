//! Voice import on the real pipeline: VOICEVOX speech imported against its own
//! query should come back with about the same timing and pitch.
//!
//! The aligner model is downloaded by the app; this test reads it from
//! `AZALEA_TEST_SNFA_MODEL` or the development pack directory
//! (`config_dev/snfa/jp.safetensors`).

use std::path::PathBuf;

use azalea_lib::{
  audio::decode::decode_file,
  core::Core,
  voice_import::{import_voice, provide_aligner},
};
use voicevox_core::{AccentPhrase, StyleId};

mod common;

use common::test_core_config;

const TEXT: &str = "木村さんは、わたしに写真を見せてくれました。";

fn provide_test_aligner() {
  let path = std::env::var_os("AZALEA_TEST_SNFA_MODEL")
    .map(PathBuf::from)
    .unwrap_or_else(|| {
      PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../config_dev/snfa/jp.safetensors")
    });
  let aligner = snfa::Aligner::from_path(&path).unwrap_or_else(|error| {
    panic!(
      "cannot load the aligner model at {} ({error}); download it from the config dialog's \
       voice import setting or set AZALEA_TEST_SNFA_MODEL",
      path.display()
    )
  });
  provide_aligner(aligner);
}

/// Each phoneme's end time from the first phoneme's start, in seconds.
fn boundaries(phrases: &[AccentPhrase]) -> Vec<f64> {
  let mut time = 0.0;
  let mut ends = Vec::new();
  let mut push = |length: f32| {
    time += f64::from(length);
    ends.push(time);
  };
  for phrase in phrases {
    for mora in &phrase.moras {
      if let Some(length) = mora.consonant_length {
        push(length.into());
      }
      push(mora.vowel_length.into());
    }
    if let Some(pause) = &phrase.pause_mora {
      push(pause.vowel_length.into());
    }
  }
  ends
}

fn voiced_pitches(phrases: &[AccentPhrase]) -> Vec<f64> {
  phrases
    .iter()
    .flat_map(|phrase| &phrase.moras)
    .map(|mora| f64::from(f32::from(mora.pitch)))
    .collect()
}

fn correlation(a: &[f64], b: &[f64]) -> f64 {
  let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len() as f64;
  let (ma, mb) = (mean(a), mean(b));
  let cov: f64 = a.iter().zip(b).map(|(x, y)| (x - ma) * (y - mb)).sum();
  let var = |v: &[f64], m: f64| v.iter().map(|x| (x - m).powi(2)).sum::<f64>();
  cov / (var(a, ma) * var(b, mb)).sqrt()
}

#[test]
fn real_core_voice_import_recovers_synthesized_timing_and_pitch() {
  provide_test_aligner();
  let core = Core::init(&test_core_config()).expect("failed to initialize VOICEVOX Core");
  let mut style_ids: Vec<StyleId> = core.speaker_to_vvm.keys().copied().collect();
  style_ids.sort_unstable();
  let style_id = style_ids[0];
  let query = core
    .audio_query(TEXT, style_id)
    .expect("audio query failed");
  let wav = core.synthesis(&query, style_id).expect("synthesis failed");

  let directory = tempfile::tempdir().unwrap();
  let path = directory.path().join("voice.wav");
  std::fs::write(&path, wav).unwrap();
  let audio = decode_file(&path).expect("the synthesized WAV must decode");

  // Start from unrelated timing and pitch, so nothing passes by being kept.
  let mut flat = query.accent_phrases.clone();
  for mora in flat.iter_mut().flat_map(|phrase| phrase.moras.iter_mut()) {
    mora.vowel_length = 0.1f32.try_into().unwrap();
    if mora.consonant_length.is_some() {
      mora.consonant_length = Some(0.05f32.try_into().unwrap());
    }
    mora.pitch = 5.0f32.try_into().unwrap();
  }
  let imported = import_voice(&audio, flat).expect("voice import failed");

  let expected = boundaries(&query.accent_phrases);
  let actual = boundaries(&imported.accent_phrases);
  assert_eq!(actual.len(), expected.len());
  let errors: Vec<f64> = expected
    .iter()
    .zip(&actual)
    .map(|(e, a)| (e - a).abs())
    .collect();
  let mean_error = errors.iter().sum::<f64>() / errors.len() as f64;
  println!("mean boundary error {:.1} ms", mean_error * 1000.0);
  assert!(mean_error < 0.04, "mean boundary error {mean_error:.3} s");

  // Unvoiced moras stay unvoiced, and voiced ones follow the synthesized contour.
  let expected = voiced_pitches(&query.accent_phrases);
  let actual = voiced_pitches(&imported.accent_phrases);
  for (e, a) in expected.iter().zip(&actual) {
    assert_eq!(
      *e == 0.0,
      *a == 0.0,
      "voicing differs: {expected:?} vs {actual:?}"
    );
  }
  let (e, a): (Vec<f64>, Vec<f64>) = expected
    .iter()
    .zip(&actual)
    .filter(|(e, _)| **e > 0.0)
    .map(|(e, a)| (*e, *a))
    .unzip();
  let r = correlation(&e, &a);
  let offset = a.iter().zip(&e).map(|(a, e)| a - e).sum::<f64>() / e.len() as f64;
  println!("pitch correlation {r:.3}, mean offset {offset:.3}");
  assert!(r > 0.8, "pitch correlation {r:.3}");
  assert!(offset.abs() < 0.1, "mean log-pitch offset {offset:.3}");

  assert!(imported.duration > 0.5);
  assert_eq!(imported.frame_period_ms, 5.0);
  assert!(imported.f0.iter().any(|f| *f > 0.0));
}
