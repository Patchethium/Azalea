use std::{
  collections::HashSet,
  io::Cursor,
  path::Path,
  sync::Arc,
  time::{Duration, Instant},
};

use azalea_lib::{
  audio::spectal::MelSpec,
  core::Core,
  english::EnglishOptions,
  streaming::{start_frame, StreamPlan, DEFAULT_CHUNK_SCHEDULE},
};
use hound::{SampleFormat, WavSpec};
use ndarray::Array1;
use serde::{Deserialize, Serialize};
use voicevox_core::{
  blocking::UserDict, AccentPhrase, AudioQuery, Mora, PitchNoiseOptions, StyleId, StyleType,
  UserDictWord,
};

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
fn real_core_pitch_completion_preserves_prefix_and_changes_suffix() {
  let core = test_core();
  let style_id = first_talk_style_id(&core);
  let mut query = core.audio_query(TEST_TEXT, style_id).unwrap();
  let original = query.accent_phrases.clone();
  let options = PitchNoiseOptions {
    sigma: 0.05,
    seed: 42,
  };
  let noisy = core
    .complete_mora_pitch(original.clone(), style_id, &[], options)
    .unwrap();
  let original_pitches = pitches(&noisy);
  let mut prefix = original_pitches[..3].to_vec();
  let edited = prefix.iter().rposition(|p| *p > 0.0).unwrap();
  prefix[edited] += 0.3;
  let completed = core
    .complete_mora_pitch(original.clone(), style_id, &prefix, options)
    .unwrap();
  assert_eq!(&pitches(&completed)[..prefix.len()], prefix.as_slice());
  assert!(pitches(&completed)[prefix.len()..]
    .iter()
    .zip(&original_pitches[prefix.len()..])
    .any(|(a, b)| (a - b).abs() > 1e-6));
  assert_eq!(
    completed,
    core
      .complete_mora_pitch(original.clone(), style_id, &prefix, options)
      .unwrap()
  );
  let mut restored = completed.clone();
  for (new, old) in restored.iter_mut().zip(&original) {
    for (new, old) in new
      .moras
      .iter_mut()
      .chain(new.pause_mora.iter_mut())
      .zip(old.moras.iter().chain(old.pause_mora.iter()))
    {
      if old.pitch == 0.0 {
        assert_eq!(new.pitch, 0.0);
      }
      new.pitch = old.pitch;
    }
  }
  assert_eq!(restored, original);
  query.accent_phrases = completed;
  assert!(!core.synthesis(&query, style_id).unwrap().is_empty());
}

