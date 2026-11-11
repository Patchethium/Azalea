//! Short IDs for the things the MCP server hands to a model: two English words
//! such as `quick-fox`, which a model repeats more reliably than a UUID.
//!
//! `mcp_ids.toml` in the config directory records every ID issued, so one is
//! never reused after deletion, and the ID given to each of the app's presets.
use std::{
  collections::{BTreeMap, BTreeSet},
  path::Path,
};

use serde::{Deserialize, Serialize};

use crate::atomic_file::write_with_backup;

pub const IDS_FILE: &str = "mcp_ids.toml";

/// A dictionary selector, never issued as an ID.
const RESERVED: [&str; 1] = ["user"];

const ADJECTIVES: [&str; 64] = [
  "quick", "lazy", "calm", "bold", "warm", "cool", "soft", "loud", "kind", "wise", "tidy", "wild",
  "glad", "pale", "dark", "fair", "keen", "mild", "neat", "odd", "plain", "proud", "quiet",
  "rapid", "sharp", "shy", "slow", "small", "smart", "solid", "sunny", "sweet", "swift", "tall",
  "tiny", "vivid", "young", "eager", "brave", "bright", "clear", "clever", "cozy", "crisp",
  "daring", "early", "fancy", "gentle", "golden", "happy", "humble", "jolly", "lively", "lucky",
  "merry", "mighty", "noble", "polite", "rosy", "royal", "rusty", "silver", "steady", "witty",
];

const NOUNS: [&str; 64] = [
  "fox", "dog", "cat", "owl", "bee", "elk", "hen", "ant", "bat", "cow", "crab", "crow", "deer",
  "dove", "duck", "frog", "goat", "hare", "hawk", "lamb", "lion", "lynx", "mole", "moth", "newt",
  "orca", "pony", "seal", "swan", "toad", "wolf", "wren", "river", "lake", "hill", "pond", "moon",
  "star", "cloud", "rain", "snow", "wind", "leaf", "tree", "rose", "fern", "pine", "oak", "reed",
  "moss", "stone", "sand", "wave", "tide", "dawn", "dusk", "field", "grove", "harbor", "island",
  "meadow", "garden", "bridge", "lantern",
];

/// An ID as stored and compared: trimmed and lowercase.
pub fn normalize(id: &str) -> String {
  id.trim().to_lowercase()
}

/// Whether `id` is one of this module's word pairs.
pub fn is_word_pair(id: &str) -> bool {
  id.split_once('-')
    .is_some_and(|(adjective, noun)| ADJECTIVES.contains(&adjective) && NOUNS.contains(&noun))
}

fn pair(index: usize) -> String {
  format!(
    "{}-{}",
    ADJECTIVES[index % ADJECTIVES.len()],
    NOUNS[index / ADJECTIVES.len() % NOUNS.len()]
  )
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct IdFile {
  /// Every ID ever issued, including those of deleted presets.
  #[serde(default)]
  issued: BTreeSet<String>,
  /// The ID given to each of the app's presets, by the app's own preset ID.
  #[serde(default)]
  user_presets: BTreeMap<String, String>,
}

impl IdFile {
  /// Reads the file; a missing one has issued nothing.
  pub fn load(path: &Path) -> Result<Self, String> {
    let text = match std::fs::read_to_string(path) {
      Ok(text) => text,
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
      Err(error) => return Err(format!("Failed to read {}: {error}", path.display())),
    };
    toml::from_str(&text).map_err(|error| format!("Failed to parse {}: {error}", path.display()))
  }

  pub fn save(&self, path: &Path) -> Result<(), String> {
    if let Some(dir) = path.parent() {
      std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    }
    let text = toml::to_string_pretty(self).map_err(|e| e.to_string())?;
    write_with_backup(path, text.as_bytes())
      .map_err(|e| format!("Failed to write {}: {e}", path.display()))
  }

  /// Records an ID issued elsewhere, such as one already in the presets file.
  pub fn reserve(&mut self, id: &str) -> bool {
    self.issued.insert(id.to_owned())
  }

  /// Issues an ID never issued before, starting from a random pair.
  pub fn issue(&mut self) -> Result<String, String> {
    self.issue_from(uuid::Uuid::new_v4().as_u128() as usize)
  }

  fn issue_from(&mut self, start: usize) -> Result<String, String> {
    let total = ADJECTIVES.len() * NOUNS.len();
    (0..total)
      .map(|offset| pair((start % total + offset) % total))
      .find(|id| !self.issued.contains(id) && !RESERVED.contains(&id.as_str()))
      .inspect(|id| {
        self.issued.insert(id.clone());
      })
      .ok_or_else(|| "Every short ID is in use; delete presets that are no longer needed.".into())
  }

  /// The ID of the app preset known to the app as `key`, issued on first sight.
  /// Returns whether the file changed.
  pub fn user_preset_id(&mut self, key: &str) -> Result<(String, bool), String> {
    if let Some(id) = self.user_presets.get(key) {
      return Ok((id.clone(), false));
    }
    let id = self.issue()?;
    self.user_presets.insert(key.to_owned(), id.clone());
    Ok((id, true))
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn word_lists_have_no_duplicates_and_pairs_are_recognized() {
    let adjectives: BTreeSet<_> = ADJECTIVES.iter().collect();
    let nouns: BTreeSet<_> = NOUNS.iter().collect();
    assert_eq!(adjectives.len(), ADJECTIVES.len());
    assert_eq!(nouns.len(), NOUNS.len());
    assert!(ADJECTIVES
      .iter()
      .chain(&NOUNS)
      .all(|word| word.chars().all(|c| c.is_ascii_lowercase())));
    assert!(is_word_pair("quick-fox"));
    assert!(is_word_pair(&normalize(" Lazy-Dog\n")));
    for id in ["quick", "fox-quick", "quick-fox-dog", "user", ""] {
      assert!(!is_word_pair(id), "{id}");
    }
    assert!(!is_word_pair("0a6f0c7e-5d0b-4c53-9a53-2f3f3a1f9f10"));
  }

  #[test]
  fn issued_ids_are_unique_until_the_pairs_run_out() {
    let mut ids = IdFile::default();
    assert_eq!(ids.issue_from(0).unwrap(), "quick-fox");
    assert_eq!(ids.issue_from(0).unwrap(), "lazy-fox");
    assert!(!ids.reserve("quick-fox"));
    assert!(ids.reserve("calm-fox"));
    assert_eq!(ids.issue_from(0).unwrap(), "bold-fox");

    let total = ADJECTIVES.len() * NOUNS.len();
    for _ in 0..total - 4 {
      assert!(is_word_pair(&ids.issue().unwrap()));
    }
    assert_eq!(ids.issued.len(), total);
    assert!(ids.issue().unwrap_err().contains("in use"));
  }

  #[test]
  fn user_preset_ids_are_stable_and_the_file_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested").join(IDS_FILE);
    let mut ids = IdFile::load(&path).unwrap();
    assert_eq!(ids, IdFile::default());

    let (first, changed) = ids.user_preset_id("app-preset-1").unwrap();
    assert!(changed && is_word_pair(&first));
    assert_eq!(
      ids.user_preset_id("app-preset-1").unwrap(),
      (first.clone(), false)
    );
    let (second, _) = ids.user_preset_id("app-preset-2").unwrap();
    assert_ne!(first, second);

    ids.save(&path).unwrap();
    assert_eq!(IdFile::load(&path).unwrap(), ids);
    std::fs::write(&path, "issued = 3").unwrap();
    assert!(IdFile::load(&path).unwrap_err().contains("Failed to parse"));
  }
}
