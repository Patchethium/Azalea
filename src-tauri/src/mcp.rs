//! A stdio MCP server, started by launching the app with `--mcp`, that lets LLM
//! clients list the installed voices, keep presets and synthesize speech.
//!
//! It loads its own core from the app's voice setup, so it works without the
//! app running, and answers only while `UIConfig.mcp_enabled` is on. That
//! switch is read on every call, so toggling it in the config dialog takes
//! effect without restarting the client. No other app setting changes what a
//! call returns: reading options are arguments, and `get_status` reports the
//! app's settings only as a reminder.
use std::{
  collections::HashMap,
  path::{Path, PathBuf},
  sync::{Arc, Mutex},
};

use rmcp::{
  handler::server::{router::tool::ToolRouter, wrapper::Parameters},
  model::{Implementation, ServerCapabilities, ServerConfig},
  schemars, tool, tool_handler, tool_router, Json, ServerHandler, ServiceExt,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{OnceCell, Semaphore};
use voicevox_core::{blocking::UserDict, CharacterMeta, StyleId};

mod ids;
mod presets;

pub use ids::IDS_FILE;
pub use presets::{
  CreatePresetRequest, DeletePresetRequest, DeletedPreset, PresetInfo, PresetList,
  UpdatePresetRequest, PRESETS_FILE,
};

use crate::{
  commands::{load_dictionary, resolve_setup},
  config::{
    manager::{config_dir, user_dictionary_path},
    types::{Preset, UIConfig},
    ConfigManager,
  },
  core::{is_talk_style, Core},
  english::EnglishOptions,
};
use presets::{Catalog, PresetStore, StoredPreset};

/// The command-line flag that starts the server instead of the app.
pub const MCP_FLAG: &str = "--mcp";

/// The longest text one call reads.
pub const MAX_TEXT_CHARS: usize = 2000;

/// A tool error: a stable code a client can branch on, then the explanation.
pub(crate) fn fail(code: &str, message: impl std::fmt::Display) -> String {
  format!("{code}: {message}")
}

macro_rules! disabled_message {
  () => {
    "disabled: Azalea's MCP server is disabled, and only the user can enable it. Ask the user to \
    turn on the experimental \"MCP Server\" switch in Azalea's config dialog (Synthesis section), \
    then retry; no restart is needed."
  };
}

/// Debug builds read `config_dev`, so only a development window's switch reaches them.
#[cfg(debug_assertions)]
pub const DISABLED_MESSAGE: &str = concat!(
  disabled_message!(),
  " This is a development build, which reads config_dev: turn it on in a `pnpm tauri dev` \
  window, not in an installed Azalea."
);
#[cfg(not(debug_assertions))]
pub const DISABLED_MESSAGE: &str = disabled_message!();

#[derive(Clone, Debug, Default, PartialEq, Serialize, schemars::JsonSchema)]
pub struct AppEnglishSettings {
  pub enabled: bool,
  pub accent_prediction: bool,
  pub ngram_filter: bool,
  /// `base` or `turbo`.
  pub model: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, schemars::JsonSchema)]
pub struct AppPitchNoiseSettings {
  pub enabled: bool,
  pub sigma: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, schemars::JsonSchema)]
pub struct AppPitchCompletionSettings {
  pub enabled: bool,
}

/// How the user has set these features in the Azalea app. A reminder only:
/// nothing here is applied to this server's calls. Pass the matching
/// arguments to get the same behavior.
#[derive(Clone, Debug, Default, PartialEq, Serialize, schemars::JsonSchema)]
pub struct AppSettings {
  pub english: AppEnglishSettings,
  pub pitch_noise: AppPitchNoiseSettings,
  pub pitch_completion: AppPitchCompletionSettings,
}

impl From<&UIConfig> for AppSettings {
  fn from(ui: &UIConfig) -> Self {
    Self {
      english: AppEnglishSettings {
        enabled: ui.english_transform,
        accent_prediction: ui.english_accent_prediction,
        ngram_filter: ui.english_ngram_filter,
        model: if ui.english_turbo_model {
          "turbo"
        } else {
          "base"
        }
        .into(),
      },
      pitch_noise: AppPitchNoiseSettings {
        enabled: ui.pitch_noise_enabled,
        sigma: (ui.pitch_noise_sigma as f64 * 1000.0).round() / 1000.0,
      },
      pitch_completion: AppPitchCompletionSettings {
        enabled: ui.pitch_completion_enabled,
      },
    }
  }
}

/// What the server reads from the app on each call.
#[derive(Clone, Debug, Default)]
pub struct McpSettings {
  /// The only app setting that changes what a call does.
  pub enabled: bool,
  /// Whether the English reading models are downloaded.
  pub english_available: bool,
  /// Reported by `get_status`, never applied.
  pub app_settings: AppSettings,
  /// The app's system presets, offered read-only.
  pub user_presets: Vec<Preset>,
}

/// Where the server gets its settings, core, files and output directory,
/// replaceable in tests.
pub trait McpEnvironment: Send + Sync + 'static {
  fn settings(&self) -> Result<McpSettings, String>;
  /// Builds the core; called at most once, on the first call that needs it.
  fn load_core(&self) -> Result<Core, String>;
  fn output_dir(&self) -> PathBuf;
  /// The file holding the agent's presets.
  fn presets_path(&self) -> PathBuf;
  /// The file recording the short IDs issued.
  fn ids_path(&self) -> PathBuf;
  /// The user dictionary the app saves.
  fn dictionary_path(&self) -> PathBuf;
}

/// Reads the app's config, user dictionary and downloaded English models.
struct AppEnvironment;

impl McpEnvironment for AppEnvironment {
  fn settings(&self) -> Result<McpSettings, String> {
    let config = ConfigManager::new()
      .map_err(|e| fail("io_error", e))?
      .config;
    Ok(McpSettings {
      enabled: config.ui.mcp_enabled,
      english_available: crate::english::models_available(),
      app_settings: AppSettings::from(&config.ui),
      user_presets: config.system_presets,
    })
  }

  fn load_core(&self) -> Result<Core, String> {
    let config = ConfigManager::new()
      .map_err(|e| fail("io_error", e))?
      .config;
    let core_config = resolve_setup(&config)
      .map_err(|e| fail("core_error", e))?
      .ok_or_else(|| {
        fail(
          "no_voice_setup",
          "No voice setup is configured. Ask the user to open Azalea and set one up first.",
        )
      })?;
    Core::init(&core_config).map_err(|e| fail("core_error", e))
  }

  fn output_dir(&self) -> PathBuf {
    std::env::temp_dir().join("azalea-mcp")
  }

  fn presets_path(&self) -> PathBuf {
    config_dir().join(PRESETS_FILE)
  }

  fn ids_path(&self) -> PathBuf {
    config_dir().join(IDS_FILE)
  }

  fn dictionary_path(&self) -> PathBuf {
    user_dictionary_path()
  }
}

