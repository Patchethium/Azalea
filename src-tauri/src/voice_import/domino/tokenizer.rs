//! Turns VOICEVOX phonemes into pydomino's phoneme-transition tokens.
//!
//! The model scores, per frame, each transition between two phonemes of
//! pydomino's set. pydomino's `src/phoneme_transitions.txt` lists them in the
//! model's output order; it is read from the `third_party/pydomino` submodule
//! (MIT), pinned to the commit the model is downloaded from.

use std::collections::HashMap;
use std::sync::LazyLock;

/// pydomino's table, a C++ raw string literal (`R"(...)"`) holding one
/// `from to` pair per line.
const TRANSITIONS_SOURCE: &str =
  include_str!("../../../third_party/pydomino/src/phoneme_transitions.txt");

/// Number of transition tokens, the model's output width.
pub(super) const TRANSITION_COUNT: usize = 557;

/// The `from to` pairs; the line number is the token ID.
fn transitions() -> impl Iterator<Item = &'static str> {
  let table = TRANSITIONS_SOURCE.trim_start_matches('\u{feff}');
  let table = table
    .strip_prefix("R\"(")
    .and_then(|table| table.trim_end().strip_suffix(")\""))
    .expect("pydomino's transition table is a C++ raw string literal");
  table
    .lines()
    .map(|line| line.trim_end_matches('\r'))
    .filter(|line| !line.is_empty())
}

static TOKEN_IDS: LazyLock<HashMap<(&'static str, &'static str), usize>> = LazyLock::new(|| {
  transitions()
    .enumerate()
    .map(|(id, line)| {
      let (from, to) = line
        .split_once(' ')
        .expect("every transition line holds two phonemes");
      ((from, to), id)
    })
    .collect()
});

fn token(from: &str, to: &str) -> Option<usize> {
  TOKEN_IDS.get(&(from, to)).copied()
}

/// The pydomino phoneme for a VOICEVOX one. pydomino lacks `kw`, `gw` and
/// `ty`, which fall back to their plain consonants, and has no devoiced `A`,
/// `E` and `O`. Devoiced `I` and `U` exist and are kept here.
fn domino_phoneme(phoneme: &str) -> &str {
  match phoneme {
    "kw" => "k",
    "gw" => "g",
    "ty" => "t",
    "A" => "a",
    "E" => "e",
    "O" => "o",
    other => other,
  }
}

/// The voiced form of a devoiced vowel pydomino knows.
fn voiced(phoneme: &str) -> Option<&'static str> {
  match phoneme {
    "I" => Some("i"),
    "U" => Some("u"),
    _ => None,
  }
}

/// What to align for a phoneme sequence.
#[derive(Debug, PartialEq)]
pub(super) struct Tokens {
  /// One transition per pair of consecutive units.
  pub ids: Vec<usize>,
  /// How many input phonemes each aligned unit stands for, in order. A unit
  /// covers more than one where pydomino has no transition between them.
  pub units: Vec<usize>,
}

/// Tokenizes `phonemes`, VOICEVOX's names with a pause at both ends.
///
/// pydomino defines no transition for some pairs VOICEVOX produces. A
/// devoiced `I` or `U` is kept only where both of its transitions exist and
/// is voiced otherwise; a phoneme that still has no transition from the one
/// before it (a repeated `cl` or pause) shares that phoneme's unit.
pub(super) fn tokenize(phonemes: &[String]) -> Result<Tokens, String> {
  let mut names: Vec<&str> = Vec::with_capacity(phonemes.len());
  let mut units: Vec<usize> = Vec::with_capacity(phonemes.len());
  for phoneme in phonemes {
    let phoneme = domino_phoneme(phoneme);
    let Some(&previous) = names.last() else {
      names.push(phoneme);
      units.push(1);
      continue;
    };
    // A kept devoiced vowel always follows a consonant, so voicing it keeps
    // the transition into it defined.
    let previous_forms = [Some(previous), voiced(previous)];
    let forms = [Some(phoneme), voiced(phoneme)];
    let pair = previous_forms
      .into_iter()
      .flatten()
      .flat_map(|from| forms.into_iter().flatten().map(move |to| (from, to)))
      .find(|(from, to)| token(from, to).is_some());
    match pair {
      Some((from, to)) => {
        *names.last_mut().expect("a previous unit exists") = from;
        names.push(to);
        units.push(1);
      }
      None => *units.last_mut().expect("a previous unit exists") += 1,
    }
  }
  let ids = names
    .windows(2)
    .map(|pair| {
      token(pair[0], pair[1])
        .ok_or_else(|| format!("No transition from {} to {}", pair[0], pair[1]))
    })
    .collect::<Result<Vec<_>, _>>()?;
  if ids.is_empty() {
    return Err("The text has nothing to align".into());
  }
  Ok(Tokens { ids, units })
}

