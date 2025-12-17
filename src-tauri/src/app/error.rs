use serde::{Deserialize, Serialize};
use specta::Type;
use thiserror::Error;

#[derive(Error, Debug, Type, Clone, Serialize, Deserialize)]
pub enum AppError {
  #[error("Core: Failed to load Onnxruntime")]
  OnnxruntimeLoadError,
  #[error("Core: Failed to load OpenJtalk dictionary")]
  OpenJtalkLoadError,
  #[error("Core: Failed to build Synthesizer")]
  SynthesizerBuildError,
  #[error("Core: Failed to load Voice Model File")]
  VoiceModelFileLoadError,
  #[error("Core: Voice Model not found for given Style ID")]
  VoiceModelNotFoundError,
  #[error("Core: Voice Model not loaded for given Style ID")]
  VoiceModelNotLoadedError,
  #[error("Core: Failed to create Audio Query")]
  AudioQueryError,
  #[error("Core: Failed to create Accent Phrases")]
  AccentPhrasesError,
  #[error("Core: Failed to Synthesize Audio")]
  SynthesisError,
  // app related errors
  #[error("App: Failed to read config file")]
  ConfigReadError,
  #[error("App: Failed to parse config file(Invalid TOML)")]
  ConfigDeserializeError,
  #[error("App: Failed to write config file")]
  ConfigWriteError,
  #[error("App: Failed to serialize config file")]
  ConfigSerializeError,
  #[error("App: Core not loaded")]
  CoreNotLoadedError,
  #[error("App: OS config directory not found")]
  OsConfigDirNotFoundError,
  #[error("App: Failed to deserialize range data")]
  RangeDeserializeError,
}
