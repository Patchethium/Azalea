use voicevox_core::{
  blocking::{Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile},
  AccentPhrase, AudioQuery, StyleId, StyleType, VoiceModelId, VoiceModelMeta,
};

use crate::config::CoreConfig;
use std::{
  collections::{HashMap, HashSet},
  path::{Path, PathBuf},
};
use walkdir::WalkDir;

use anyhow::{Context, Result};

pub fn search_file(filename: &str, dir: impl AsRef<Path>, partial: bool) -> Option<PathBuf> {
  for entry in WalkDir::new(dir).max_depth(8).into_iter().flatten() {
    let name = entry.file_name().to_string_lossy();
    let is_file = entry.path().is_file();
    let matches = name.contains(filename);
    if is_file {
      if partial && matches {
        return Some(entry.path().to_owned());
      } else if !partial && entry.file_name() == filename {
        return Some(entry.path().to_owned());
      }
    }
  }
  None
}

pub fn search_dir(dirname: &str, dir: impl AsRef<Path>, partial: bool) -> Option<PathBuf> {
  for entry in WalkDir::new(dir).max_depth(8).into_iter().flatten() {
    let name = entry.file_name().to_string_lossy();
    let is_dir = entry.path().is_dir();
    let matches = name.contains(dirname);

    if is_dir {
      if partial && matches {
        return Some(entry.path().to_owned());
      } else if !partial && entry.file_name() == dirname {
        return Some(entry.path().to_owned());
      }
    }
  }

  None
}

pub struct Core {
  pub synthesizer: Synthesizer<OpenJtalk>,
  pub metas: HashMap<String, VoiceModelMeta>,
  pub speaker_to_vvm: HashMap<StyleId, VoiceModelId>,
}