#[test]
fn real_core_pitch_noise_is_seeded_and_preserves_non_pitch_fields() {
  let core = test_core();
  let style_id = first_talk_style_id(&core);
  let mut query = core.audio_query(TEST_TEXT, style_id).unwrap();
  let original = query.accent_phrases.clone();
  let generate = |sigma, seed| {
    core
      .apply_pitch_noise(
        original.clone(),
        style_id,
        Some(PitchNoiseOptions { sigma, seed }),
      )
      .unwrap()
  };
  assert_eq!(
    core
      .apply_pitch_noise(original.clone(), style_id, None)
      .unwrap(),
    original
  );
  let zero = generate(0.0, 42);
  for (actual, expected) in pitches(&zero).iter().zip(pitches(&original)) {
    assert!((actual - expected).abs() <= 1e-6);
  }
  let noisy = generate(0.05, 42);
  assert_eq!(noisy, generate(0.05, 42));
  assert_ne!(pitches(&noisy), pitches(&original));
  assert_ne!(pitches(&noisy), pitches(&generate(0.05, 43)));
  assert_ne!(pitches(&noisy), pitches(&generate(0.1, 42)));
  let mut without_noise = noisy.clone();
  for (actual, expected) in without_noise.iter_mut().zip(&original) {
    for (actual, expected) in actual
      .moras
      .iter_mut()
      .chain(actual.pause_mora.iter_mut())
      .zip(expected.moras.iter().chain(expected.pause_mora.iter()))
    {
      assert!(actual.pitch.is_finite());
      if expected.pitch == 0.0 {
        assert_eq!(actual.pitch, 0.0);
      }
      actual.pitch = expected.pitch;
    }
  }
  assert_eq!(without_noise, original);
  query.accent_phrases = noisy;
  assert!(!core.synthesis(&query, style_id).unwrap().is_empty());
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
fn real_core_applies_and_clears_user_dictionary_entries() {
  let core = test_core();
  let style_id = first_talk_style_id(&core);
  let pronunciation = |phrases: Vec<AccentPhrase>| {
    phrases
      .iter()
      .flat_map(|phrase| &phrase.moras)
      .map(|mora| mora.text.as_str())
      .collect::<String>()
  };
  let original = pronunciation(
    core
      .accent_phrases("Azalea", style_id)
      .expect("accent phrase generation failed"),
  );
  let dictionary = UserDict::new();
  dictionary
    .add_word(
      UserDictWord::builder()
        .build("Azalea", "テスト".into(), 1)
        .expect("test dictionary word is invalid"),
    )
    .expect("failed to add dictionary word");

  core
    .use_user_dictionary(&dictionary)
    .expect("failed to apply user dictionary");
  for surface in ["azalea", "Azalea", "AZALEA"] {
    let registered = pronunciation(
      core
        .accent_phrases(surface, style_id)
        .expect("accent phrase generation with dictionary failed"),
    );
    assert_eq!(registered, "テスト", "dictionary missed {surface}");
    assert_ne!(registered, original);
  }

  core
    .use_user_dictionary(&UserDict::new())
    .expect("failed to clear user dictionary");
  let cleared = pronunciation(
    core
      .accent_phrases("Azalea", style_id)
      .expect("accent phrase generation after clearing dictionary failed"),
  );
  assert_eq!(cleared, original);
}

#[test]
fn real_core_reads_unknown_english_words_through_e2k() {
  let core = test_core();
  let style_id = first_talk_style_id(&core);
  let all = Some(EnglishOptions {
    accent_prediction: true,
    ngram_filter: true,
  });
  let reading = |text: &str, english: Option<EnglishOptions>| {
    core
      .accent_phrases_with_english(text, style_id, english)
      .expect("accent phrase generation failed")
      .iter()
      .map(|phrase| {
        let text = phrase
          .moras
          .iter()
          .map(|mora| mora.text.as_str())
          .collect::<String>();
        format!("{text}:{}", phrase.accent)
      })
      .collect::<Vec<_>>()
      .join(" ")
  };

  assert_eq!(
    reading("こんにちは", all),
    reading("こんにちは", None),
    "Japanese text is analyzed as before"
  );
  let spelled = reading("Geogaddiです", None);
  let transformed = reading("Geogaddiです", all);
  assert_ne!(transformed, spelled);
  assert!(
    transformed.chars().filter(|&c| c != ' ').count() < spelled.len() / 3,
    "{transformed} should be shorter than {spelled}"
  );
  // OpenJTalk would read the substituted ヘ as the particle エ.
  assert!(
    reading("hello", all).starts_with('ヘ'),
    "{}",
    reading("hello", all)
  );
  // Words OpenJTalk knows and acronyms the n-gram filter rejects keep their reading.
  assert_eq!(reading("iPhoneを", all), reading("iPhoneを", None));
  assert_eq!(reading("GPUと", all), reading("GPUと", None));
  // Without the filter, VOICEVOX ENGINE's rules spell all-capital words and split camel case.
  let engine_rules = Some(EnglishOptions {
    accent_prediction: true,
    ngram_filter: false,
  });
  assert_eq!(reading("GPUと", engine_rules), reading("GPUと", None));
  assert_ne!(
    reading("VoiceVoxは", engine_rules),
    reading("VoiceVoxは", None)
  );
  let query = core
    .audio_query_with_english("Geogaddiです", style_id, all)
    .expect("audio query generation failed");
  assert!(pitches(&query.accent_phrases)
    .iter()
    .any(|&pitch| pitch > 0.0));

  // A user dictionary entry takes precedence over e2k.
  let dictionary = UserDict::new();
  dictionary
    .add_word(
      UserDictWord::builder()
        .build("Geogaddi", "テスト".into(), 1)
        .expect("test dictionary word is invalid"),
    )
    .expect("failed to add dictionary word");
  core
    .use_user_dictionary(&dictionary)
    .expect("failed to apply user dictionary");
  assert!(reading("Geogaddi", all).starts_with("テスト"));
  core
    .use_user_dictionary(&UserDict::new())
    .expect("failed to clear user dictionary");
  assert_eq!(reading("Geogaddiです", all), transformed);
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

/// Chunked rendering can differ from whole-utterance synthesis by float rounding, so samples
/// may differ by one quantization step.
fn assert_waveforms_match(streamed: &[u8], whole: &[u8]) {
  let (streamed_spec, streamed) = decode_wav(streamed);
  let (whole_spec, whole) = decode_wav(whole);
  assert_eq!(streamed_spec, whole_spec);
  assert_eq!(streamed.len(), whole.len());
  let max_difference = streamed
    .iter()
    .zip(&whole)
    .map(|(a, b)| (i32::from(*a) - i32::from(*b)).abs())
    .max()
    .unwrap_or(0);
  assert!(
    max_difference <= 1,
    "streamed samples differ from whole synthesis by {max_difference}"
  );
}

#[test]
fn real_core_streamed_chunks_match_whole_synthesis() {
  let core = test_core();
  let style_id = first_talk_style_id(&core);
  assert!(
    core
      .supports_streaming(style_id)
      .expect("streaming support check failed"),
    "the installed talk model does not support segmented rendering"
  );
  let mut query = core
    .audio_query("ストリーミング合成を確認します。", style_id)
    .expect("audio query failed");
  query.output_sampling_rate = 48_000;
  query.output_stereo = true;
  let whole = core
    .synthesis(&query, style_id)
    .expect("waveform synthesis failed");

  let audio = core
    .prepare_streaming(&query, style_id)
    .expect("streaming preparation failed");
  let frame_length = audio.frame_length();
  assert!(frame_length > 2 * voicevox_core::DEFAULT_STREAMING_CHUNK_FRAMES);
  // Seek to the middle so the plan renders out of order, then reassemble in frame order.
  let start_at = Duration::from_secs_f64(audio.duration_seconds() / 2.0);
  let plan = StreamPlan::new(frame_length, DEFAULT_CHUNK_SCHEDULE, start_frame(start_at));
  assert!(plan.first_played > 0);
  let mut parts = vec![Vec::new(); plan.chunks.len()];
  for &index in &plan.order {
    parts[index] = core
      .render_streaming(&audio, plan.chunks[index].clone())
      .expect("chunk rendering failed");
  }
  assert_waveforms_match(&audio.wav(&parts.concat()), &whole);

  tauri::async_runtime::block_on(async {
    core
      .prepare_nonblocking_synthesis(style_id)
      .await
      .expect("nonblocking model loading failed");
    assert!(core.supports_streaming_nonblocking(style_id));
    let audio = core
      .prepare_streaming_nonblocking(&query, style_id)
      .await
      .expect("nonblocking streaming preparation failed");
    let mut pcm = Vec::new();
    for range in StreamPlan::new(frame_length, DEFAULT_CHUNK_SCHEDULE, 0).chunks {
      pcm.extend(
        core
          .render_streaming_nonblocking(&audio, range)
          .await
          .expect("nonblocking chunk rendering failed"),
      );
    }
    assert_waveforms_match(&audio.wav(&pcm), &whole);
  });
}

#[test]
fn real_core_nonblocking_synthesis_can_be_cancelled() {
  tauri::async_runtime::block_on(async {
    let core = Arc::new(test_core());
    let style_id = first_talk_style_id(&core);
    let short_query = core
      .audio_query(TEST_TEXT, style_id)
      .expect("audio query failed");

    let warmup_started = Instant::now();
    core
      .synthesis_nonblocking(&short_query, style_id)
      .await
      .expect("nonblocking warm-up synthesis failed");
    let warmup_elapsed = warmup_started.elapsed();

    let mut long_query = short_query.clone();
    let phrase_template = long_query.accent_phrases.clone();
    long_query.accent_phrases = (0..32).flat_map(|_| phrase_template.clone()).collect();
    let long_core = core.clone();
    let long_job =
      tokio::spawn(async move { long_core.synthesis_nonblocking(&long_query, style_id).await });

    tokio::time::sleep(Duration::from_millis(250)).await;
    assert!(
      !long_job.is_finished(),
      "long synthesis finished before cancellation could be tested"
    );
    long_job.abort();
    let join_error = tokio::time::timeout(Duration::from_secs(5), long_job)
      .await
      .expect("the canceled synthesis task did not stop before the timeout")
      .expect_err("the canceled synthesis task unexpectedly completed normally");
    assert!(
      join_error.is_cancelled(),
      "synthesis task failed: {join_error}"
    );

    let follow_up_timeout = warmup_elapsed
      .checked_mul(10)
      .unwrap_or(Duration::from_secs(60))
      .min(Duration::from_secs(60))
      .max(Duration::from_secs(5));
    let follow_up = tokio::time::timeout(
      follow_up_timeout,
      core.synthesis_nonblocking(&short_query, style_id),
    )
    .await
    .expect("follow-up synthesis remained blocked behind canceled inference")
    .expect("follow-up nonblocking synthesis failed");
    assert!(!follow_up.is_empty());
  });
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

/// Loaded projects keep edited queries without recreating them, so mora
/// replacement and pitch completion must load the model themselves.
#[test]
fn real_core_mora_operations_load_models_on_demand() {
  let core = test_core();
  let style_id = first_talk_style_id(&core);
  let phrases = core
    .audio_query(TEST_TEXT, style_id)
    .unwrap()
    .accent_phrases;
  let noise = PitchNoiseOptions {
    sigma: 0.05,
    seed: 42,
  };
  type Operation<'a> = (
    &'a str,
    Box<dyn Fn() -> anyhow::Result<Vec<AccentPhrase>> + 'a>,
  );
  let operations: [Operation; 5] = [
    (
      "replace_mora",
      Box::new(|| core.replace_mora(phrases.clone(), style_id)),
    ),
    (
      "replace_mora_pitch",
      Box::new(|| core.replace_mora_pitch(phrases.clone(), style_id)),
    ),
    (
      "replace_mora_duration",
      Box::new(|| core.replace_mora_duration(phrases.clone(), style_id)),
    ),
    (
      "apply_pitch_noise",
      Box::new(|| core.apply_pitch_noise(phrases.clone(), style_id, Some(noise))),
    ),
    (
      "complete_mora_pitch",
      Box::new(|| core.complete_mora_pitch(phrases.clone(), style_id, &[], noise)),
    ),
  ];
  for (name, operation) in operations {
    core.unload_all_speakers().unwrap();
    assert!(!core.is_speaker_loaded(style_id));
    let replaced = operation().unwrap_or_else(|error| panic!("{name} failed: {error:#}"));
    assert_eq!(replaced.len(), phrases.len(), "{name}");
    assert!(core.is_speaker_loaded(style_id), "{name} did not load");
  }

  // Disabled noise needs no model and leaves the phrases untouched.
  core.unload_all_speakers().unwrap();
  assert_eq!(
    core
      .apply_pitch_noise(phrases.clone(), style_id, None)
      .unwrap(),
    phrases
  );
  assert!(!core.is_speaker_loaded(style_id));
  let error = core
    .replace_mora_pitch(phrases, StyleId::new(u32::MAX))
    .expect_err("an unknown style ID unexpectedly replaced pitch");
  assert!(
    format!("{error:#}").contains("Speaker ID not found"),
    "unexpected unknown-style error: {error:#}"
  );
}

/// Mirrors how a pitch-edited query reaches disk: IPC JSON, then project TOML.
fn round_trip_project_query(query: &AudioQuery) -> AudioQuery {
  #[derive(Deserialize, Serialize)]
  struct Block {
    query_override: AudioQuery,
  }
  let ipc: AudioQuery = serde_json::from_str(&serde_json::to_string(query).unwrap()).unwrap();
  let saved = toml::to_string(&Block {
    query_override: ipc,
  })
  .unwrap();
  toml::from_str::<Block>(&saved).unwrap().query_override
}

/// Relative tuning compares a saved query's untouched pitches with a baseline
/// predicted again after loading, through a different command and core
/// instance. Any difference would show as drift on moras the user never edited,
/// so the regenerated baseline must match bit for bit.
#[test]
fn real_core_predicted_pitch_is_identical_after_reloading_a_project() {
  for noise in [
    None,
    Some(PitchNoiseOptions {
      sigma: 0.05,
      seed: 42,
    }),
  ] {
    // First session: create the query as the audio_query command does.
    let first = test_core();
    let style_id = first_talk_style_id(&first);
    let mut query = first.audio_query(TEST_TEXT, style_id).unwrap();
    query.accent_phrases = first
      .apply_pitch_noise(query.accent_phrases, style_id, noise)
      .unwrap();
    let generated = pitches(&query.accent_phrases);
    assert!(generated.iter().any(|pitch| *pitch > 0.0));
    drop(first);

    // Second session: load the project and predict the baseline as the
    // replace_mora_pitch command does.
    let loaded = round_trip_project_query(&query);
    assert_eq!(pitches(&loaded.accent_phrases), generated);
    // A fresh core has no models loaded; prediction must load it on demand.
    let second = test_core();
    assert!(!second.is_speaker_loaded(style_id));
    let predict = |phrases: Vec<AccentPhrase>| {
      second
        .apply_pitch_noise(
          second.replace_mora_pitch(phrases, style_id).unwrap(),
          style_id,
          noise,
        )
        .unwrap()
    };
    let baseline = predict(loaded.accent_phrases.clone());
    let (generated_bits, baseline_bits): (Vec<_>, Vec<_>) = generated
      .iter()
      .zip(pitches(&baseline))
      .map(|(generated, baseline)| (generated.to_bits(), baseline.to_bits()))
      .unzip();
    assert_eq!(
      baseline_bits,
      generated_bits,
      "baseline drifted after reload with {noise:?}: {:?} != {generated:?}",
      pitches(&baseline),
    );
    // Repeated predictions in the same session stay identical as well.
    assert_eq!(predict(loaded.accent_phrases), baseline);
  }
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
