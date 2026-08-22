use crate::config::manager::user_dictionary_path;
use crate::{core::Core, AppState};
use std::path::Path;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;
use voicevox_core::{blocking::UserDict, UserDictWord, UserDictWordType as CoreUserDictWordType};

#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DictionaryWordType {
  ProperNoun,
  CommonNoun,
  Verb,
  Adjective,
  Suffix,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, specta::Type, PartialEq, Eq)]
pub struct DictionaryEntryInput {
  pub surface: String,
  pub pronunciation: String,
  pub accent_type: u32,
  pub word_type: DictionaryWordType,
  pub priority: u32,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, specta::Type, PartialEq, Eq)]
pub struct DictionaryEntry {
  pub id: String,
  pub surface: String,
  pub pronunciation: String,
  pub accent_type: u32,
  pub word_type: DictionaryWordType,
  pub priority: u32,
}

impl From<DictionaryWordType> for CoreUserDictWordType {
  fn from(value: DictionaryWordType) -> Self {
    match value {
      DictionaryWordType::ProperNoun => Self::ProperNoun,
      DictionaryWordType::CommonNoun => Self::CommonNoun,
      DictionaryWordType::Verb => Self::Verb,
      DictionaryWordType::Adjective => Self::Adjective,
      DictionaryWordType::Suffix => Self::Suffix,
    }
  }
}

fn dictionary_word_type(value: CoreUserDictWordType) -> Result<DictionaryWordType, String> {
  match value {
    CoreUserDictWordType::ProperNoun => Ok(DictionaryWordType::ProperNoun),
    CoreUserDictWordType::CommonNoun => Ok(DictionaryWordType::CommonNoun),
    CoreUserDictWordType::Verb => Ok(DictionaryWordType::Verb),
    CoreUserDictWordType::Adjective => Ok(DictionaryWordType::Adjective),
    CoreUserDictWordType::Suffix => Ok(DictionaryWordType::Suffix),
    _ => Err("Unsupported dictionary word type".into()),
  }
}

fn build_word(input: DictionaryEntryInput) -> Result<UserDictWord, String> {
  if input.surface.trim().is_empty() {
    return Err("Dictionary surface must not be empty".into());
  }
  let accent_type = usize::try_from(input.accent_type)
    .map_err(|_| "Dictionary accent type is too large".to_string())?;
  UserDictWord::builder()
    .word_type(input.word_type.into())
    .priority(input.priority)
    .build(&input.surface, input.pronunciation, accent_type)
    .map_err(|error| error.to_string())
}

fn entry_from_word(id: Uuid, word: &UserDictWord) -> Result<DictionaryEntry, String> {
  Ok(DictionaryEntry {
    id: id.to_string(),
    surface: word.surface().into(),
    pronunciation: word.pronunciation().into(),
    accent_type: u32::try_from(word.accent_type())
      .map_err(|_| "Dictionary accent type is too large".to_string())?,
    word_type: dictionary_word_type(word.word_type())?,
    priority: word.priority(),
  })
}

fn load_dictionary(path: &Path) -> Result<UserDict, String> {
  let dictionary = UserDict::new();
  if path.exists() {
    dictionary.load(path).map_err(|error| error.to_string())?;
  }
  Ok(dictionary)
}

fn save_dictionary(dictionary: &UserDict, path: &Path) -> Result<(), String> {
  let parent = path
    .parent()
    .ok_or_else(|| "Dictionary path has no parent directory".to_string())?;
  std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  dictionary.save(path).map_err(|error| error.to_string())
}

fn dictionary_entries(dictionary: &UserDict) -> Result<Vec<DictionaryEntry>, String> {
  dictionary.with_words(|words| {
    words
      .iter()
      .map(|(id, word)| entry_from_word(*id, word))
      .collect()
  })
}

fn clone_dictionary(dictionary: &UserDict) -> UserDict {
  let cloned = UserDict::new();
  let words = dictionary.with_words(|words| words.clone());
  cloned.with_words(|cloned_words| cloned_words.extend(words));
  cloned
}

fn move_dictionary_word(dictionary: &UserDict, id: Uuid, direction: i32) -> Result<(), String> {
  if direction != -1 && direction != 1 {
    return Err("Dictionary entry direction must be -1 or 1".into());
  }
  dictionary.with_words(|words| {
    let from = words
      .get_index_of(&id)
      .ok_or_else(|| "Dictionary entry was not found".to_string())?;
    let to = if direction == -1 {
      from
        .checked_sub(1)
        .ok_or_else(|| "Dictionary entry is already first".to_string())?
    } else {
      let next = from + 1;
      if next >= words.len() {
        return Err("Dictionary entry is already last".into());
      }
      next
    };
    words.move_index(from, to);
    Ok(())
  })
}

