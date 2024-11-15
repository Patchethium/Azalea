//! Copied from voicevox_core/crates/voicevox_core/src/engine/model.rs
//! renamed into audio_query.rs
//! removed the tests
//! add typescript export with ts_rs
#![allow(dead_code)]
use serde::{Deserialize, Serialize};
use specta::Type;

/* 各フィールドのjsonフィールド名はsnake_caseとする*/

/// モーラ（子音＋母音）ごとの情報。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Type)]
pub struct Mora {
  /// 文字。
  pub text: String,
  /// 子音の音素。
  pub consonant: Option<String>,
  /// 子音の音長。
  pub consonant_length: Option<f32>,
  /// 母音の音素。
  pub vowel: String,
  /// 母音の音長。
  pub vowel_length: f32,
  /// 音高。
  pub pitch: f32,
}

/// AccentPhrase (アクセント句ごとの情報)。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Type)]
pub struct AccentPhrase {
  /// モーラの配列。
  pub moras: Vec<Mora>,
  /// アクセント箇所。
  pub accent: usize,
  /// 後ろに無音を付けるかどうか。
  pub pause_mora: Option<Mora>,
  /// 疑問系かどうか。
  #[serde(default)]
  pub is_interrogative: bool,
}

impl AccentPhrase {
  pub(super) fn set_pause_mora(&mut self, pause_mora: Option<Mora>) {
    self.pause_mora = pause_mora;
  }

  pub(super) fn set_is_interrogative(&mut self, is_interrogative: bool) {
    self.is_interrogative = is_interrogative;
  }
}

/// AudioQuery (音声合成用のクエリ)。
#[derive(Clone, Deserialize, Serialize, PartialEq, Type)]
pub struct AudioQuery {
  /// アクセント句の配列。
  pub accent_phrases: Vec<AccentPhrase>,
  /// 全体の話速。
  pub speed_scale: f32,
  /// 全体の音高。
  pub pitch_scale: f32,
  /// 全体の抑揚。
  pub intonation_scale: f32,
  /// 全体の音量。
  pub volume_scale: f32,
  /// 音声の前の無音時間。
  pub pre_phoneme_length: f32,
  /// 音声の後の無音時間。
  pub post_phoneme_length: f32,
  /// 音声データの出力サンプリングレート。
  pub output_sampling_rate: u32,
  /// 音声データをステレオ出力するか否か。
  pub output_stereo: bool,
  /// \[読み取り専用\] AquesTalk風記法。
  ///
  /// [`Synthesizer::audio_query`]が返すもののみ`Some`となる。入力としてのAudioQueryでは無視され
  /// る。
  ///
  /// [`Synthesizer::audio_query`]: crate::blocking::Synthesizer::audio_query
  pub kana: Option<String>,
}

impl AudioQuery {
  pub fn with_kana(self, kana: Option<String>) -> Self {
    Self { kana, ..self }
  }
}

impl std::hash::Hash for AudioQuery {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    let serialized = serde_json::to_string(self).expect("Unable to serialize AudioQuery");
    serialized.hash(state);
  }
}

impl Eq for AudioQuery {}
