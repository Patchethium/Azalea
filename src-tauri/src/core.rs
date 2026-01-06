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
          entry.path().to_str().unwrap().to_string(),
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
    self.synthesizer.load_voice_model(&vvm)?;
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

  /// Useful for accent phrase manipulation
  ///
  /// When changing accent phrases manually, call this to
  /// automatically updates mora data (pitch and length)
  pub fn replace_mora(&self, ap: Vec<AccentPhrase>, style_id: StyleId) -> Result<Vec<AccentPhrase>> {
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
    for vvm_id in self.speaker_to_vvm.values().collect::<HashSet<_>>() {
      self.synthesizer.unload_voice_model(*vvm_id)?;
    }
    Ok(())
  }

  pub fn unload_speaker(&self, speaker_id: StyleId) -> Result<()> {
    let vvm_id = match self.speaker_to_vvm.get(&speaker_id) {
      Some(id) => *id,
      None => return Ok(()),
    };
    self.synthesizer.unload_voice_model(vvm_id)?;
    Ok(())
  }
}