#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct StyleInfo {
  /// Numeric style ID, also accepted by `update_preset` as the style.
  pub id: u32,
  pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct SpeakerInfo {
  pub name: String,
  pub speaker_uuid: String,
  pub styles: Vec<StyleInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct SpeakerList {
  pub speakers: Vec<SpeakerInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CoreStatus {
  /// Whether a call has loaded the voice core yet.
  pub loaded: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct EnglishStatus {
  /// Whether the English reading models are downloaded, so the `english`
  /// argument can be used. The user downloads them in Azalea's config dialog.
  pub available: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct PitchControlStatus {
  /// Whether the loaded runtime supports pitch noise and pitch completion;
  /// null until the core is loaded.
  pub available: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct DictionaryStatus {
  /// Number of words in the user dictionary.
  pub entries: usize,
  /// A short hash of the user dictionary. When it changes, the same text may
  /// be read differently.
  pub revision: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct Limits {
  pub max_text_chars: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct Status {
  /// Whether the user has turned the server on. Every other tool fails while
  /// this is false.
  pub enabled: bool,
  pub app_version: String,
  pub core: CoreStatus,
  pub english: EnglishStatus,
  pub pitch_control: PitchControlStatus,
  pub dictionary: DictionaryStatus,
  pub app_settings: AppSettings,
  pub limits: Limits,
  /// Where audio is written.
  pub temp_dir: String,
}

#[derive(Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SynthesizeRequest {
  /// The Japanese text to read aloud. Pass this or `kana`, not both.
  pub text: Option<String>,
  /// The reading in AquesTalk-style kana, as returned in a result's `kana`:
  /// katakana with `'` after each phrase's accented mora, `/` between
  /// phrases, `、` for a pause, `_` before a devoiced mora and a final `？`
  /// for a question. Use it to correct a reading or an accent.
  pub kana: Option<String>,
  /// ID of a preset from `list_presets` or `create_preset`. Required: it
  /// supplies the voice, speed, pitch, intonation, volume and silences.
  pub preset_id: Option<String>,
  /// Read `text` with the user's dictionary (default true). False gives the
  /// same reading on every installation.
  pub apply_dictionary: Option<bool>,
  /// Read English words in `text` as katakana instead of spelling them out
  /// (default false). Needs the English models; see `get_status`.
  pub english: Option<bool>,
  /// With `english`: use the predicted accent for those words (default true).
  pub english_accent: Option<bool>,
  /// With `english`: keep acronyms spelled out (default true).
  pub english_ngram_filter: Option<bool>,
  /// With `english`: `base` (default) or `turbo`, the smaller model.
  pub english_model: Option<String>,
}

/// What a call reads aloud.
#[derive(Debug, Clone, PartialEq)]
enum Utterance {
  Text(String),
  Kana(String),
}

/// How a call's `text` is read.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Reading {
  apply_dictionary: bool,
  english: Option<EnglishOptions>,
}

fn given(value: &Option<String>) -> Option<String> {
  value
    .as_deref()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(str::to_owned)
}

/// Checks a request's arguments without reading any state.
fn checked_request(request: &SynthesizeRequest) -> Result<(Utterance, String, Reading), String> {
  let utterance = match (given(&request.text), given(&request.kana)) {
    (Some(text), None) => Utterance::Text(text),
    (None, Some(kana)) => Utterance::Kana(kana),
    (Some(_), Some(_)) => {
      return Err(fail(
        "invalid_argument",
        "Pass either text or kana, not both.",
      ))
    }
    (None, None) => return Err(fail("invalid_argument", "Pass the text or kana to read.")),
  };
  let length = match &utterance {
    Utterance::Text(value) | Utterance::Kana(value) => value.chars().count(),
  };
  if length > MAX_TEXT_CHARS {
    return Err(fail(
      "limit_exceeded",
      format!("The text has {length} characters; the limit is {MAX_TEXT_CHARS}. Split it up."),
    ));
  }
  let preset_id = given(&request.preset_id).ok_or_else(|| {
    fail(
      "missing_preset",
      "Pass preset_id. Choose one from list_presets, or make one with create_preset and \
      update_preset.",
    )
  })?;
  let turbo = match given(&request.english_model).as_deref() {
    None | Some("base") => false,
    Some("turbo") => true,
    Some(other) => {
      return Err(fail(
        "invalid_argument",
        format!("english_model must be base or turbo, got \"{other}\"."),
      ))
    }
  };
  let english = request.english.unwrap_or(false).then_some(EnglishOptions {
    accent_prediction: request.english_accent.unwrap_or(true),
    ngram_filter: request.english_ngram_filter.unwrap_or(true),
    turbo,
  });
  Ok((
    utterance,
    preset_id,
    Reading {
      apply_dictionary: request.apply_dictionary.unwrap_or(true),
      english,
    },
  ))
}

#[derive(Debug, Clone, Serialize, schemars::JsonSchema)]
pub struct SynthesizeResult {
  /// Absolute path of the written WAV file.
  pub path: String,
  pub duration_seconds: f64,
  pub sample_rate: u32,
  pub preset_id: String,
  pub speaker: String,
  pub style: String,
  pub style_id: u32,
  /// The credit line the character's terms of use ask for.
  pub credit: String,
  /// How the text was read, in the notation the `kana` argument accepts.
  pub kana: String,
}

/// Lists the talk speakers and styles in `metas`, merging speakers split across
/// models, in the order VOICEVOX declares.
pub fn speaker_list<'a>(metas: impl IntoIterator<Item = &'a CharacterMeta>) -> Vec<SpeakerInfo> {
  let mut speakers: Vec<(Option<u32>, SpeakerInfo, Vec<(Option<u32>, StyleInfo)>)> = Vec::new();
  let mut index: HashMap<String, usize> = HashMap::new();
  for meta in metas {
    let position = *index.entry(meta.speaker_uuid.clone()).or_insert_with(|| {
      speakers.push((
        meta.order,
        SpeakerInfo {
          name: meta.name.clone(),
          speaker_uuid: meta.speaker_uuid.clone(),
          styles: Vec::new(),
        },
        Vec::new(),
      ));
      speakers.len() - 1
    });
    let styles = &mut speakers[position].2;
    for style in meta.styles.iter().filter(|s| is_talk_style(s.r#type)) {
      if styles.iter().all(|(_, known)| known.id != style.id.0) {
        styles.push((
          style.order,
          StyleInfo {
            id: style.id.0,
            name: style.name.clone(),
          },
        ));
      }
    }
  }
  speakers.retain(|(_, _, styles)| !styles.is_empty());
  // Unordered entries go last; ties keep a stable, ID-based order.
  speakers.sort_by_key(|(order, info, _)| (order.is_none(), *order, info.name.clone()));
  speakers
    .into_iter()
    .map(|(_, mut info, mut styles)| {
      styles.sort_by_key(|(order, style)| (order.is_none(), *order, style.id));
      info.styles = styles.into_iter().map(|(_, style)| style).collect();
      info
    })
    .collect()
}

/// Finds the style a request names: the speaker by UUID or name, then the style
/// by name or numeric ID. Names match exactly first, then ignoring case.
pub fn resolve_style<'a>(
  speakers: &'a [SpeakerInfo],
  speaker: &str,
  style: &str,
) -> Result<(&'a SpeakerInfo, &'a StyleInfo), String> {
  let speaker = speaker.trim();
  let style = style.trim();
  let found = speakers
    .iter()
    .find(|s| s.speaker_uuid == speaker || s.name == speaker)
    .or_else(|| {
      speakers
        .iter()
        .find(|s| s.name.to_lowercase() == speaker.to_lowercase())
    })
    .ok_or_else(|| {
      let names: Vec<&str> = speakers.iter().map(|s| s.name.as_str()).collect();
      fail(
        "unknown_speaker",
        format!(
          "Unknown speaker \"{speaker}\". Available speakers: {}",
          names.join(", ")
        ),
      )
    })?;
  let id = style.parse::<u32>().ok();
  let found_style = found
    .styles
    .iter()
    .find(|s| s.name == style || Some(s.id) == id)
    .or_else(|| {
      found
        .styles
        .iter()
        .find(|s| s.name.to_lowercase() == style.to_lowercase())
    })
    .ok_or_else(|| {
      let names: Vec<&str> = found.styles.iter().map(|s| s.name.as_str()).collect();
      fail(
        "unknown_style",
        format!(
          "Unknown style \"{style}\" for {}. Available styles: {}",
          found.name,
          names.join(", ")
        ),
      )
    })?;
  Ok((found, found_style))
}

/// A short hash identifying a dictionary file's contents.
pub fn dictionary_revision(bytes: &[u8]) -> String {
  Sha256::digest(bytes)[..4]
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect()
}

/// The dictionary file's bytes; a missing file is an empty dictionary.
fn dictionary_bytes(path: &Path) -> Result<Vec<u8>, String> {
  match std::fs::read(path) {
    Ok(bytes) => Ok(bytes),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
    Err(error) => Err(fail(
      "io_error",
      format!("Failed to read {}: {error}", path.display()),
    )),
  }
}

fn dictionary_status(path: &Path) -> Result<DictionaryStatus, String> {
  let bytes = dictionary_bytes(path)?;
  let entries = if bytes.is_empty() {
    0
  } else {
    load_dictionary(path)
      .map_err(|e| fail("io_error", e))?
      .with_words(|words| words.len())
  };
  Ok(DictionaryStatus {
    entries,
    revision: dictionary_revision(&bytes),
  })
}

/// The revision of the user dictionary a call wants in the core: none when it
/// opted out or the user has no dictionary.
fn wanted_dictionary(path: &Path, apply: bool) -> Result<Option<String>, String> {
  if !apply {
    return Ok(None);
  }
  let bytes = dictionary_bytes(path)?;
  Ok((!bytes.is_empty()).then(|| dictionary_revision(&bytes)))
}

/// Makes the core read text with the user dictionary as saved now, or without
/// it, switching only when that differs from what the last call left applied.
fn sync_dictionary(
  core: &Core,
  path: &Path,
  apply: bool,
  applied: &Mutex<Option<String>>,
) -> Result<(), String> {
  let wanted = wanted_dictionary(path, apply)?;
  let mut applied = applied.lock().map_err(|e| fail("core_error", e))?;
  if *applied != wanted {
    let dictionary = match wanted {
      Some(_) => load_dictionary(path).map_err(|e| fail("io_error", e))?,
      None => UserDict::new(),
    };
    core
      .use_user_dictionary(&dictionary)
      .map_err(|e| fail("core_error", e))?;
    *applied = wanted;
  }
  Ok(())
}

/// Sample rate and audio seconds of a 16-bit PCM WAV, from its header.
fn wav_info(wav: &[u8]) -> Result<(u32, f64), String> {
  let reader = hound::WavReader::new(wav).map_err(|e| fail("core_error", e))?;
  let spec = reader.spec();
  let seconds = reader.duration() as f64 / spec.sample_rate as f64;
  Ok((spec.sample_rate, seconds))
}

fn write_wav(dir: &Path, style_id: u32, wav: &[u8]) -> Result<PathBuf, String> {
  std::fs::create_dir_all(dir).map_err(|e| {
    fail(
      "io_error",
      format!("Failed to create {}: {e}", dir.display()),
    )
  })?;
  let path = dir.join(format!("azalea-{style_id}-{}.wav", uuid::Uuid::new_v4()));
  std::fs::write(&path, wav).map_err(|e| {
    fail(
      "io_error",
      format!("Failed to write {}: {e}", path.display()),
    )
  })?;
  Ok(path)
}

fn joined<T>(result: Result<Result<T, String>, tokio::task::JoinError>) -> Result<T, String> {
  result.map_err(|e| fail("core_error", e))?
}

#[derive(Clone)]
pub struct AzaleaMcp {
  environment: Arc<dyn McpEnvironment>,
  core: Arc<OnceCell<Arc<Core>>>,
  /// Serializes synthesis, like the app's core task gate.
  gate: Arc<Semaphore>,
  /// Serializes reads and writes of the preset and ID files.
  store_gate: Arc<tokio::sync::Mutex<()>>,
  /// The revision of the user dictionary the core reads text with; none when
  /// it reads without one.
  applied_dictionary: Arc<Mutex<Option<String>>>,
  tool_router: ToolRouter<Self>,
}

#[tool_router]
impl AzaleaMcp {
  pub fn new(environment: impl McpEnvironment) -> Self {
    Self {
      environment: Arc::new(environment),
      core: Arc::new(OnceCell::new()),
      gate: Arc::new(Semaphore::new(1)),
      store_gate: Arc::new(tokio::sync::Mutex::new(())),
      applied_dictionary: Arc::new(Mutex::new(None)),
      tool_router: Self::tool_router(),
    }
  }

  async fn settings(&self) -> Result<McpSettings, String> {
    let environment = self.environment.clone();
    joined(tokio::task::spawn_blocking(move || environment.settings()).await)
  }

  /// The settings, when the user has turned the server on.
  async fn enabled(&self) -> Result<McpSettings, String> {
    let settings = self.settings().await?;
    if settings.enabled {
      Ok(settings)
    } else {
      Err(DISABLED_MESSAGE.into())
    }
  }

  /// Checks the setting and loads the core on first use.
  async fn ready(&self) -> Result<(McpSettings, Arc<Core>), String> {
    let settings = self.enabled().await?;
    let core = self
      .core
      .get_or_try_init(|| async {
        let environment = self.environment.clone();
        joined(tokio::task::spawn_blocking(move || environment.load_core().map(Arc::new)).await)
      })
      .await?
      .clone();
    Ok((settings, core))
  }

  fn speakers(core: &Core) -> Vec<SpeakerInfo> {
    let mut metas: Vec<(&String, &Vec<CharacterMeta>)> = core.metas.iter().collect();
    // Model paths give a deterministic merge order before sorting.
    metas.sort_by_key(|(path, _)| *path);
    speaker_list(metas.into_iter().flat_map(|(_, metas)| metas))
  }

  /// Runs `task` on the presets as stored now, alone, so a change is never
  /// lost to another call's.
  async fn with_presets<T: Send + 'static>(
    &self,
    settings: &McpSettings,
    task: impl FnOnce(&PresetStore, Catalog, ids::IdFile) -> Result<T, String> + Send + 'static,
  ) -> Result<T, String> {
    let store = PresetStore {
      presets_path: self.environment.presets_path(),
      ids_path: self.environment.ids_path(),
    };
    let app_presets = settings.user_presets.clone();
    let _guard = self.store_gate.lock().await;
    joined(
      tokio::task::spawn_blocking(move || {
        let (catalog, ids) = store.load(&app_presets).map_err(|e| fail("io_error", e))?;
        task(&store, catalog, ids)
      })
      .await,
    )
  }

  #[tool(
    description = "Report what this installation can do and what can change a result between \
    calls: whether the server is enabled, the core version, whether English reading and pitch \
    control are available, the user dictionary's size and revision, and limits. Works even \
    while the server is disabled. `app_settings` shows how the user set these features in the \
    Azalea app as a reminder only; none of them is applied to this server's calls."
  )]
  pub async fn get_status(&self) -> Result<Json<Status>, String> {
    let settings = self.settings().await?;
    let path = self.environment.dictionary_path();
    let dictionary = joined(tokio::task::spawn_blocking(move || dictionary_status(&path)).await)?;
    let core = self.core.get();
    Ok(Json(Status {
      enabled: settings.enabled,
      app_version: env!("CARGO_PKG_VERSION").into(),
      core: CoreStatus {
        loaded: core.is_some(),
      },
      english: EnglishStatus {
        available: settings.english_available,
      },
      pitch_control: PitchControlStatus {
        available: core.map(|core| core.supports_pitch_control()),
      },
      dictionary,
      app_settings: settings.app_settings,
      limits: Limits {
        max_text_chars: MAX_TEXT_CHARS,
      },
      temp_dir: self.environment.output_dir().to_string_lossy().into_owned(),
    }))
  }

  #[tool(
    description = "List the installed VOICEVOX speakers and their talk styles. Give a preset a \
    speaker's name or UUID and a style's name or ID with `update_preset`."
  )]
  pub async fn list_speakers(&self) -> Result<Json<SpeakerList>, String> {
    let (_, core) = self.ready().await?;
    Ok(Json(SpeakerList {
      speakers: Self::speakers(&core),
    }))
  }

  #[tool(
    description = "List the presets `synthesize` can use, each with its ID, voice, speed, pitch, \
    intonation, volume and silences. `agent` holds the presets made with create_preset, which \
    can be updated and deleted and are kept until deleted; `user` holds the user's presets from \
    the Azalea app, which are read-only."
  )]
  pub async fn list_presets(&self) -> Result<Json<PresetList>, String> {
    let (settings, core) = self.ready().await?;
    self
      .list_presets_with(&settings, Self::speakers(&core))
      .await
  }

  async fn list_presets_with(
    &self,
    settings: &McpSettings,
    speakers: Vec<SpeakerInfo>,
  ) -> Result<Json<PresetList>, String> {
    self
      .with_presets(settings, move |_, catalog, _| {
        let infos = |presets: &[StoredPreset]| {
          presets
            .iter()
            .map(|preset| presets::preset_info(&speakers, preset))
            .collect()
        };
        Ok(Json(PresetList {
          agent: infos(&catalog.agent),
          user: infos(&catalog.user),
        }))
      })
      .await
  }

  #[tool(
    description = "Start a new preset and get its ID. Returns a template with default values \
    and no voice, or a copy of the preset named by copy_from. Fill it in and pass it to \
    update_preset, then pass its ID to `synthesize` as preset_id. Presets are kept until \
    deleted with delete_preset, separate from the Azalea app's presets."
  )]
  pub async fn create_preset(
    &self,
    Parameters(request): Parameters<CreatePresetRequest>,
  ) -> Result<Json<PresetInfo>, String> {
    let (settings, core) = self.ready().await?;
    self
      .create_preset_with(&settings, Self::speakers(&core), request)
      .await
  }

  async fn create_preset_with(
    &self,
    settings: &McpSettings,
    speakers: Vec<SpeakerInfo>,
    request: CreatePresetRequest,
  ) -> Result<Json<PresetInfo>, String> {
    self
      .with_presets(settings, move |store, mut catalog, mut ids| {
        let source = match given(&request.copy_from) {
          Some(id) => Some(catalog.find(&id)?.0.clone()),
          None => None,
        };
        let id = ids.issue().map_err(|e| fail("limit_exceeded", e))?;
        let preset = match source {
          Some(source) => StoredPreset { id, ..source },
          None => StoredPreset::template(id),
        };
        let info = presets::preset_info(&speakers, &preset);
        catalog.agent.push(preset);
        store
          .save(&catalog.agent, &ids)
          .map_err(|e| fail("io_error", e))?;
        Ok(Json(info))
      })
      .await
  }

  #[tool(
    description = "Set a preset made with create_preset: pass the whole preset back with its \
    id, a speaker and style from list_speakers, and any of name, speed, pitch, intonation, \
    volume and silences. Every value is replaced; omitted ones return to their defaults. The \
    user's presets cannot be changed: copy one with create_preset first."
  )]
  pub async fn update_preset(
    &self,
    Parameters(request): Parameters<UpdatePresetRequest>,
  ) -> Result<Json<PresetInfo>, String> {
    let (settings, core) = self.ready().await?;
    self
      .update_preset_with(&settings, Self::speakers(&core), request)
      .await
  }

  async fn update_preset_with(
    &self,
    settings: &McpSettings,
    speakers: Vec<SpeakerInfo>,
    request: UpdatePresetRequest,
  ) -> Result<Json<PresetInfo>, String> {
    let (Some(speaker), Some(style)) = (given(&request.speaker), given(&request.style)) else {
      return Err(fail(
        "invalid_argument",
        "Pass both speaker and style; choose them from list_speakers.",
      ));
    };
    self
      .with_presets(settings, move |store, mut catalog, ids| {
        let (found, is_user) = catalog.find(&request.id)?;
        if is_user {
          return Err(read_only(found));
        }
        let (speaker, style) = resolve_style(&speakers, &speaker, &style)?;
        let preset = presets::updated_preset(&request, speaker, style)?;
        let info = presets::preset_info(&speakers, &preset);
        if let Some(stored) = catalog.agent.iter_mut().find(|p| p.id == preset.id) {
          *stored = preset;
        }
        store
          .save(&catalog.agent, &ids)
          .map_err(|e| fail("io_error", e))?;
        Ok(Json(info))
      })
      .await
  }

  #[tool(description = "Delete a preset made with create_preset. Its ID is not reused.")]
  pub async fn delete_preset(
    &self,
    Parameters(request): Parameters<DeletePresetRequest>,
  ) -> Result<Json<DeletedPreset>, String> {
    let settings = self.enabled().await?;
    self
      .with_presets(&settings, move |store, mut catalog, ids| {
        let (found, is_user) = catalog.find(&request.id)?;
        if is_user {
          return Err(read_only(found));
        }
        let deleted = DeletedPreset {
          id: found.id.clone(),
          name: found.name.clone(),
        };
        catalog.agent.retain(|preset| preset.id != deleted.id);
        store
          .save(&catalog.agent, &ids)
          .map_err(|e| fail("io_error", e))?;
        Ok(Json(deleted))
      })
      .await
  }

  #[tool(
    description = "Read Japanese text aloud with the voice and delivery of a preset, which is \
    required: pass preset_id from list_presets or create_preset. Pass `text`, or `kana` to fix \
    the reading and accent yourself. Writes a WAV file to a temporary directory and returns its \
    path with the reading used, as kana. Text is read with the user's dictionary unless \
    apply_dictionary is false; English words are spelled out unless `english` is true. \
    Nothing set in the Azalea app changes the result except the user dictionary."
  )]
  pub async fn synthesize(
    &self,
    Parameters(request): Parameters<SynthesizeRequest>,
  ) -> Result<Json<SynthesizeResult>, String> {
    let (utterance, preset_id, reading) = checked_request(&request)?;
    let (settings, core) = self.ready().await?;
    if reading.english.is_some() && !settings.english_available {
      return Err(fail(
        "unsupported_feature",
        "The English reading models are not downloaded. Ask the user to download them in \
        Azalea's config dialog (\"Transform English words\"), or omit `english`.",
      ));
    }
    let speakers = Self::speakers(&core);
    let (preset, speaker_name, style_name, style_id) = self
      .with_presets(&settings, move |_, catalog, _| {
        let preset = catalog.find(&preset_id)?.0.clone();
        let (speaker, style) = presets::preset_voice(&speakers, &preset)?;
        Ok((preset, speaker.name.clone(), style.name.clone(), style.id))
      })
      .await?;
    let output_dir = self.environment.output_dir();
    let dictionary_path = self.environment.dictionary_path();
    let applied_dictionary = self.applied_dictionary.clone();
    let _permit = self
      .gate
      .acquire()
      .await
      .map_err(|e| fail("core_error", e))?;
    joined(
      tokio::task::spawn_blocking(move || {
        let id = StyleId(style_id);
        let mut query = match &utterance {
          Utterance::Text(text) => {
            sync_dictionary(
              &core,
              &dictionary_path,
              reading.apply_dictionary,
              &applied_dictionary,
            )?;
            core
              .audio_query_with_english(text, id, reading.english)
              .map_err(|e| fail("core_error", e))?
          }
          Utterance::Kana(kana) => {
            // Loaded first, so that a failure below is the kana's.
            if !core.is_speaker_loaded(id) {
              core.load_speaker(id).map_err(|e| fail("core_error", e))?;
            }
            core.audio_query_from_kana(kana, id).map_err(|e| {
              fail(
                "invalid_argument",
                format!(
                  "The kana could not be read ({e}). Write katakana with ' after each phrase's \
                  accented mora, / between phrases and 、 for a pause, as in a result's `kana`."
                ),
              )
            })?
          }
        };
        presets::apply_preset(&mut query, &preset)?;
        let wav = core
          .synthesis(&query, id)
          .map_err(|e| fail("core_error", e))?;
        let (sample_rate, duration_seconds) = wav_info(&wav)?;
        let path = write_wav(&output_dir, style_id, &wav)?;
        Ok(Json(SynthesizeResult {
          path: path.to_string_lossy().into_owned(),
          duration_seconds,
          sample_rate,
          preset_id: preset.id,
          credit: format!("VOICEVOX:{speaker_name}"),
          speaker: speaker_name,
          style: style_name,
          style_id,
          kana: query.kana.unwrap_or_default(),
        }))
      })
      .await,
    )
  }
}

