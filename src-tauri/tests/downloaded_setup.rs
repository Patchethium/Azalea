//! Fresh-process compatibility check using the same assets as the required real-core suite.
use azalea_lib::{config::types::SetupSource, core::Core};
use std::path::Path;
use voicevox_core::blocking::UserDict;
use voicevox_core::UserDictWord;

mod common;

fn copy_tree(source: &Path, destination: &Path) {
  for entry in walkdir::WalkDir::new(source)
    .into_iter()
    .map(Result::unwrap)
  {
    let target = destination.join(entry.path().strip_prefix(source).unwrap());
    if entry.file_type().is_dir() {
      std::fs::create_dir_all(target).unwrap();
    } else if entry.file_type().is_file() {
      std::fs::copy(entry.path(), target).unwrap();
    }
  }
}

#[test]
fn partial_cpu_setup_synthesizes_and_shares_custom_dictionary() {
  let existing = common::test_core_config();
  let directory = tempfile::tempdir().unwrap();
  let mut downloaded = existing.clone();
  downloaded.ort_path = directory
    .path()
    .join(existing.ort_path.file_name().unwrap());
  std::fs::copy(&existing.ort_path, &downloaded.ort_path).unwrap();
  downloaded.ojt_dir = directory
    .path()
    .join("dictionary/open_jtalk_dic_utf_8-1.11");
  copy_tree(&existing.ojt_dir, &downloaded.ojt_dir);
  downloaded.vvm_dir = directory.path().join("models/0.16.4");
  std::fs::create_dir_all(&downloaded.vvm_dir).unwrap();
  let starter = walkdir::WalkDir::new(&existing.vvm_dir)
    .into_iter()
    .map(Result::unwrap)
    .find(|entry| entry.file_type().is_file() && entry.file_name() == "0.vvm")
    .expect("the real-core fixture must include 0.vvm")
    .into_path();
  std::fs::copy(starter, downloaded.vvm_dir.join("0.vvm")).unwrap();
  downloaded.setup_source = SetupSource::Downloaded;
  let core = Core::init(&downloaded).unwrap();
  assert!(!core.synthesizer.is_gpu_mode());
  assert_eq!(
    core.metas.len(),
    1,
    "partial setup loads only the selected package"
  );
  let style = *core.speaker_to_vvm.keys().min().unwrap();
  let dictionary_path = directory.path().join("shared-user-dictionary.json");
  let dictionary = UserDict::new();
  dictionary
    .add_word(
      UserDictWord::builder()
        .build("Azalea", "アザレア".into(), 2)
        .unwrap(),
    )
    .unwrap();
  dictionary.save(&dictionary_path).unwrap();
  let shared = UserDict::new();
  shared.load(&dictionary_path).unwrap();
  core.use_user_dictionary(&shared).unwrap();
  let query = core.audio_query("こんにちは、Azaleaです。", style).unwrap();
  let wav = core.synthesis(&query, style).unwrap();
  assert!(wav.starts_with(b"RIFF"));
  tauri::async_runtime::block_on(async {
    core.prepare_nonblocking_synthesis(style).await.unwrap();
    assert!(core
      .synthesis_nonblocking_prepared(&query, style)
      .await
      .unwrap()
      .starts_with(b"RIFF"));
  });
  let installation = Core::init(&existing).unwrap();
  assert_eq!(
    installation.config.setup_source,
    SetupSource::ExistingInstallation
  );
  assert_eq!(installation.config.vvm_dir, existing.vvm_dir);
  installation.use_user_dictionary(&shared).unwrap();
  assert!(installation
    .synthesis(&query, style)
    .unwrap()
    .starts_with(b"RIFF"));
  let second = Core::init(&downloaded).unwrap();
  assert_eq!(second.config.setup_source, SetupSource::Downloaded);
  assert!(!second.synthesizer.is_gpu_mode());
  second.use_user_dictionary(&shared).unwrap();
  assert_eq!(
    second.audio_query("Azalea", style).unwrap().accent_phrases[0]
      .moras
      .iter()
      .map(|m| m.text.as_str())
      .collect::<String>(),
    "アザレア"
  );
  assert_eq!(dictionary.to_json(), shared.to_json());
}