#[cfg(test)]
mod tests {
  use super::*;

  /// VOICEVOX's phonemes, as its mora table and devoicing produce them.
  const CONSONANTS: &[&str] = &[
    "b", "by", "ch", "d", "dy", "f", "g", "gw", "gy", "h", "hy", "j", "k", "kw", "ky", "m", "my",
    "n", "ny", "p", "py", "r", "ry", "s", "sh", "t", "ts", "ty", "v", "w", "y", "z",
  ];
  const VOWELS: &[&str] = &[
    "a", "i", "u", "e", "o", "A", "I", "U", "E", "O", "N", "cl", "pau",
  ];

  fn phonemes(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| name.to_string()).collect()
  }

  #[test]
  fn the_table_lists_every_token_once() {
    assert_eq!(transitions().count(), TRANSITION_COUNT);
    assert_eq!(TOKEN_IDS.len(), TRANSITION_COUNT);
    assert_eq!(token("ry", "a"), Some(0));
    assert_eq!(token("pau", "cl"), Some(TRANSITION_COUNT - 1));
    assert_eq!(token("u", "ty"), None);
  }

  #[test]
  fn plain_text_gets_one_transition_per_boundary() {
    let tokens = tokenize(&phonemes(&["pau", "k", "o", "N", "pau"])).unwrap();
    assert_eq!(
      tokens.ids,
      [("pau", "k"), ("k", "o"), ("o", "N"), ("N", "pau")].map(|(a, b)| token(a, b).unwrap())
    );
    assert_eq!(tokens.units, [1; 5]);
  }

  #[test]
  fn missing_consonants_fall_back_and_devoiced_vowels_are_kept_where_defined() {
    let tokens = tokenize(&phonemes(&[
      "pau", "ty", "u", "kw", "A", "sh", "I", "t", "a", "pau",
    ]))
    .unwrap();
    let expected = [
      ("pau", "t"),
      ("t", "u"),
      ("u", "k"),
      ("k", "a"),
      ("a", "sh"),
      ("sh", "I"),
      ("I", "t"),
      ("t", "a"),
      ("a", "pau"),
    ];
    assert_eq!(tokens.ids, expected.map(|(a, b)| token(a, b).unwrap()));
  }

  #[test]
  fn devoiced_vowels_without_a_transition_are_voiced() {
    // `U a`, `U N` and `pau I` are not defined.
    let tokens = tokenize(&phonemes(&["pau", "s", "U", "a", "pau"])).unwrap();
    assert_eq!(
      tokens.ids[1..3],
      [token("s", "u"), token("u", "a")].map(Option::unwrap)
    );
    let tokens = tokenize(&phonemes(&["pau", "I", "U", "N", "pau"])).unwrap();
    let expected = [("pau", "i"), ("i", "u"), ("u", "N"), ("N", "pau")];
    assert_eq!(tokens.ids, expected.map(|(a, b)| token(a, b).unwrap()));
    assert_eq!(tokens.units, [1; 5]);
  }

  #[test]
  fn repeated_geminates_and_pauses_share_a_unit() {
    let tokens = tokenize(&phonemes(&["pau", "a", "cl", "cl", "t", "a", "pau", "pau"])).unwrap();
    assert_eq!(tokens.units, [1, 1, 2, 1, 1, 2]);
    assert_eq!(tokens.ids.len(), 5);
    assert!(tokenize(&phonemes(&["pau", "pau"])).is_err());
  }

  #[test]
  fn every_voicevox_sequence_tokenizes() {
    // Every mora (optional consonant, vowel) after and before every vowel.
    for before in VOWELS {
      for consonant in CONSONANTS.iter().map(Some).chain([None]) {
        for vowel in VOWELS {
          for after in VOWELS {
            let mut names = vec!["pau", before];
            names.extend(consonant.copied());
            names.extend([vowel, after, "pau"]);
            // Text always has a mora, so pauses alone never reach the tokenizer.
            if names.iter().all(|name| *name == "pau") {
              continue;
            }
            let tokens =
              tokenize(&phonemes(&names)).unwrap_or_else(|error| panic!("{names:?}: {error}"));
            assert_eq!(tokens.units.iter().sum::<usize>(), names.len(), "{names:?}");
            assert_eq!(tokens.ids.len() + 1, tokens.units.len(), "{names:?}");
          }
        }
      }
    }
  }
}
