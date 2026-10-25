//! Reads English words OpenJTalk cannot pronounce through the e2k models.
//!
//! OpenJTalk spells unknown alphabet words letter by letter. Before analysis,
//! each such word is replaced with the katakana e2k transliterates it to, and
//! the predicted accent nucleus is applied to the accent phrase it starts.
//! Moras OpenJTalk misreads in the substituted katakana, such as a leading ヘ
//! read as the particle エ, are restored from the katakana itself.

mod kana;

use std::{
  collections::HashMap,
  num::NonZero,
  ops::Range,
  sync::{Mutex, OnceLock},
};

use anyhow::{anyhow, Result};
use e2k::{AccentPredictor, NGram, C2K};
use typed_floats::tf32;
use voicevox_core::{blocking::TextAnalyzer, AccentPhrase, Mora};

/// How unknown English words are read, present only when the transform is enabled.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct EnglishOptions {
  /// Applies e2k's predicted accent nucleus instead of OpenJTalk's.
  pub accent_prediction: bool,
  /// Transliterates only words the n-gram model reads as words, leaving acronyms spelled out.
  /// Without it, VOICEVOX ENGINE's rules decide.
  pub ngram_filter: bool,
  /// Transliterates with e2k's distilled turbo model instead of the base one.
  pub turbo: bool,
}

/// Leaves room for long words; e2k's default of 16 symbols truncates them.
const C2K_MAX_LEN: usize = 32;
/// Bounds the per-word cache; it is cleared wholesale when full.
const CACHE_LIMIT: usize = 4096;

/// OpenJTalk's letter names, used to recognize the spelled-out reading of an unknown word.
/// https://github.com/VOICEVOX/open_jtalk/blob/b9b1bf6a0cba6bc9550b4521913b20334a218dfc/src/njd_set_pronunciation/njd_set_pronunciation_rule_utf_8.h#L397
const LETTER_NAMES: [&str; 26] = [
  "エー",
  "ビー",
  "シー",
  "ディー",
  "イー",
  "エフ",
  "ジー",
  "エイチ",
  "アイ",
  "ジェー",
  "ケー",
  "エル",
  "エム",
  "エヌ",
  "オー",
  "ピー",
  "キュー",
  "アール",
  "エス",
  "ティー",
  "ユー",
  "ブイ",
  "ダブリュー",
  "エックス",
  "ワイ",
  "ズィー",
];

/// The models one reading uses; each is loaded once per process, on first use.
#[derive(Clone, Copy)]
struct Models {
  c2k: &'static C2K,
  accent: &'static AccentPredictor,
  ngram: &'static NGram,
}

type Loaded<T> = OnceLock<std::result::Result<T, String>>;