fn read_only(preset: &StoredPreset) -> String {
  fail(
    "read_only_preset",
    format!(
      "Preset {} is the user's and cannot be changed. Copy it with create_preset \
      (copy_from: \"{}\") and change the copy.",
      preset.id, preset.id
    ),
  )
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for AzaleaMcp {
  fn get_info(&self) -> ServerConfig {
    ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
      .with_server_info(
        Implementation::new("azalea", env!("CARGO_PKG_VERSION")).with_title("Azalea"),
      )
      .with_instructions(
        "Azalea synthesizes Japanese speech with VOICEVOX. Every synthesis needs a preset, \
        which holds the voice and its speed, pitch, intonation, volume and silences. Call \
        list_presets and use one of the user's presets, or make your own: list_speakers to \
        choose a speaker and style, create_preset for a template and its ID, update_preset to \
        fill it in. Then call synthesize with preset_id and the text to get a WAV file path. \
        Preset IDs are two words such as quick-fox. A result's `kana` shows how the text was \
        read; to correct a reading or accent, edit that kana and pass it as `kana` instead of \
        `text`. Errors start with a code such as unknown_preset. Results depend only on the \
        arguments, the preset and the installation, which get_status describes; the Azalea \
        app's settings are not applied. The tools work only while the user has turned on the \
        \"MCP Server\" switch in Azalea's config dialog; if a tool reports `disabled`, ask the \
        user to turn it on rather than retrying. Generated audio must credit the VOICEVOX \
        character according to its terms of use, as in each result's `credit`.",
      )
  }
}

/// Serves MCP over stdin and stdout until the client disconnects.
pub fn run_stdio() {
  let result = tauri::async_runtime::block_on(async {
    let server = AzaleaMcp::new(AppEnvironment)
      .serve(rmcp::transport::stdio())
      .await?;
    server.waiting().await?;
    anyhow::Ok(())
  });
  if let Err(error) = result {
    // stdout belongs to the protocol.
    eprintln!("Azalea MCP server stopped: {error}");
    std::process::exit(1);
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::atomic::{AtomicUsize, Ordering};

  fn meta(name: &str, uuid: &str, order: Option<u32>, styles: serde_json::Value) -> CharacterMeta {
    serde_json::from_value(serde_json::json!({
      "name": name,
      "speaker_uuid": uuid,
      "version": "0.1.0",
      "order": order,
      "styles": styles,
    }))
    .unwrap()
  }

  fn sample_speakers() -> Vec<SpeakerInfo> {
    let first = meta(
      "ずんだもん",
      "zunda",
      Some(1),
      serde_json::json!([
        {"id": 3, "name": "ノーマル", "type": "talk", "order": 0},
        {"id": 3000, "name": "ハミング", "type": "frame_decode", "order": 1},
      ]),
    );
    let split = meta(
      "ずんだもん",
      "zunda",
      Some(1),
      serde_json::json!([{"id": 1, "name": "あまあま", "type": "talk", "order": 2}]),
    );
    let earlier = meta(
      "四国めたん",
      "metan",
      Some(0),
      serde_json::json!([{"id": 2, "name": "Normal", "order": 0}]),
    );
    let singer = meta(
      "Singer",
      "singer",
      None,
      serde_json::json!([{"id": 9, "name": "Sing", "type": "sing"}]),
    );
    speaker_list([&first, &split, &earlier, &singer])
  }

  #[test]
  fn speaker_list_merges_split_speakers_keeps_talk_styles_and_sorts_by_order() {
    assert_eq!(
      sample_speakers(),
      vec![
        SpeakerInfo {
          name: "四国めたん".into(),
          speaker_uuid: "metan".into(),
          styles: vec![StyleInfo {
            id: 2,
            name: "Normal".into()
          }],
        },
        SpeakerInfo {
          name: "ずんだもん".into(),
          speaker_uuid: "zunda".into(),
          styles: vec![
            StyleInfo {
              id: 3,
              name: "ノーマル".into()
            },
            StyleInfo {
              id: 1,
              name: "あまあま".into()
            },
          ],
        },
      ]
    );
  }

  #[test]
  fn resolve_style_accepts_names_uuids_ids_and_case_insensitive_names() {
    let speakers = sample_speakers();
    let (speaker, style) = resolve_style(&speakers, "ずんだもん", "あまあま").unwrap();
    assert_eq!((speaker.speaker_uuid.as_str(), style.id), ("zunda", 1));
    let (_, style) = resolve_style(&speakers, " zunda ", "3").unwrap();
    assert_eq!(style.name, "ノーマル");
    let (_, style) = resolve_style(&speakers, "四国めたん", "normal").unwrap();
    assert_eq!(style.id, 2);
  }

  #[test]
  fn resolve_style_lists_the_alternatives_when_nothing_matches() {
    let speakers = sample_speakers();
    let error = resolve_style(&speakers, "nobody", "ノーマル").unwrap_err();
    assert!(error.contains("四国めたん, ずんだもん"), "{error}");
    let error = resolve_style(&speakers, "ずんだもん", "ささやき").unwrap_err();
    assert!(error.contains("ノーマル, あまあま"), "{error}");
    // A style ID of another speaker does not match.
    assert!(resolve_style(&speakers, "ずんだもん", "2").is_err());
  }

  #[test]
  fn wav_info_reads_rate_and_duration_and_write_wav_creates_the_directory() {
    let mut wav = std::io::Cursor::new(Vec::new());
    let spec = hound::WavSpec {
      channels: 1,
      sample_rate: 24000,
      bits_per_sample: 16,
      sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::new(&mut wav, spec).unwrap();
    for _ in 0..12000 {
      writer.write_sample(0i16).unwrap();
    }
    writer.finalize().unwrap();
    let wav = wav.into_inner();
    assert_eq!(wav_info(&wav).unwrap(), (24000, 0.5));
    assert!(wav_info(b"not a wav").is_err());

    let dir = tempfile::tempdir().unwrap();
    let nested = dir.path().join("out");
    let path = write_wav(&nested, 3, &wav).unwrap();
    assert_eq!(path.parent().unwrap(), nested);
    assert_eq!(std::fs::read(path).unwrap(), wav);
  }

  struct FakeEnvironment {
    settings: Result<McpSettings, String>,
    core_loads: Arc<AtomicUsize>,
    dir: PathBuf,
  }

  impl McpEnvironment for FakeEnvironment {
    fn settings(&self) -> Result<McpSettings, String> {
      self.settings.clone()
    }

    fn load_core(&self) -> Result<Core, String> {
      self.core_loads.fetch_add(1, Ordering::SeqCst);
      Err("core_error: no core in unit tests".into())
    }

    fn output_dir(&self) -> PathBuf {
      self.dir.join("out")
    }

    fn presets_path(&self) -> PathBuf {
      self.dir.join(PRESETS_FILE)
    }

    fn ids_path(&self) -> PathBuf {
      self.dir.join(IDS_FILE)
    }

    fn dictionary_path(&self) -> PathBuf {
      self.dir.join("user_dictionary.json")
    }
  }

  struct Fixture {
    server: AzaleaMcp,
    core_loads: Arc<AtomicUsize>,
    dir: tempfile::TempDir,
  }

  fn fixture(settings: Result<McpSettings, String>) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let core_loads = Arc::new(AtomicUsize::new(0));
    let server = AzaleaMcp::new(FakeEnvironment {
      settings,
      core_loads: core_loads.clone(),
      dir: dir.path().to_owned(),
    });
    Fixture {
      server,
      core_loads,
      dir,
    }
  }

  fn enabled() -> McpSettings {
    McpSettings {
      enabled: true,
      user_presets: vec![Preset {
        id: "app-default".into(),
        name: "Default".into(),
        style_id: StyleId(2),
        speaker_uuid: Some("metan".into()),
        style_name: Some("Normal".into()),
        ..Preset::default()
      }],
      ..McpSettings::default()
    }
  }

  fn error<T>(result: Result<Json<T>, String>) -> String {
    match result {
      Ok(_) => panic!("the tool unexpectedly succeeded"),
      Err(error) => error,
    }
  }

  fn value<T>(result: Result<Json<T>, String>) -> T {
    match result {
      Ok(Json(value)) => value,
      Err(error) => panic!("the tool failed: {error}"),
    }
  }

  fn request(text: &str) -> SynthesizeRequest {
    SynthesizeRequest {
      text: Some(text.into()),
      preset_id: Some("quick-fox".into()),
      ..Default::default()
    }
  }

  #[test]
  fn checked_request_needs_one_utterance_and_a_preset() {
    let (utterance, preset_id, reading) = checked_request(&request(" こんにちは ")).unwrap();
    assert_eq!(utterance, Utterance::Text("こんにちは".into()));
    assert_eq!(preset_id, "quick-fox");
    assert_eq!(
      reading,
      Reading {
        apply_dictionary: true,
        english: None
      }
    );

    let kana = SynthesizeRequest {
      text: Some("  ".into()),
      kana: Some("コンニチワ'".into()),
      ..request("")
    };
    assert_eq!(
      checked_request(&kana).unwrap().0,
      Utterance::Kana("コンニチワ'".into())
    );

    let both = SynthesizeRequest {
      kana: Some("コンニチワ'".into()),
      ..request("こんにちは")
    };
    let cases = [
      (both, "invalid_argument: Pass either"),
      (request("  \n"), "invalid_argument: Pass the text"),
      (
        request(&"あ".repeat(MAX_TEXT_CHARS + 1)),
        "limit_exceeded: ",
      ),
      (
        SynthesizeRequest {
          preset_id: Some(" ".into()),
          ..request("こんにちは")
        },
        "missing_preset: ",
      ),
      (
        SynthesizeRequest {
          english_model: Some("large".into()),
          ..request("こんにちは")
        },
        "invalid_argument: english_model",
      ),
    ];
    for (request, expected) in cases {
      let error = checked_request(&request).unwrap_err();
      assert!(error.starts_with(expected), "{error}");
    }
    assert!(checked_request(&request(&"あ".repeat(MAX_TEXT_CHARS))).is_ok());
  }

  #[test]
  fn checked_request_reads_english_and_dictionary_options_from_the_call_alone() {
    let reading = |request: SynthesizeRequest| checked_request(&request).unwrap().2;
    // The English options are ignored until `english` asks for them.
    let unused = SynthesizeRequest {
      english_accent: Some(false),
      english_model: Some("turbo".into()),
      apply_dictionary: Some(false),
      ..request("Hello")
    };
    assert_eq!(
      reading(unused),
      Reading {
        apply_dictionary: false,
        english: None
      }
    );
    let defaults = SynthesizeRequest {
      english: Some(true),
      ..request("Hello")
    };
    assert_eq!(
      reading(defaults).english,
      Some(EnglishOptions {
        accent_prediction: true,
        ngram_filter: true,
        turbo: false
      })
    );
    let custom = SynthesizeRequest {
      english: Some(true),
      english_accent: Some(false),
      english_ngram_filter: Some(false),
      english_model: Some("turbo".into()),
      ..request("Hello")
    };
    assert_eq!(
      reading(custom).english,
      Some(EnglishOptions {
        accent_prediction: false,
        ngram_filter: false,
        turbo: true
      })
    );
  }

  #[test]
  fn requests_reject_unknown_arguments() {
    let synthesize = serde_json::from_value::<SynthesizeRequest>(
      serde_json::json!({"text": "あ", "speaker": "x"}),
    );
    assert!(synthesize.unwrap_err().to_string().contains("speaker"));
    let update = serde_json::from_value::<UpdatePresetRequest>(
      serde_json::json!({"id": "quick-fox", "intonaton": 1.0}),
    );
    assert!(update.unwrap_err().to_string().contains("intonaton"));
  }

  #[test]
  fn app_settings_mirror_the_ui_config() {
    let mut ui = UIConfig::default();
    ui.english_turbo_model = true;
    ui.english_ngram_filter = false;
    ui.pitch_noise_enabled = true;
    ui.pitch_noise_sigma = 0.3;
    ui.pitch_completion_enabled = true;
    let settings = AppSettings::from(&ui);
    assert_eq!(
      settings.english,
      AppEnglishSettings {
        enabled: ui.english_transform,
        accent_prediction: ui.english_accent_prediction,
        ngram_filter: false,
        model: "turbo".into()
      }
    );
    assert_eq!(
      settings.pitch_noise,
      AppPitchNoiseSettings {
        enabled: true,
        sigma: 0.3
      }
    );
    assert!(settings.pitch_completion.enabled);
    assert_eq!(
      AppSettings::from(&UIConfig::default()).english.model,
      "base"
    );
  }

  #[test]
  fn wanted_dictionary_follows_the_file_and_the_call() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("user_dictionary.json");
    assert_eq!(wanted_dictionary(&path, true).unwrap(), None);
    std::fs::write(&path, "{}").unwrap();
    let first = wanted_dictionary(&path, true).unwrap().unwrap();
    assert_eq!(first, dictionary_revision(b"{}"));
    assert_eq!(first.len(), 8);
    assert_eq!(wanted_dictionary(&path, false).unwrap(), None);
    std::fs::write(&path, "{ }").unwrap();
    assert_ne!(wanted_dictionary(&path, true).unwrap().unwrap(), first);
  }

  #[tokio::test]
  async fn synthesize_rejects_bad_arguments_before_reading_settings() {
    let Fixture {
      server, core_loads, ..
    } = fixture(Err("unused".into()));
    let missing = SynthesizeRequest {
      preset_id: None,
      ..request("こんにちは")
    };
    let missing = error(server.synthesize(Parameters(missing)).await);
    assert!(missing.starts_with("missing_preset: "), "{missing}");
    let empty = error(server.synthesize(Parameters(request("  \n"))).await);
    assert!(empty.starts_with("invalid_argument: "), "{empty}");
    assert_eq!(core_loads.load(Ordering::SeqCst), 0);
  }

  #[tokio::test]
  async fn disabled_server_refuses_tools_without_loading_the_core() {
    let Fixture {
      server, core_loads, ..
    } = fixture(Ok(McpSettings::default()));
    assert!(DISABLED_MESSAGE.starts_with("disabled: "));
    assert_eq!(error(server.list_speakers().await), DISABLED_MESSAGE);
    assert_eq!(error(server.list_presets().await), DISABLED_MESSAGE);
    let create = Parameters(CreatePresetRequest::default());
    assert_eq!(error(server.create_preset(create).await), DISABLED_MESSAGE);
    let update = Parameters(UpdatePresetRequest {
      id: "quick-fox".into(),
      ..Default::default()
    });
    assert_eq!(error(server.update_preset(update).await), DISABLED_MESSAGE);
    let delete = Parameters(DeletePresetRequest {
      id: "quick-fox".into(),
    });
    assert_eq!(error(server.delete_preset(delete).await), DISABLED_MESSAGE);
    assert_eq!(
      error(server.synthesize(Parameters(request("こんにちは"))).await),
      DISABLED_MESSAGE
    );
    assert_eq!(core_loads.load(Ordering::SeqCst), 0);
  }

  #[tokio::test]
  async fn tools_report_config_and_core_errors_and_retry_failed_core_loads() {
    let failing = fixture(Err("io_error: bad config".into()));
    assert_eq!(
      error(failing.server.list_speakers().await),
      "io_error: bad config"
    );
    assert_eq!(
      error(failing.server.get_status().await),
      "io_error: bad config"
    );

    let Fixture {
      server, core_loads, ..
    } = fixture(Ok(enabled()));
    assert_eq!(
      error(server.list_speakers().await),
      "core_error: no core in unit tests"
    );
    assert!(server.list_speakers().await.is_err());
    assert_eq!(core_loads.load(Ordering::SeqCst), 2);
  }

  #[tokio::test]
  async fn get_status_answers_while_disabled_without_loading_the_core() {
    let mut settings = McpSettings {
      english_available: true,
      ..McpSettings::default()
    };
    settings.app_settings.pitch_noise.enabled = true;
    let Fixture {
      server,
      core_loads,
      dir,
    } = fixture(Ok(settings.clone()));
    let status = value(server.get_status().await);
    assert!(!status.enabled);
    assert_eq!(status.app_version, env!("CARGO_PKG_VERSION"));
    assert_eq!(status.core, CoreStatus { loaded: false });
    assert!(status.english.available);
    assert_eq!(status.pitch_control.available, None);
    assert_eq!(
      status.dictionary,
      DictionaryStatus {
        entries: 0,
        revision: dictionary_revision(b"")
      }
    );
    assert_eq!(status.app_settings, settings.app_settings);
    assert_eq!(status.limits.max_text_chars, MAX_TEXT_CHARS);
    assert_eq!(Path::new(&status.temp_dir), dir.path().join("out"));
    assert_eq!(core_loads.load(Ordering::SeqCst), 0);

    // The dictionary the app saved is counted and identified.
    let dictionary = UserDict::new();
    let word = voicevox_core::UserDictWord::builder()
      .build("Azalea", "アザレア".into(), 1)
      .unwrap();
    dictionary.add_word(word).unwrap();
    let path = dir.path().join("user_dictionary.json");
    dictionary.save(&path).unwrap();
    let status = value(server.get_status().await);
    assert_eq!(status.dictionary.entries, 1);
    assert_eq!(
      status.dictionary.revision,
      dictionary_revision(&std::fs::read(&path).unwrap())
    );
  }

  #[tokio::test]
  async fn presets_are_created_as_templates_filled_in_listed_and_deleted() {
    let Fixture { server, dir, .. } = fixture(Ok(enabled()));
    let settings = enabled();
    let speakers = sample_speakers;

    let template = value(
      server
        .create_preset_with(&settings, speakers(), CreatePresetRequest::default())
        .await,
    );
    assert!(ids::is_word_pair(&template.id));
    assert!(!template.complete && !template.available);
    assert_eq!((template.speaker.as_deref(), template.speed), (None, 100));

    // A template cannot be used until it has a voice.
    let partial = UpdatePresetRequest {
      id: template.id.clone(),
      speaker: Some("ずんだもん".into()),
      ..Default::default()
    };
    let error_text = error(
      server
        .update_preset_with(&settings, speakers(), partial)
        .await,
    );
    assert!(error_text.starts_with("invalid_argument: "), "{error_text}");

    // The listed preset is passed back whole, read-only fields included.
    let filled = UpdatePresetRequest {
      id: format!(" {} ", template.id.to_uppercase()),
      name: Some("Narration".into()),
      speaker: Some("ずんだもん".into()),
      style: Some("あまあま".into()),
      speed: Some(150),
      complete: Some(false),
      available: Some(false),
      ..Default::default()
    };
    let updated = value(
      server
        .update_preset_with(&settings, speakers(), filled)
        .await,
    );
    assert_eq!(updated.id, template.id);
    assert!(updated.complete && updated.available);
    assert_eq!(
      (
        updated.name.as_str(),
        updated.style.as_deref(),
        updated.style_id,
        updated.speed
      ),
      ("Narration", Some("あまあま"), Some(1), 150)
    );

    // An update replaces every value: the omitted speed is the default again.
    let renamed = UpdatePresetRequest {
      id: template.id.clone(),
      speaker: Some("zunda".into()),
      style: Some("3".into()),
      ..Default::default()
    };
    let replaced = value(
      server
        .update_preset_with(&settings, speakers(), renamed)
        .await,
    );
    assert_eq!(
      (replaced.name.as_str(), replaced.style_id, replaced.speed),
      ("", Some(3), 100)
    );

    let unknown_voice = UpdatePresetRequest {
      id: template.id.clone(),
      speaker: Some("nobody".into()),
      style: Some("ノーマル".into()),
      ..Default::default()
    };
    let error_text = error(
      server
        .update_preset_with(&settings, speakers(), unknown_voice)
        .await,
    );
    assert!(error_text.starts_with("unknown_speaker: "), "{error_text}");

    let listed = value(server.list_presets_with(&settings, speakers()).await);
    assert_eq!(listed.agent, vec![replaced.clone()]);
    assert_eq!(listed.user.len(), 1);
    let user = &listed.user[0];
    assert!(ids::is_word_pair(&user.id) && user.id != template.id);
    assert_eq!(
      (user.name.as_str(), user.speaker.as_deref(), user.available),
      ("Default", Some("四国めたん"), true)
    );

    // The user's presets are read-only, but can be copied.
    let read_only = UpdatePresetRequest {
      id: user.id.clone(),
      speaker: Some("ずんだもん".into()),
      style: Some("ノーマル".into()),
      ..Default::default()
    };
    let error_text = error(
      server
        .update_preset_with(&settings, speakers(), read_only)
        .await,
    );
    assert!(error_text.starts_with("read_only_preset: "), "{error_text}");
    let delete_user = Parameters(DeletePresetRequest {
      id: user.id.clone(),
    });
    let error_text = error(server.delete_preset(delete_user).await);
    assert!(error_text.starts_with("read_only_preset: "), "{error_text}");
    let copy = value(
      server
        .create_preset_with(
          &settings,
          speakers(),
          CreatePresetRequest {
            copy_from: Some(user.id.clone()),
          },
        )
        .await,
    );
    assert!(copy.id != user.id && copy.id != template.id);
    assert_eq!(
      (copy.name.as_str(), copy.speaker.as_deref(), copy.complete),
      ("Default", Some("四国めたん"), true)
    );
    let missing_source = CreatePresetRequest {
      copy_from: Some("lazy-lantern".into()),
    };
    let error_text = error(
      server
        .create_preset_with(&settings, speakers(), missing_source)
        .await,
    );
    assert!(error_text.starts_with("unknown_preset: "), "{error_text}");

    // Presets outlive the server, and a deleted ID is not issued again.
    let deleted = value(
      server
        .delete_preset(Parameters(DeletePresetRequest {
          id: template.id.clone(),
        }))
        .await,
    );
    assert_eq!(deleted.id, template.id);
    let again = Parameters(DeletePresetRequest {
      id: template.id.clone(),
    });
    let error_text = error(server.delete_preset(again).await);
    assert!(error_text.starts_with("unknown_preset: "), "{error_text}");

    let restarted = AzaleaMcp::new(FakeEnvironment {
      settings: Ok(enabled()),
      core_loads: Arc::new(AtomicUsize::new(0)),
      dir: dir.path().to_owned(),
    });
    let listed = value(restarted.list_presets_with(&settings, speakers()).await);
    assert_eq!(listed.agent, vec![copy.clone()]);
    assert_eq!(listed.user[0].id, user.id);
    for _ in 0..8 {
      let fresh = value(
        restarted
          .create_preset_with(&settings, speakers(), CreatePresetRequest::default())
          .await,
      );
      assert!(fresh.id != template.id && fresh.id != copy.id && fresh.id != user.id);
    }
  }

  #[tokio::test]
  async fn concurrent_preset_creations_all_persist_with_distinct_ids() {
    let Fixture { server, .. } = fixture(Ok(enabled()));
    let settings = enabled();
    let tasks: Vec<_> = (0..8)
      .map(|_| {
        let (server, settings) = (server.clone(), settings.clone());
        tokio::spawn(async move {
          value(
            server
              .create_preset_with(&settings, sample_speakers(), CreatePresetRequest::default())
              .await,
          )
          .id
        })
      })
      .collect();
    let mut ids = Vec::new();
    for task in tasks {
      ids.push(task.await.unwrap());
    }
    let listed = value(server.list_presets_with(&settings, sample_speakers()).await);
    let mut stored: Vec<String> = listed.agent.into_iter().map(|preset| preset.id).collect();
    ids.sort();
    stored.sort();
    assert_eq!(ids, stored);
    ids.dedup();
    assert_eq!(ids.len(), 8);
  }

  #[tokio::test]
  async fn stdio_protocol_lists_the_tools_and_returns_tool_errors() {
    use rmcp::model::CallToolRequestParams;

    let Fixture { server, .. } = fixture(Ok(McpSettings::default()));
    let (server_io, client_io) = tokio::io::duplex(64 * 1024);
    let handle = tokio::spawn(async move {
      let running = server.serve(server_io).await.unwrap();
      running.waiting().await.unwrap();
    });
    let client = ().serve(client_io).await.unwrap();

    let info = client.peer_info().unwrap();
    assert_eq!(info.server_info.as_ref().unwrap().name, "azalea");
    let mut names: Vec<String> = client
      .list_all_tools()
      .await
      .unwrap()
      .into_iter()
      .map(|tool| tool.name.into_owned())
      .collect();
    names.sort();
    assert_eq!(
      names,
      [
        "create_preset",
        "delete_preset",
        "get_status",
        "list_presets",
        "list_speakers",
        "synthesize",
        "update_preset"
      ]
    );

    let result = client
      .call_tool(CallToolRequestParams::new("list_speakers"))
      .await
      .unwrap();
    assert_eq!(result.is_error, Some(true));
    let text = serde_json::to_string(&result.content).unwrap();
    assert!(text.contains("MCP server is disabled"), "{text}");

    // The status tool answers even while the server is disabled.
    let status = client
      .call_tool(CallToolRequestParams::new("get_status"))
      .await
      .unwrap();
    assert_ne!(status.is_error, Some(true));
    let status = status.structured_content.unwrap();
    assert_eq!(status["enabled"], false);
    assert_eq!(status["limits"]["max_text_chars"], MAX_TEXT_CHARS);

    client.cancel().await.unwrap();
    handle.await.unwrap();
  }
}
