use std::{collections::HashSet, io::Cursor, path::Path};

use azalea_lib::{audio::spectal::MelSpec, core::Core};
use hound::{SampleFormat, WavSpec};
use ndarray::Array1;
use voicevox_core::{AccentPhrase, Mora, StyleId, StyleType};

mod common;

use common::test_core_config;

const TEST_TEXT: &str = "こんにちは、Azaleaです。";

fn test_core() -> Core {
  Core::init(&test_core_config()).expect("failed to initialize VOICEVOX Core")
}

fn talk_style_ids(core: &Core) -> Vec<StyleId> {
  let mut ids = core.speaker_to_vvm.keys().copied().collect::<Vec<_>>();
  ids.sort_unstable();
  assert!(!ids.is_empty(), "the installation has no talk styles");
  ids
}

fn first_talk_style_id(core: &Core) -> StyleId {
  talk_style_ids(core)[0]
}

fn moras(phrases: &[AccentPhrase]) -> impl Iterator<Item = &Mora> {
  phrases
    .iter()
    .flat_map(|phrase| phrase.moras.iter().chain(phrase.pause_mora.iter()))
}

fn pitches(phrases: &[AccentPhrase]) -> Vec<f32> {
  moras(phrases).map(|mora| mora.pitch).collect()
}

fn phoneme_lengths(phrases: &[AccentPhrase]) -> Vec<(Option<f32>, f32)> {
  moras(phrases)
    .map(|mora| (mora.consonant_length, mora.vowel_length))
    .collect()
}

fn decode_wav(wav: &[u8]) -> (WavSpec, Vec<i16>) {
  let reader = hound::WavReader::new(Cursor::new(wav)).expect("synthesis did not return WAV");
  let spec = reader.spec();
  let samples = reader
    .into_samples::<i16>()
    .collect::<Result<Vec<_>, _>>()
    .expect("synthesized WAV contains invalid samples");
  (spec, samples)
}

#[test]
fn real_core_exposes_consistent_talk_metadata() {
  let core = test_core();
  let mapped_ids = core.speaker_to_vvm.keys().copied().collect::<HashSet<_>>();
  let mut metadata_ids = HashSet::new();

  assert!(
    !core.metas.is_empty(),
    "the installation has no VVM metadata"
  );
  for (model_path, characters) in &core.metas {
    assert!(
      Path::new(model_path).is_file(),
      "metadata points to a missing VVM: {model_path}"
    );
    for character in characters {
      assert!(!character.name.trim().is_empty());
      assert!(!character.speaker_uuid.trim().is_empty());
      for style in &character.styles {
        if style.r#type == StyleType::Talk {
          assert!(
            metadata_ids.insert(style.id),
            "duplicate talk style ID {}",
            style.id
          );
          assert!(!style.name.trim().is_empty());
        }
      }
    }
  }

  assert_eq!(
    metadata_ids, mapped_ids,
    "talk metadata and speaker-to-model mappings differ"
  );
}

#[test]
fn real_core_loads_lazily_and_unloads_models_idempotently() {
  let core = test_core();
  let style_id = first_talk_style_id(&core);
  let model_id = core.speaker_to_vvm[&style_id];
  let styles_in_model = core
    .speaker_to_vvm
    .iter()
    .filter_map(|(id, candidate)| (*candidate == model_id).then_some(*id))
    .collect::<Vec<_>>();

  assert!(styles_in_model
    .iter()
    .all(|id| !core.is_speaker_loaded(*id)));

  core
    .audio_query(TEST_TEXT, style_id)
    .expect("lazy model loading failed");
  assert!(styles_in_model.iter().all(|id| core.is_speaker_loaded(*id)));

  core
    .unload_speaker(style_id)
    .expect("speaker unloading failed");
  assert!(styles_in_model
    .iter()
    .all(|id| !core.is_speaker_loaded(*id)));
  core
    .unload_speaker(style_id)
    .expect("unloading an already-unloaded speaker should be harmless");

  core
    .load_speaker(style_id)
    .expect("explicit model loading failed");
  core
    .unload_all_speakers()
    .expect("unloading all speakers failed");
  assert!(talk_style_ids(&core)
    .into_iter()
    .all(|id| !core.is_speaker_loaded(id)));
  core
    .unload_all_speakers()
    .expect("unloading all speakers twice should be harmless");
}

#[test]
fn real_core_produces_valid_queries_and_interrogative_phrases() {
  let core = test_core();
  let style_id = first_talk_style_id(&core);
  let query = core
    .audio_query(TEST_TEXT, style_id)
    .expect("audio query failed");

  query.validate().expect("audio query is invalid");
  assert!(!query.accent_phrases.is_empty());
  assert!(query.kana.as_ref().is_some_and(|kana| !kana.is_empty()));
  assert!(query.speed_scale.is_finite() && query.speed_scale > 0.);
  assert!(query.volume_scale.is_finite() && query.volume_scale >= 0.);
  assert!(query.pre_phoneme_length >= 0.);
  assert!(query.post_phoneme_length >= 0.);
  assert!(query.output_sampling_rate > 0);

  for phrase in &query.accent_phrases {
    assert!(!phrase.moras.is_empty());
    assert!((1..=phrase.moras.len()).contains(&phrase.accent));
    for mora in moras(std::slice::from_ref(phrase)) {
      assert!(!mora.text.is_empty());
      assert!(!mora.vowel.is_empty());
      assert!(mora.vowel_length.is_finite() && mora.vowel_length >= 0.);
      assert!(mora.pitch.is_finite() && mora.pitch >= 0.);
      assert_eq!(mora.consonant.is_some(), mora.consonant_length.is_some());
    }
  }

  let question = core
    .accent_phrases("これはテストですか？", style_id)
    .expect("question accent phrase generation failed");
  assert!(
    question
      .last()
      .is_some_and(|phrase| phrase.is_interrogative),
    "Japanese question mark was not recognized as interrogative"
  );
}