fn load<T>(cell: &'static Loaded<T>, init: impl FnOnce() -> e2k::Result<T>) -> Result<&'static T> {
  cell
    .get_or_init(|| init().map_err(|e| e.to_string()))
    .as_ref()
    .map_err(|e| anyhow!("failed to load the English reading models: {e}"))
}

/// The embedded models, with the turbo C2K model when `turbo` is set. The model that is not
/// selected is never loaded.
fn models(turbo: bool) -> Result<Models> {
  static C2K_BASE: Loaded<C2K> = OnceLock::new();
  static C2K_TURBO: Loaded<C2K> = OnceLock::new();
  static ACCENT: Loaded<AccentPredictor> = OnceLock::new();
  static NGRAM: Loaded<NGram> = OnceLock::new();
  let c2k = if turbo {
    load(&C2K_TURBO, || {
      Ok(C2K::embedded_turbo()?.with_max_len(C2K_MAX_LEN))
    })?
  } else {
    load(&C2K_BASE, || Ok(C2K::embedded()?.with_max_len(C2K_MAX_LEN)))?
  };
  Ok(Models {
    c2k,
    accent: load(&ACCENT, AccentPredictor::embedded)?,
    ngram: load(&NGRAM, NGram::embedded)?,
  })
}

pub(crate) fn is_english_letter(character: char) -> bool {
  character.is_ascii_alphabetic()
    || matches!(character, '\u{ff21}'..='\u{ff3a}' | '\u{ff41}'..='\u{ff5a}')
}

fn to_hankaku(character: char) -> char {
  match character {
    '\u{ff21}'..='\u{ff3a}' | '\u{ff41}'..='\u{ff5a}' => {
      char::from_u32(character as u32 - 0xfee0).unwrap_or(character)
    }
    _ => character,
  }
}

/// Byte ranges of the maximal runs of English letters in `text`.
fn english_runs(text: &str) -> Vec<Range<usize>> {
  let mut runs = Vec::new();
  let mut start = None;
  for (index, character) in text.char_indices() {
    match (is_english_letter(character), start) {
      (true, None) => start = Some(index),
      (false, Some(begin)) => {
        runs.push(begin..index);
        start = None;
      }
      _ => {}
    }
  }
  if let Some(begin) = start {
    runs.push(begin..text.len());
  }
  runs
}

/// OpenJTalk's letter-by-letter reading of ASCII letters.
fn spell_out(word: &str) -> String {
  word
    .bytes()
    .filter(u8::is_ascii_alphabetic)
    .map(|letter| LETTER_NAMES[usize::from(letter.to_ascii_uppercase() - b'A')])
    .collect()
}

/// Splits at capitals like VOICEVOX ENGINE: `VoiceVox` is `Voice` and `Vox`, `NASA` is four letters.
fn split_camel_case(word: &str) -> Vec<&str> {
  let mut pieces = Vec::new();
  let mut start = 0;
  for (index, character) in word.char_indices().skip(1) {
    if character.is_ascii_uppercase() {
      pieces.push(&word[start..index]);
      start = index;
    }
  }
  pieces.push(&word[start..]);
  pieces
}

/// VOICEVOX ENGINE spells single letters and all-capital pieces instead of transliterating them.
fn spelled_by_engine_rules(piece: &str) -> bool {
  piece.len() == 1 || !piece.bytes().any(|letter| letter.is_ascii_lowercase())
}

/// The katakana reading of an unknown ASCII word, or `None` to keep OpenJTalk's spelling.
fn transliterate(models: Models, word: &str, ngram_filter: bool) -> Option<String> {
  if word.len() < 2 {
    return None;
  }
  let reading = if ngram_filter {
    let lower = word.to_ascii_lowercase();
    if !models.ngram.is_valid(&lower) {
      return None;
    }
    models.c2k.infer(&lower)
  } else {
    let pieces = split_camel_case(word);
    if pieces.iter().all(|piece| spelled_by_engine_rules(piece)) {
      return None;
    }
    pieces
      .into_iter()
      .map(|piece| {
        let reading = if spelled_by_engine_rules(piece) {
          String::new()
        } else {
          models.c2k.infer(&piece.to_ascii_lowercase())
        };
        if reading.is_empty() {
          spell_out(piece)
        } else {
          reading
        }
      })
      .collect()
  };
  (!reading.is_empty()).then_some(reading)
}

/// A mora's phonemes, ignoring vowel devoicing, which depends on context.
type MoraKey = (Option<String>, String);

fn mora_key(mora: &Mora) -> MoraKey {
  (
    mora.consonant.map(|consonant| consonant.to_string()),
    mora.vowel.to_string().to_lowercase(),
  )
}

fn mora_keys(phrases: &[AccentPhrase]) -> Vec<MoraKey> {
  phrases
    .iter()
    .flat_map(|phrase| &phrase.moras)
    .map(mora_key)
    .collect()
}

/// A mora's text and phonemes, read directly from katakana.
#[derive(Clone, Debug, PartialEq)]
struct KanaMora {
  text: String,
  consonant: Option<String>,
  vowel: String,
}

/// Reads katakana mora by mora, taking the longest kana first and extending the
/// previous vowel for ー. `None` when a symbol has no mora.
fn kana_moras(katakana: &str) -> Option<Vec<KanaMora>> {
  let kana_mora = |text: &str| {
    kana::MORA_PHONEMES
      .iter()
      .find(|(kana, _, _)| *kana == text)
      .map(|&(kana, consonant, vowel)| KanaMora {
        text: kana.to_string(),
        consonant: (!consonant.is_empty()).then(|| consonant.to_string()),
        vowel: vowel.to_string(),
      })
  };
  let characters = katakana.chars().collect::<Vec<_>>();
  let mut moras: Vec<KanaMora> = Vec::new();
  let mut index = 0;
  while index < characters.len() {
    if characters[index] == 'ー' {
      let vowel = &moras.last()?.vowel;
      if !matches!(vowel.as_str(), "a" | "i" | "u" | "e" | "o") {
        return None;
      }
      let long = kana::MORA_PHONEMES
        .iter()
        .find(|(_, consonant, mora_vowel)| consonant.is_empty() && mora_vowel == vowel)
        .and_then(|(kana, _, _)| kana_mora(kana))?;
      moras.push(long);
      index += 1;
      continue;
    }
    let pair = characters.get(index..index + 2).and_then(|pair| {
      let text = pair.iter().collect::<String>();
      kana_mora(&text)
    });
    let (mora, width) = match pair {
      Some(mora) => (mora, 2),
      None => (kana_mora(&characters[index].to_string())?, 1),
    };
    moras.push(mora);
    index += width;
  }
  Some(moras)
}

#[derive(Clone, Debug)]
struct Substitution {
  katakana: String,
  /// The moras the katakana analyzes to, used to find it in the analyzed text.
  moras: Vec<MoraKey>,
  /// The katakana's own moras, replacing any OpenJTalk misreads.
  reading: Option<Vec<KanaMora>>,
  /// The predicted accent nucleus, 0 for heiban, when accent prediction is on.
  accent: Option<usize>,
}

/// Replaces unknown English words before OpenJTalk analysis and caches each word's reading.
#[derive(Default)]
pub struct EnglishReader {
  cache: Mutex<HashMap<(String, EnglishOptions), Option<Substitution>>>,
}

impl EnglishReader {
  /// Forgets cached readings; call it when the user dictionary changes which words are known.
  pub fn clear(&self) {
    self.cache.lock().unwrap().clear();
  }

  pub fn analyze(
    &self,
    analyzer: &impl TextAnalyzer,
    text: &str,
    options: EnglishOptions,
  ) -> Result<Vec<AccentPhrase>> {
    let runs = english_runs(text);
    if runs.is_empty() {
      return analyzer.analyze(text);
    }
    let mut rewritten = String::with_capacity(text.len());
    let mut substitutions = Vec::new();
    let mut last = 0;
    let mut previous_substituted = None;
    for run in runs {
      let word = text[run.clone()]
        .chars()
        .map(to_hankaku)
        .collect::<String>();
      let substitution = self.substitution(analyzer, &word, options)?;
      let gap = &text[last..run.start];
      // VOICEVOX ENGINE drops spaces between English words, which would otherwise pause.
      // Two words OpenJTalk knows keep theirs, so they are not read as one.
      let joins = previous_substituted.is_some_and(|previous| previous || substitution.is_some())
        && gap.chars().all(|c| c == ' ' || c == '\u{3000}');
      if !joins {
        rewritten.push_str(gap);
      }
      previous_substituted = Some(substitution.is_some());
      match substitution {
        Some(substitution) => {
          rewritten.push_str(&substitution.katakana);
          substitutions.push(substitution);
        }
        None => rewritten.push_str(&text[run.clone()]),
      }
      last = run.end;
    }
    rewritten.push_str(&text[last..]);

    let mut phrases = analyzer.analyze(&rewritten)?;
    apply_substitutions(&mut phrases, &substitutions);
    Ok(phrases)
  }

  fn substitution(
    &self,
    analyzer: &impl TextAnalyzer,
    word: &str,
    options: EnglishOptions,
  ) -> Result<Option<Substitution>> {
    let key = (word.to_string(), options);
    if let Some(cached) = self.cache.lock().unwrap().get(&key) {
      return Ok(cached.clone());
    }
    let substitution = substitution(analyzer, word, options)?;
    let mut cache = self.cache.lock().unwrap();
    if cache.len() >= CACHE_LIMIT {
      cache.clear();
    }
    cache.insert(key, substitution.clone());
    Ok(substitution)
  }
}

fn substitution(
  analyzer: &impl TextAnalyzer,
  word: &str,
  options: EnglishOptions,
) -> Result<Option<Substitution>> {
  if word.len() < 2 {
    return Ok(None);
  }
  // A word OpenJTalk reads exactly as its letter names has no dictionary or user
  // dictionary reading.
  let known =
    mora_keys(&analyzer.analyze(word)?) != mora_keys(&analyzer.analyze(&spell_out(word))?);
  if known {
    return Ok(None);
  }
  let models = models(options.turbo)?;
  let Some(katakana) = transliterate(models, word, options.ngram_filter) else {
    return Ok(None);
  };
  let moras = mora_keys(&analyzer.analyze(&katakana)?);
  if moras.is_empty() {
    return Ok(None);
  }
  let accent = options
    .accent_prediction
    .then(|| usize::try_from(models.accent.predict(&katakana)).unwrap_or(0));
  let reading = kana_moras(&katakana);
  Ok(Some(Substitution {
    katakana,
    moras,
    reading,
    accent,
  }))
}

/// The phrase and mora index of the `flat`-th mora, excluding pause moras.
fn locate(phrases: &[AccentPhrase], mut flat: usize) -> Option<(usize, usize)> {
  for (index, phrase) in phrases.iter().enumerate() {
    if flat < phrase.moras.len() {
      return Some((index, flat));
    }
    flat -= phrase.moras.len();
  }
  None
}

/// A mora with `reading`'s text and phonemes, keeping `template`'s other fields. `None` when
/// a phoneme is not one the core knows.
fn read_mora(template: &Mora, reading: &KanaMora) -> Option<Mora> {
  let consonant = match &reading.consonant {
    Some(consonant) => Some(consonant.parse().ok()?),
    None => None,
  };
  let mut mora = template.clone();
  mora.text = reading.text.clone();
  mora.consonant = consonant;
  mora.consonant_length = consonant.map(|_| tf32::ZERO);
  mora.vowel = reading.vowel.parse().ok()?;
  mora.vowel_length = tf32::ZERO;
  mora.pitch = tf32::ZERO.into();
  Some(mora)
}

/// `accent` clamped to a phrase of `len` moras.
fn clamp_accent(accent: usize, len: usize) -> NonZero<usize> {
  NonZero::new(accent.min(len)).unwrap_or(NonZero::<usize>::MIN)
}

/// Restores the `len` moras at flat index `start` to `reading`, returning the word's new mora
/// count. Moras OpenJTalk read the same, only differing in devoicing, are kept.
fn repair(phrases: &mut [AccentPhrase], start: usize, len: usize, reading: &[KanaMora]) -> usize {
  let key = |mora: &KanaMora| (mora.consonant.clone(), mora.vowel.to_lowercase());
  if reading.len() == len {
    for (offset, expected) in reading.iter().enumerate() {
      let Some((phrase, index)) = locate(phrases, start + offset) else {
        return len;
      };
      let mora = &mut phrases[phrase].moras[index];
      if mora_key(mora) != key(expected) {
        if let Some(read) = read_mora(mora, expected) {
          *mora = read;
        }
      }
    }
    return len;
  }
  // A different mora count is only spliced within one phrase.
  let (Some((phrase, index)), Some((last, _))) =
    (locate(phrases, start), locate(phrases, start + len - 1))
  else {
    return len;
  };
  if phrase != last {
    return len;
  }
  let phrase = &mut phrases[phrase];
  let template = &phrase.moras[index];
  let Some(moras) = reading
    .iter()
    .map(|expected| read_mora(template, expected))
    .collect::<Option<Vec<_>>>()
  else {
    return len;
  };
  phrase.moras.splice(index..index + len, moras);
  phrase.accent = clamp_accent(phrase.accent.get(), phrase.moras.len());
  reading.len()
}

/// Finds each substituted word in the analyzed phrases, restores misread moras, and makes the
/// word start an accent phrase carrying its predicted accent.
///
/// A word OpenJTalk split across phrases is merged into one. A word that starts
/// inside a phrase is split off only after another substituted word; otherwise it
/// joined a Japanese compound, whose accent OpenJTalk keeps.
fn apply_substitutions(phrases: &mut Vec<AccentPhrase>, substitutions: &[Substitution]) {
  let mut cursor = 0;
  let mut previous_end = None;
  for substitution in substitutions {
    let flat = mora_keys(phrases);
    let pattern = &substitution.moras;
    let Some(start) = (cursor..=flat.len().saturating_sub(pattern.len()))
      .find(|&start| flat[start..].starts_with(pattern))
    else {
      previous_end = None;
      continue;
    };
    let len = match &substitution.reading {
      Some(reading) => repair(phrases, start, pattern.len(), reading),
      None => pattern.len(),
    };
    let end = start + len;
    cursor = end;
    let follows_word = previous_end == Some(start);
    previous_end = None;
    let Some(accent) = substitution.accent else {
      continue;
    };
    let (Some((mut first, offset)), Some((mut last, _))) =
      (locate(phrases, start), locate(phrases, end - 1))
    else {
      continue;
    };
    if phrases[first..last]
      .iter()
      .any(|phrase| phrase.pause_mora.is_some())
    {
      continue;
    }
    if offset != 0 {
      if !follows_word {
        continue;
      }
      let mut tail = phrases[first].clone();
      let head = &mut phrases[first];
      tail.moras = head.moras.split_off(offset);
      head.pause_mora = None;
      head.is_interrogative = false;
      head.accent = clamp_accent(head.accent.get(), head.moras.len());
      phrases.insert(first + 1, tail);
      first += 1;
      last += 1;
    }
    let merged = phrases.drain(first + 1..=last).collect::<Vec<_>>();
    let phrase = &mut phrases[first];
    for next in merged {
      phrase.moras.extend(next.moras);
      phrase.pause_mora = next.pause_mora;
      phrase.is_interrogative = next.is_interrogative;
    }
    phrase.accent = if accent == 0 {
      clamp_accent(phrase.moras.len(), phrase.moras.len())
    } else {
      clamp_accent(accent, len)
    };
    previous_end = Some(end);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Phrases for `kana`, with `/` separating phrases and `、` ending one with a pause.
  fn phrases(kana: &str) -> Vec<AccentPhrase> {
    kana
      .split('/')
      .map(|phrase| {
        let (body, pause) = match phrase.strip_suffix('、') {
          Some(body) => (body, true),
          None => (phrase, false),
        };
        let mora = |text: &str, consonant: Option<&str>, vowel: &str| {
          serde_json::json!({
            "text": text,
            "consonant": consonant,
            "consonant_length": consonant.map(|_| 0.0),
            "vowel": vowel,
            "vowel_length": 0.0,
            "pitch": 0.0,
          })
        };
        let moras = kana_moras(body)
          .expect("test kana is valid")
          .iter()
          .map(|m| mora(&m.text, m.consonant.as_deref(), &m.vowel))
          .collect::<Vec<_>>();
        serde_json::from_value(serde_json::json!({
          "accent": 1,
          "moras": moras,
          "pause_mora": pause.then(|| mora("、", None, "pau")),
          "is_interrogative": false,
        }))
        .unwrap()
      })
      .collect()
  }

  fn render(phrases: &[AccentPhrase]) -> String {
    phrases
      .iter()
      .map(|phrase| {
        let text = phrase
          .moras
          .iter()
          .map(|m| m.text.as_str())
          .collect::<String>();
        let pause = if phrase.pause_mora.is_some() {
          "、"
        } else {
          ""
        };
        format!("{text}{pause}:{}", phrase.accent)
      })
      .collect::<Vec<_>>()
      .join(" ")
  }

  fn substitution(katakana: &str, analyzed: &str, accent: Option<usize>) -> Substitution {
    Substitution {
      katakana: katakana.to_string(),
      moras: mora_keys(&phrases(analyzed)),
      reading: kana_moras(katakana),
      accent,
    }
  }

  /// Answers analyses from a table of texts and their readings in `phrases` notation.
  struct FakeAnalyzer(Mutex<HashMap<String, String>>);

  impl FakeAnalyzer {
    fn new(readings: &[(&str, &str)]) -> Self {
      Self(Mutex::new(
        readings
          .iter()
          .map(|(text, kana)| (text.to_string(), kana.to_string()))
          .collect(),
      ))
    }
  }

  impl TextAnalyzer for FakeAnalyzer {
    fn analyze(&self, text: &str) -> Result<Vec<AccentPhrase>> {
      let readings = self.0.lock().unwrap();
      let kana = readings
        .get(text)
        .ok_or_else(|| anyhow!("unexpected analysis of {text:?}"))?;
      Ok(phrases(kana))
    }
  }

  const ALL: EnglishOptions = EnglishOptions {
    accent_prediction: true,
    ngram_filter: true,
    turbo: false,
  };

  #[test]
  fn english_runs_cover_ascii_and_fullwidth_letters() {
    let text = "AzaleaとＴｏｋｙｏ、mp3";
    let runs = english_runs(text)
      .into_iter()
      .map(|run| &text[run])
      .collect::<Vec<_>>();
    assert_eq!(runs, ["Azalea", "Ｔｏｋｙｏ", "mp"]);
    assert_eq!(
      "Ｔｏｋｙｏ".chars().map(to_hankaku).collect::<String>(),
      "Tokyo"
    );
    assert!(english_runs("こんにちは").is_empty());
  }

  #[test]
  fn spelling_and_engine_rules_follow_voicevox_engine() {
    assert_eq!(spell_out("Fbi"), "エフビーアイ");
    assert_eq!(split_camel_case("VoiceVox"), ["Voice", "Vox"]);
    assert_eq!(split_camel_case("iPhone"), ["i", "Phone"]);
    assert_eq!(split_camel_case("NASA"), ["N", "A", "S", "A"]);
    assert!(spelled_by_engine_rules("A"));
    assert!(spelled_by_engine_rules("GPU"));
    assert!(!spelled_by_engine_rules("Voice"));
  }

  #[test]
  fn kana_moras_read_long_vowels_and_small_kana() {
    let read = |katakana: &str| {
      kana_moras(katakana).map(|moras| {
        moras
          .into_iter()
          .map(|m| format!("{}{}", m.consonant.unwrap_or_default(), m.vowel))
          .collect::<Vec<_>>()
      })
    };
    assert_eq!(read("ヘロー").unwrap(), ["he", "ro", "o"]);
    assert_eq!(read("ジャッズ").unwrap(), ["ja", "cl", "zu"]);
    assert_eq!(read("ンー"), None);
    assert_eq!(read("ッー"), None);
    assert_eq!(read("ーア"), None);
    assert_eq!(read("abc"), None);
  }

  #[test]
  fn transliteration_honors_the_ngram_filter_and_engine_rules() {
    let models = models(false).unwrap();
    assert!(transliterate(models, "a", true).is_none());
    assert!(transliterate(models, "a", false).is_none());
    // The n-gram model rejects acronyms whatever their case.
    assert!(transliterate(models, "gpu", true).is_none());
    assert!(transliterate(models, "geogaddi", true).is_some());
    // Without it, all-capital words are spelled and camel case is split.
    assert!(transliterate(models, "GPU", false).is_none());
    let reading = transliterate(models, "iPhone", false).unwrap();
    assert!(reading.starts_with("アイ"), "{reading}");
  }

  #[test]
  fn turbo_option_selects_the_distilled_model() {
    let base = models(false).unwrap();
    let turbo = models(true).unwrap();
    assert!(!std::ptr::eq(base.c2k, turbo.c2k));
    assert!(std::ptr::eq(base.ngram, turbo.ngram));
    assert!(std::ptr::eq(models(true).unwrap().c2k, turbo.c2k));
    let reading = transliterate(turbo, "streaming", true).unwrap();
    assert!(kana_moras(&reading).is_some(), "{reading}");
  }

  #[test]
  fn substitution_sets_the_predicted_accent_and_repairs_misreads() {
    // OpenJTalk reads the substituted ヘ as the particle エ.
    let mut analyzed = phrases("エロー/ワールドデス");
    apply_substitutions(&mut analyzed, &[substitution("ヘロー", "エロー", Some(1))]);
    assert_eq!(render(&analyzed), "ヘロオ:1 ワアルドデス:1");
  }

  #[test]
  fn substitution_merges_a_word_split_across_phrases() {
    let mut analyzed = phrases("ジオ/ガディオ/キキマス");
    apply_substitutions(
      &mut analyzed,
      &[substitution("ジオガディ", "ジオ/ガディ", Some(2))],
    );
    assert_eq!(render(&analyzed), "ジオガディオ:2 キキマス:1");

    // A heiban word makes the whole phrase heiban, including its particles.
    let mut analyzed = phrases("ジオ/ガディオ");
    apply_substitutions(
      &mut analyzed,
      &[substitution("ジオガディ", "ジオガディ", Some(0))],
    );
    assert_eq!(render(&analyzed), "ジオガディオ:5");

    // A pause inside the word stops the merge.
    let mut analyzed = phrases("ジオ、/ガディ");
    apply_substitutions(
      &mut analyzed,
      &[substitution("ジオガディ", "ジオガディ", Some(2))],
    );
    assert_eq!(render(&analyzed), "ジオ、:1 ガディ:1");
  }

  #[test]
  fn substitution_splits_consecutive_words_but_keeps_compounds() {
    let mut analyzed = phrases("ヘローワールド");
    apply_substitutions(
      &mut analyzed,
      &[
        substitution("ヘロー", "ヘロー", Some(1)),
        substitution("ワールド", "ワールド", Some(0)),
      ],
    );
    assert_eq!(render(&analyzed), "ヘロオ:1 ワアルド:4");

    // A word inside a Japanese compound keeps OpenJTalk's accent.
    let mut analyzed = phrases("シンジオガディ");
    apply_substitutions(
      &mut analyzed,
      &[substitution("ジオガディ", "ジオガディ", Some(2))],
    );
    assert_eq!(render(&analyzed), "シンジオガディ:1");
  }

  #[test]
  fn substitution_without_accent_prediction_only_repairs() {
    let mut analyzed = phrases("エ/ロー");
    apply_substitutions(&mut analyzed, &[substitution("ヘロー", "エ/ロー", None)]);
    assert_eq!(render(&analyzed), "ヘ:1 ロオ:1");

    // A different mora count is spliced within one phrase and clamps its accent.
    let mut analyzed = phrases("アアアデス");
    analyzed[0].accent = NonZero::new(5).unwrap();
    apply_substitutions(&mut analyzed, &[substitution("アア", "アアア", None)]);
    assert_eq!(render(&analyzed), "アアデス:4");
  }

  #[test]
  fn analysis_substitutes_only_unknown_words() {
    let geogaddi = transliterate(models(false).unwrap(), "geogaddi", true).unwrap();
    let spelled = spell_out("Geogaddi");
    let analyzer = FakeAnalyzer::new(&[
      ("Geogaddi", spelled.as_str()),
      (spelled.as_str(), spelled.as_str()),
      (geogaddi.as_str(), geogaddi.as_str()),
      (&format!("{geogaddi}デス"), &format!("{geogaddi}デス")),
      ("Azalea", "アザレア"),
      (&spell_out("Azalea"), &spell_out("Azalea")),
      ("Azaleaデス", "アザレアデス"),
    ]);
    let reader = EnglishReader::default();

    let transformed = reader.analyze(&analyzer, "Geogaddiデス", ALL).unwrap();
    let reading = kana_moras(&geogaddi)
      .unwrap()
      .into_iter()
      .map(|mora| mora.text)
      .collect::<String>();
    assert!(
      render(&transformed).starts_with(&format!("{reading}デス:")),
      "{}",
      render(&transformed)
    );

    // A word with its own reading, such as a user dictionary entry, is kept.
    let known = reader.analyze(&analyzer, "Azaleaデス", ALL).unwrap();
    assert_eq!(render(&known), "アザレアデス:1");
  }

  #[test]
  fn analysis_drops_spaces_next_to_substituted_words_and_caches_until_cleared() {
    let spelled = spell_out("Geogaddi");
    let geogaddi = transliterate(models(false).unwrap(), "geogaddi", true).unwrap();
    let analyzer = FakeAnalyzer::new(&[
      ("Geogaddi", spelled.as_str()),
      (spelled.as_str(), spelled.as_str()),
      (geogaddi.as_str(), geogaddi.as_str()),
      ("world", "ワールド"),
      (&spell_out("world"), &spell_out("world")),
      (&format!("{geogaddi}world"), &format!("{geogaddi}/ワールド")),
      ("world world", "ワールド、/ワールド"),
    ]);
    let reader = EnglishReader::default();
    reader.analyze(&analyzer, "Geogaddi world", ALL).unwrap();
    // Two known words keep the space between them.
    reader.analyze(&analyzer, "world world", ALL).unwrap();

    // Cached readings survive a dictionary that now knows the word until cleared.
    analyzer
      .0
      .lock()
      .unwrap()
      .insert("Geogaddi".into(), "ジオ".into());
    analyzer
      .0
      .lock()
      .unwrap()
      .insert("Geogaddi world".into(), "ジオ/ワールド".into());
    reader.analyze(&analyzer, "Geogaddi world", ALL).unwrap();
    reader.clear();
    assert_eq!(
      render(&reader.analyze(&analyzer, "Geogaddi world", ALL).unwrap()),
      "ジオ:1 ワアルド:1"
    );
  }
}
