use std::io::Cursor;

use azalea_lib::{audio::spectal::MelSpec, core::Core};
use ndarray::Array1;

mod common;

use common::test_core_config;

/// Compatibility coverage for a real VOICEVOX installation.
#[test]
fn real_core_supports_the_complete_talk_pipeline() {
  let config = test_core_config();
  let core = Core::init(&config).expect("failed to initialize VOICEVOX Core");
  let style_id = core
    .metas
    .values()
    .flatten()
    .flat_map(|character| &character.styles)
    .map(|style| style.id)
    .next()
    .expect("the installation has no talk styles");

  let query = core
    .audio_query("こんにちは、Azaleaです。", style_id)
    .expect("audio query failed");
  assert!(!query.accent_phrases.is_empty());
  let phrases = core
    .accent_phrases("テスト音声です。", style_id)
    .expect("accent phrase generation failed");
  assert!(!phrases.is_empty());
  let phrase_count = phrases.len();
  assert_eq!(
    core
      .replace_mora(phrases.clone(), style_id)
      .expect("mora replacement failed")
      .len(),
    phrases.len()
  );
  assert_eq!(
    core
      .replace_mora_pitch(phrases.clone(), style_id)
      .expect("pitch replacement failed")
      .len(),
    phrases.len()
  );
  assert_eq!(
    core
      .replace_mora_duration(phrases, style_id)
      .expect("duration replacement failed")
      .len(),
    phrase_count
  );

  let wav = core
    .synthesis(&query, style_id)
    .expect("waveform synthesis failed");
  let reader = hound::WavReader::new(Cursor::new(&wav)).expect("synthesis did not return WAV");
  let spec = reader.spec();
  assert!(spec.sample_rate > 0);
  assert!(spec.channels > 0);
  let samples = reader
    .into_samples::<i16>()
    .collect::<Result<Vec<_>, _>>()
    .expect("synthesized WAV contains invalid samples");
  assert!(!samples.is_empty());

  let mono = Array1::from_iter(samples.into_iter().map(|sample| sample as f64));
  let mut mel = MelSpec::new(1024, 96, 256, spec.sample_rate as usize);
  let preview = mel.process(mono);
  assert_eq!(preview.nrows(), 96);
  assert!(preview.ncols() > 0);
  assert!(preview.iter().all(|value| value.is_finite()));
}