#[test]
fn real_core_normalizes_mixed_kana_pronunciations() {
  let core = test_core();
  let style_id = first_talk_style_id(&core);

  for (input, expected) in [("こんじつ", "コンジツ"), ("コンニちは", "コンニチワ")]
  {
    let phrases = core
      .accent_phrases(input, style_id)
      .expect("accent phrase generation failed");
    let pronunciation = phrases
      .iter()
      .flat_map(|phrase| &phrase.moras)
      .map(|mora| mora.text.as_str())
      .collect::<String>();
    assert_eq!(pronunciation, expected, "unexpected reading for {input}");
  }
}

#[test]
fn real_core_mora_replacements_only_update_requested_values() {
  let core = test_core();
  let style_id = first_talk_style_id(&core);
  let original = core
    .accent_phrases("モーラの音高と長さを調整します。", style_id)
    .expect("accent phrase generation failed");
  let mut modified = original.clone();

  for phrase in &mut modified {
    for mora in phrase.moras.iter_mut().chain(phrase.pause_mora.iter_mut()) {
      mora.pitch += 0.5;
      mora.vowel_length += 0.01;
      if let Some(length) = &mut mora.consonant_length {
        *length += 0.01;
      }
    }
  }

  let pitch_replaced = core
    .replace_mora_pitch(modified.clone(), style_id)
    .expect("pitch replacement failed");
  assert_ne!(pitches(&pitch_replaced), pitches(&modified));
  assert_eq!(phoneme_lengths(&pitch_replaced), phoneme_lengths(&modified));

  let duration_replaced = core
    .replace_mora_duration(modified.clone(), style_id)
    .expect("duration replacement failed");
  assert_eq!(pitches(&duration_replaced), pitches(&modified));
  assert_ne!(
    phoneme_lengths(&duration_replaced),
    phoneme_lengths(&modified)
  );

  let all_replaced = core
    .replace_mora(modified.clone(), style_id)
    .expect("mora replacement failed");
  assert_ne!(pitches(&all_replaced), pitches(&modified));
  assert_ne!(phoneme_lengths(&all_replaced), phoneme_lengths(&modified));
}

#[test]
fn real_core_synthesis_honors_requested_wav_format() {
  let core = test_core();
  let style_id = first_talk_style_id(&core);
  let mut query = core
    .audio_query("出力形式を確認します。", style_id)
    .expect("audio query failed");
  query.output_sampling_rate = 48_000;
  query.output_stereo = true;

  let wav = core
    .synthesis(&query, style_id)
    .expect("waveform synthesis failed");
  let (spec, samples) = decode_wav(&wav);

  assert_eq!(spec.channels, 2);
  assert_eq!(spec.sample_rate, 48_000);
  assert_eq!(spec.bits_per_sample, 16);
  assert_eq!(spec.sample_format, SampleFormat::Int);
  assert!(!samples.is_empty());
  assert_eq!(samples.len() % spec.channels as usize, 0);
  assert!(samples.iter().any(|sample| *sample != 0));
}

#[test]
fn real_core_rejects_unknown_style_ids_without_loading_a_model() {
  let core = test_core();
  let style_id = StyleId::new(u32::MAX);

  assert!(!core.is_speaker_loaded(style_id));
  let error = core
    .audio_query(TEST_TEXT, style_id)
    .expect_err("an unknown style ID unexpectedly produced an audio query");
  assert!(
    format!("{error:#}").contains("Speaker ID not found"),
    "unexpected unknown-style error: {error:#}"
  );
  assert!(!core.is_speaker_loaded(style_id));
  core
    .unload_speaker(style_id)
    .expect("unloading an unknown style ID should be harmless");
}

/// Compatibility coverage for a real VOICEVOX installation.
#[test]
fn real_core_supports_the_complete_talk_pipeline() {
  let core = test_core();
  let style_id = first_talk_style_id(&core);

  let query = core
    .audio_query(TEST_TEXT, style_id)
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
  let (spec, samples) = decode_wav(&wav);
  assert!(spec.sample_rate > 0);
  assert!(spec.channels > 0);
  assert!(!samples.is_empty());

  let mono = Array1::from_iter(samples.into_iter().map(|sample| sample as f64));
  let mut mel = MelSpec::new(1024, 96, 256, spec.sample_rate as usize);
  let preview = mel.process(mono);
  assert_eq!(preview.nrows(), 96);
  assert!(preview.ncols() > 0);
  assert!(preview.iter().all(|value| value.is_finite()));
}
