use crate::app::state::RangeItem;

use super::error::AppError;
use anyhow::Result;
use itertools::Itertools;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::path::PathBuf;
use AppError::*;

use voicevox_core::blocking::{Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile};
use voicevox_core::{AccentPhrase, AudioQuery, StyleId, StyleType, VoiceModelMeta};

#[derive(Type, Clone, Serialize, Deserialize)]
pub struct CoreConfig {
  pub ort_path: PathBuf,
  pub ojt_dir: PathBuf,
  pub vvm_dir: PathBuf,
}

pub type VvmMetas = HashMap<PathBuf, VoiceModelMeta>;
pub struct Core {
  synthesizer: Synthesizer<OpenJtalk>,
  loaded_models: HashMap<StyleId, PathBuf>,
  pub metas: VvmMetas,
}

const BENCHMARK_TEXT: &'static str = include_str!("../assets/rashomon.txt");

impl Core {
  pub fn read_metas(find_dir: &PathBuf) -> Result<VvmMetas, AppError> {
    let mut metas = HashMap::new();
    for entry in std::fs::read_dir(find_dir).map_err(|_| VoiceModelFileLoadError)? {
      if let Ok(entry) = entry {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("vvm") {
          let vmf = VoiceModelFile::open(&path).map_err(|_| VoiceModelFileLoadError)?;
          let mut meta = vmf.metas().clone();
          meta.iter_mut().for_each(|m| {
            m.styles = m
              .styles
              .iter()
              // filter out talk styles
              .filter(|st| st.r#type == StyleType::Talk)
              .cloned()
              .collect();
          });
          metas.insert(path, meta.clone());
        }
      }
    }
    Ok(metas)
  }

  /// TODO: Add automatic unloading accroding to memory size limit.
  pub fn load_voice_model_by_id(&mut self, style_id: StyleId) -> Result<(), AppError> {
    if self.loaded_models.contains_key(&style_id) {
      return Ok(());
    }

    let voice_model_path = self
      .find_voice_model_by_id(style_id)
      .ok_or(VoiceModelNotFoundError)?
      .clone();

    let vmf = VoiceModelFile::open(&voice_model_path).map_err(|_| VoiceModelFileLoadError)?;
    self
      .synthesizer
      .load_voice_model(&vmf)
      .map_err(|_| VoiceModelFileLoadError)?;
    for cm in vmf.metas() {
      for st in &cm.styles {
        self
          .loaded_models
          .insert(st.id.clone(), voice_model_path.clone());
      }
    }
    Ok(())
  }

  fn find_voice_model_by_id(&self, style_id: StyleId) -> Option<&PathBuf> {
    for (path, meta) in &self.metas {
      if meta
        .iter()
        .any(|s| s.styles.iter().any(|st| st.id == style_id))
      {
        return Some(path);
      }
    }
    None
  }

  pub fn new(cfg: &CoreConfig) -> Result<Self, AppError> {
    let ort = Onnxruntime::load_once()
      .filename(&cfg.ort_path)
      .perform()
      .map_err(|_| OnnxruntimeLoadError)?;
    let ojt =
      OpenJtalk::new(cfg.ojt_dir.to_string_lossy().to_string()).map_err(|_| OpenJtalkLoadError)?;
    let synthesizer = Synthesizer::builder(ort)
      .text_analyzer(ojt)
      .build()
      .map_err(|_| SynthesizerBuildError)?;

    let metas = Self::read_metas(&cfg.vvm_dir)?;
    Ok(Core {
      synthesizer,
      metas,
      loaded_models: HashMap::new(),
    })
  }

  // TTS logic goes here
  /// Load the voice model by style_id if not loaded, then generate audio query.
  pub fn audio_query(&self, text: &str, style_id: StyleId) -> Result<AudioQuery, AppError> {
    if !self.loaded_models.contains_key(&style_id) {
      return Err(VoiceModelNotLoadedError);
    }

    let query = self
      .synthesizer
      .create_audio_query(text, style_id)
      .map_err(|_| AudioQueryError)?;
    Ok(query)
  }

  pub fn accent_phrases(
    &self,
    text: &str,
    style_id: StyleId,
  ) -> Result<Vec<AccentPhrase>, AppError> {
    if !self.loaded_models.contains_key(&style_id) {
      return Err(VoiceModelNotLoadedError);
    }
    let accent_phrases = self
      .synthesizer
      .create_accent_phrases(text, style_id)
      .map_err(|_| AccentPhrasesError)?;
    Ok(accent_phrases)
  }

  pub fn synthesis(&self, query: &AudioQuery, style_id: StyleId) -> Result<Vec<u8>, AppError> {
    if !self.loaded_models.contains_key(&style_id) {
      return Err(VoiceModelNotLoadedError);
    }
    let audio = self
      .synthesizer
      .synthesis(query, style_id)
      .perform()
      .map_err(|_| SynthesisError)?;
    Ok(audio)
  }

  /* Analyze benchmark text to find optimal pitch range for given style_id.
  python implementation reference:
  ```python
  def min_density_range(data: list[float], density_ratio: float = 0.95):
      arr = sorted(data)
      n = len(arr)
      window_size = int(n * density_ratio)
      min_range = (arr[0], arr[-1])
      for i in range(n - window_size + 1):
          current_range = (arr[i], arr[i + window_size - 1])
          if current_range[1] - current_range[0] < min_range[1] - min_range[0]:
              min_range = current_range
      return min_range
  ```
  TODO: Error handling
  */
  pub fn optimal_pitch_range(&self, style_id: StyleId, density_ratio: f32) -> RangeItem {
    use RangeItem::*;
    const THRESHOLD: f32 = 1.0;
    let queries = BENCHMARK_TEXT
      .lines()
      .collect_vec()
      .par_iter()
      .map(|text| self.audio_query(text, style_id).ok())
      .filter_map(|q| q)
      .collect::<Vec<_>>();
    let mut pits = queries
      .iter()
      .flat_map(|q| {
        q.accent_phrases.iter().flat_map(|ap| {
          ap.moras
            .iter()
            .filter(|m| m.pitch > THRESHOLD)
            .map(|m| m.pitch)
        })
      })
      .collect_vec();
    if pits.is_empty() {
      return Whisper;
    }
    // sort, use a sliding window to find the range
    pits.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = pits.len();
    let window_size = (n as f32 * density_ratio).ceil() as usize;
    let mut min_range = (pits[0], pits[n - 1]);
    for i in 0..=(n - window_size) {
      let current_range = (pits[i], pits[i + window_size - 1]);
      if current_range.1 - current_range.0 < min_range.1 - min_range.0 {
        min_range = current_range;
      }
    }
    Normal(min_range.0, min_range.1)
  }
}