impl Core {
  /// Walk the dir where *.vvm is located
  /// Read meta from each vvm and return a (file path, metadata) list
  pub fn gather_meta(
    dir: impl AsRef<Path>,
  ) -> Result<(
    HashMap<StyleId, VoiceModelId>,
    HashMap<String, VoiceModelMeta>,
  )> {
    // TODO: organize the styles with character-styles mapping
    let mut metas = HashMap::new();
    let mut speaker_to_vvm = HashMap::new();
    for entry in WalkDir::new(dir).into_iter().flatten() {
      if entry.path().is_file() && entry.path().extension() == Some("vvm".as_ref()) {
        let vvm = VoiceModelFile::open(entry.path())?;
        let meta = vvm.metas().clone();
        let mut filtered_meta = HashMap::new();
        for m in meta.iter() {
          for style in &m.styles {
            if style.r#type == StyleType::Talk {
              speaker_to_vvm.insert(style.id, vvm.id());
              filtered_meta.insert(m.speaker_uuid.clone(), m.clone());
            }
          }
        }
        metas.insert(
          entry.path().to_string_lossy().to_string(),
          filtered_meta.into_values().collect(),
        );
      }
    }
    Ok((speaker_to_vvm, metas))
  }

  pub fn find_path(root: &Path) -> Option<CoreConfig> {
    const VVM_EXT: &str = ".vvm";
    const OJT_DIR_NAME: &str = "open_jtalk_dic_utf_8-1.11";
    #[cfg(target_os = "linux")]
    const ORT_NAME: &str = "libvoicevox_onnxruntime.so";
    #[cfg(target_os = "macos")]
    const ORT_NAME: &str = "libvoicevox_onnxruntime.dylib";
    #[cfg(target_os = "windows")]
    const ORT_NAME: &str = "voicevox_onnxruntime.dll";
    let ojt_dir = search_dir(OJT_DIR_NAME, root, true)?;
    let ort_path = search_file(ORT_NAME, root, true)?;
    let vvm_dir = search_file(VVM_EXT, root, true)?.parent()?.to_path_buf();
    Some(CoreConfig {
      vvm_dir,
      ojt_dir,
      ort_path,
      cache_size: crate::config::types::cache_size_default(),
    })
  }

  pub fn init(cfg: &CoreConfig) -> Result<Self> {
    let ort = Onnxruntime::load_once().filename(&cfg.ort_path).perform()?;
    let ojt = OpenJtalk::new(cfg.ojt_dir.to_string_lossy().to_string())?;
    let synthesizer = Synthesizer::builder(ort).text_analyzer(ojt).build()?;
    let (speaker_to_vvm, metas) = Self::gather_meta(&cfg.vvm_dir)?;
    Ok(Self {
      synthesizer,
      metas,
      speaker_to_vvm,
    })
  }

  pub fn load_speaker(&self, speaker_id: StyleId) -> Result<()> {
    let vvm_name = self
      .metas
      .iter()
      .find_map(|(k, v)| {
        v.iter()
          .flat_map(|cm| &cm.styles)
          .find(|style| style.id == speaker_id)
          .map(|_| k.clone())
      })
      .context("Speaker ID not found in any loaded VVM")?;
    let vvm = VoiceModelFile::open(&vvm_name)?;
    self.synthesizer.load_voice_model(&vvm).perform()?;
    Ok(())
  }

  pub fn is_speaker_loaded(&self, speaker_id: StyleId) -> bool {
    let vvm_id = match self.speaker_to_vvm.get(&speaker_id) {
      Some(id) => id,
      None => return false,
    };
    self.synthesizer.is_loaded_voice_model(*vvm_id)
  }

  pub fn audio_query(&self, text: &str, speaker_id: StyleId) -> Result<AudioQuery> {
    if !self.is_speaker_loaded(speaker_id) {
      self.load_speaker(speaker_id)?;
    }
    Ok(self.synthesizer.create_audio_query(text, speaker_id)?)
  }

  pub fn accent_phrases(&self, text: &str, speaker_id: StyleId) -> Result<Vec<AccentPhrase>> {
    if !self.is_speaker_loaded(speaker_id) {
      self.load_speaker(speaker_id)?;
    }
    Ok(self.synthesizer.create_accent_phrases(text, speaker_id)?)
  }

  /// Useful for accent phrase manipulation
  ///
  /// When changing accent phrases manually, call this to
  /// automatically updates mora data (pitch and length)
  pub fn replace_mora(
    &self,
    ap: Vec<AccentPhrase>,
    style_id: StyleId,
  ) -> Result<Vec<AccentPhrase>> {
    Ok(self.synthesizer.replace_mora_data(&ap, style_id)?)
  }

  /// same as `replace_mora` but only replaces pitch
  pub fn replace_mora_pitch(
    &self,
    ap: Vec<AccentPhrase>,
    style_id: StyleId,
  ) -> Result<Vec<AccentPhrase>> {
    Ok(self.synthesizer.replace_mora_pitch(&ap, style_id)?)
  }

  /// same as `replace_mora` but only replaces length
  pub fn replace_mora_duration(
    &self,
    ap: Vec<AccentPhrase>,
    style_id: StyleId,
  ) -> Result<Vec<AccentPhrase>> {
    Ok(self.synthesizer.replace_phoneme_length(&ap, style_id)?)
  }

  pub fn synthesis(&self, query: &AudioQuery, speaker_id: StyleId) -> Result<Vec<u8>> {
    if !self.is_speaker_loaded(speaker_id) {
      self.load_speaker(speaker_id)?;
    }
    Ok(self.synthesizer.synthesis(query, speaker_id).perform()?)
  }

  pub fn unload_all_speakers(&self) -> Result<()> {
    for vvm_id in self
      .speaker_to_vvm
      .values()
      .copied()
      .collect::<HashSet<_>>()
    {
      if self.synthesizer.is_loaded_voice_model(vvm_id) {
        self.synthesizer.unload_voice_model(vvm_id)?;
      }
    }
    Ok(())
  }

  pub fn unload_speaker(&self, speaker_id: StyleId) -> Result<()> {
    let vvm_id = match self.speaker_to_vvm.get(&speaker_id) {
      Some(id) => *id,
      None => return Ok(()),
    };
    if self.synthesizer.is_loaded_voice_model(vvm_id) {
      self.synthesizer.unload_voice_model(vvm_id)?;
    }
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn ort_name() -> &'static str {
    #[cfg(target_os = "linux")]
    return "libvoicevox_onnxruntime.so";
    #[cfg(target_os = "macos")]
    return "libvoicevox_onnxruntime.dylib";
    #[cfg(target_os = "windows")]
    return "voicevox_onnxruntime.dll";
  }

  #[test]
  fn searches_exact_and_partial_files_and_directories() {
    let root = tempfile::tempdir().unwrap();
    let nested = root.path().join("one").join("two");
    let dictionary = nested.join("open_jtalk_dic_utf_8-1.11-custom");
    std::fs::create_dir_all(&dictionary).unwrap();
    let model = nested.join("speaker.vvm");
    std::fs::write(&model, b"model").unwrap();

    assert_eq!(
      search_file("speaker.vvm", root.path(), false),
      Some(model.clone())
    );
    assert_eq!(search_file(".vvm", root.path(), true), Some(model));
    assert_eq!(
      search_dir("open_jtalk_dic_utf_8-1.11", root.path(), true),
      Some(dictionary)
    );
    assert_eq!(search_file("missing", root.path(), false), None);
  }

  #[test]
  fn search_respects_the_eight_level_limit() {
    let root = tempfile::tempdir().unwrap();
    let mut nested = root.path().to_path_buf();
    for level in 0..9 {
      nested.push(format!("level-{level}"));
    }
    std::fs::create_dir_all(&nested).unwrap();
    std::fs::write(nested.join("too-deep.vvm"), b"model").unwrap();

    assert_eq!(search_file(".vvm", root.path(), true), None);
  }

  #[test]
  fn find_path_discovers_a_complete_installation_tree() {
    let root = tempfile::tempdir().unwrap();
    let runtime = root.path().join("runtime");
    let dictionary = root.path().join("open_jtalk_dic_utf_8-1.11");
    let models = root.path().join("models");
    std::fs::create_dir_all(&runtime).unwrap();
    std::fs::create_dir_all(&dictionary).unwrap();
    std::fs::create_dir_all(&models).unwrap();
    let ort = runtime.join(ort_name());
    std::fs::write(&ort, b"runtime").unwrap();
    std::fs::write(models.join("speaker.vvm"), b"model").unwrap();

    let config = Core::find_path(root.path()).unwrap();

    assert_eq!(config.ort_path, ort);
    assert_eq!(config.ojt_dir, dictionary);
    assert_eq!(config.vvm_dir, models);
    assert_eq!(
      config.cache_size,
      crate::config::types::cache_size_default()
    );
  }

  #[test]
  fn find_path_rejects_incomplete_installations() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("speaker.vvm"), b"model").unwrap();

    assert!(Core::find_path(root.path()).is_none());
  }
}