pub(crate) fn apply_saved_dictionary(core: &Core, path: &Path) -> Result<(), String> {
  if !path.exists() {
    return Ok(());
  }
  let dictionary = load_dictionary(path)?;
  core
    .use_user_dictionary(&dictionary)
    .map_err(|error| error.to_string())
}

async fn run_dictionary_task<T, F>(state: &AppState, task: F) -> Result<T, String>
where
  T: Send + 'static,
  F: FnOnce(Option<Arc<Core>>, &Path) -> Result<T, String> + Send + 'static,
{
  let core = state.core.read().await.as_ref().cloned();
  let permit = state
    .core_task_gate
    .clone()
    .acquire_owned()
    .await
    .map_err(|_| "Core task worker is unavailable")?;
  let path = user_dictionary_path();
  tauri::async_runtime::spawn_blocking(move || {
    let _permit = permit;
    task(core, &path)
  })
  .await
  .map_err(|error| format!("Dictionary task failed: {error}"))?
}

async fn clear_dictionary_caches(state: &AppState) -> Result<(), String> {
  if let Some(cache) = state
    .query_lru
    .write()
    .map_err(|error| error.to_string())?
    .as_mut()
  {
    cache.clear();
  }
  if let Some(cache) = state.wav_lru.write().await.as_mut() {
    cache.clear();
  }
  Ok(())
}

