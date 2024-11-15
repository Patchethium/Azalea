use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;

#[derive(Default, Clone, Deserialize, Serialize, Type)]
pub struct AzaleaConfig {
  pub core_config: CoreConfig,
}

#[derive(Default, Clone, Deserialize, Serialize, Type)]
pub struct CoreConfig {
  /// The Path to the core directory, it should be the directory containing the dynamic library.
  /// For example, if the lib is in `/home/user/VOICEVOX/vv-engine/libvoicevox_core.so`,
  /// the path should be `/home/user/VOICEVOX/vv-engine`.
  pub core_path: Option<PathBuf>,
  pub ojt_path: Option<PathBuf>,
  pub cache_size: usize,
}