fn apply_and_save_dictionary(
  core: Option<Arc<Core>>,
  dictionary: &UserDict,
  previous_dictionary: &UserDict,
  path: &Path,
) -> Result<(), String> {
  let core = core.ok_or_else(|| "core is not initialized".to_string())?;
  if let Err(error) = core.use_user_dictionary(dictionary) {
    let rollback = core.use_user_dictionary(previous_dictionary);
    if let Err(rollback_error) = rollback {
      return Err(format!(
        "{error}; restoring the previous in-memory dictionary also failed: {rollback_error}"
      ));
    }
    return Err(error.to_string());
  }
  if let Err(error) = save_dictionary(dictionary, path) {
    let core_rollback = core.use_user_dictionary(previous_dictionary);
    let disk_rollback = save_dictionary(previous_dictionary, path);
    let mut message = error.to_string();
    if let Err(rollback_error) = core_rollback {
      message.push_str(&format!(
        "; restoring the previous in-memory dictionary also failed: {rollback_error}"
      ));
    }
    if let Err(rollback_error) = disk_rollback {
      message.push_str(&format!(
        "; restoring the previous dictionary file also failed: {rollback_error}"
      ));
    }
    return Err(message);
  }
  Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_dictionary_entries(
  state: State<'_, AppState>,
) -> Result<Vec<DictionaryEntry>, String> {
  run_dictionary_task(&state, |_core, path| {
    dictionary_entries(&load_dictionary(path)?)
  })
  .await
}

#[tauri::command]
#[specta::specta]
pub async fn add_dictionary_entry(
  state: State<'_, AppState>,
  entry: DictionaryEntryInput,
) -> Result<DictionaryEntry, String> {
  let result = run_dictionary_task(&state, move |core, path| {
    let previous_dictionary = load_dictionary(path)?;
    let dictionary = clone_dictionary(&previous_dictionary);
    let id = dictionary
      .add_word(build_word(entry)?)
      .map_err(|error| error.to_string())?;
    apply_and_save_dictionary(core, &dictionary, &previous_dictionary, path)?;
    let word = dictionary.with_words(|words| words.get(&id).cloned());
    entry_from_word(
      id,
      &word.ok_or_else(|| "Added dictionary entry was lost".to_string())?,
    )
  })
  .await?;
  clear_dictionary_caches(&state).await?;
  Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn update_dictionary_entry(
  state: State<'_, AppState>,
  id: String,
  entry: DictionaryEntryInput,
) -> Result<DictionaryEntry, String> {
  let result = run_dictionary_task(&state, move |core, path| {
    let id = Uuid::parse_str(&id).map_err(|error| error.to_string())?;
    let previous_dictionary = load_dictionary(path)?;
    let dictionary = clone_dictionary(&previous_dictionary);
    dictionary
      .update_word(id, build_word(entry)?)
      .map_err(|error| error.to_string())?;
    apply_and_save_dictionary(core, &dictionary, &previous_dictionary, path)?;
    let word = dictionary.with_words(|words| words.get(&id).cloned());
    entry_from_word(
      id,
      &word.ok_or_else(|| "Updated dictionary entry was lost".to_string())?,
    )
  })
  .await?;
  clear_dictionary_caches(&state).await?;
  Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn move_dictionary_entry(
  state: State<'_, AppState>,
  id: String,
  direction: i32,
) -> Result<Vec<DictionaryEntry>, String> {
  let result = run_dictionary_task(&state, move |core, path| {
    let id = Uuid::parse_str(&id).map_err(|error| error.to_string())?;
    let previous_dictionary = load_dictionary(path)?;
    let dictionary = clone_dictionary(&previous_dictionary);
    move_dictionary_word(&dictionary, id, direction)?;
    apply_and_save_dictionary(core, &dictionary, &previous_dictionary, path)?;
    dictionary_entries(&dictionary)
  })
  .await?;
  clear_dictionary_caches(&state).await?;
  Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_dictionary_entry(state: State<'_, AppState>, id: String) -> Result<(), String> {
  run_dictionary_task(&state, move |core, path| {
    let id = Uuid::parse_str(&id).map_err(|error| error.to_string())?;
    let previous_dictionary = load_dictionary(path)?;
    let dictionary = clone_dictionary(&previous_dictionary);
    dictionary
      .remove_word(id)
      .map_err(|error| error.to_string())?;
    apply_and_save_dictionary(core, &dictionary, &previous_dictionary, path)
  })
  .await?;
  clear_dictionary_caches(&state).await
}

#[cfg(test)]
mod tests {
  use super::*;

  fn input(surface: &str) -> DictionaryEntryInput {
    DictionaryEntryInput {
      surface: surface.into(),
      pronunciation: "テスト".into(),
      accent_type: 1,
      word_type: DictionaryWordType::ProperNoun,
      priority: 7,
    }
  }

  #[test]
  fn dictionary_file_round_trips_all_entry_fields_and_ids() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("user_dictionary.json");
    let dictionary = UserDict::new();
    let id = dictionary
      .add_word(build_word(input("Azalea")).unwrap())
      .unwrap();
    save_dictionary(&dictionary, &path).unwrap();

    let loaded = load_dictionary(&path).unwrap();
    assert_eq!(
      dictionary_entries(&loaded).unwrap(),
      vec![DictionaryEntry {
        id: id.to_string(),
        surface: "Ａｚａｌｅａ".into(),
        pronunciation: "テスト".into(),
        accent_type: 1,
        word_type: DictionaryWordType::ProperNoun,
        priority: 7,
      }]
    );
  }

  #[test]
  fn dictionary_rejects_invalid_inputs_and_malformed_files() {
    assert!(build_word(input(" ")).is_err());
    let mut invalid_pronunciation = input("word");
    invalid_pronunciation.pronunciation = "ひらがな".into();
    assert!(build_word(invalid_pronunciation).is_err());
    let mut accent_beyond_mora_count = input("word");
    accent_beyond_mora_count.accent_type = 4;
    assert!(build_word(accent_beyond_mora_count).is_err());

    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("user_dictionary.json");
    std::fs::write(&path, b"not json").unwrap();
    assert!(load_dictionary(&path).is_err());
  }

  #[test]
  fn dictionary_reorders_entries_and_persists_the_order() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("user_dictionary.json");
    let dictionary = UserDict::new();
    let first = dictionary
      .add_word(build_word(input("first")).unwrap())
      .unwrap();
    let second = dictionary
      .add_word(build_word(input("second")).unwrap())
      .unwrap();
    let third = dictionary
      .add_word(build_word(input("third")).unwrap())
      .unwrap();

    move_dictionary_word(&dictionary, second, -1).unwrap();
    move_dictionary_word(&dictionary, second, 1).unwrap();
    move_dictionary_word(&dictionary, first, 1).unwrap();
    save_dictionary(&dictionary, &path).unwrap();
    let loaded = load_dictionary(&path).unwrap();
    let ids = dictionary_entries(&loaded)
      .unwrap()
      .into_iter()
      .map(|entry| Uuid::parse_str(&entry.id).unwrap())
      .collect::<Vec<_>>();

    assert_eq!(ids, vec![second, first, third]);
    assert!(move_dictionary_word(&loaded, second, -1).is_err());
    assert!(move_dictionary_word(&loaded, third, 1).is_err());
    assert!(move_dictionary_word(&loaded, second, 0).is_err());
    assert!(move_dictionary_word(&loaded, Uuid::new_v4(), 1).is_err());
  }
}
