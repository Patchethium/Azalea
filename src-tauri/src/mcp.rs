//! A stdio MCP server, started by launching the app with `--mcp`, that lets LLM
//! clients list the installed voices, keep presets and synthesize speech.
//!
//! It loads its own core from the app's config, so it works without the app
//! running, and answers only while `UIConfig.mcp_enabled` is on. The setting is
//! read on every call, so toggling it in the config dialog takes effect without
//! restarting the client.
use std::{
  collections::HashMap,
  path::{Path, PathBuf},
  sync::Arc,
};

use rmcp::{
  handler::server::{router::tool::ToolRouter, wrapper::Parameters},
  model::{Implementation, ServerCapabilities, ServerConfig},
  schemars, tool, tool_handler, tool_router, Json, ServerHandler, ServiceExt,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{OnceCell, Semaphore};
use voicevox_core::{CharacterMeta, StyleId};

mod presets;

pub use presets::{CreatePresetRequest, PresetInfo, PresetList, PRESETS_FILE};

use crate::{
  commands::{apply_saved_dictionary, resolve_setup},
  config::{
    manager::{config_dir, user_dictionary_path},
    ConfigManager,
  },
  core::{is_talk_style, Core},
  english::EnglishOptions,
};

/// The command-line flag that starts the server instead of the app.
pub const MCP_FLAG: &str = "--mcp";

macro_rules! disabled_message {
  () => {
    "Azalea's MCP server is disabled, and only the user can enable it. Ask the user to turn on \
    the experimental \"MCP Server\" switch in Azalea's config dialog (Synthesis section), then \
    retry; no restart is needed."
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

/// What the server reads from the app on each call.
#[derive(Clone, Copy, Debug, Default)]
pub struct McpSettings {
  pub enabled: bool,
  pub english: Option<EnglishOptions>,
}

/// Where the server gets its settings, core, presets and output directory,
/// replaceable in tests.
pub trait McpEnvironment: Send + Sync + 'static {
  fn settings(&self) -> Result<McpSettings, String>;
  /// Builds the core; called at most once, on the first call that needs it.
  fn load_core(&self) -> Result<Core, String>;
  fn output_dir(&self) -> PathBuf;
  /// The file holding the server's own presets.
  fn presets_path(&self) -> PathBuf;
}

/// Reads the app's config, user dictionary and downloaded English models.
struct AppEnvironment;

impl McpEnvironment for AppEnvironment {
  fn settings(&self) -> Result<McpSettings, String> {
    let config = ConfigManager::new().map_err(|e| e.to_string())?.config;
    Ok(McpSettings {
      enabled: config.ui.mcp_enabled,
      english: config
        .ui
        .english_options()
        .filter(|_| crate::english::models_available()),
    })
  }

  fn load_core(&self) -> Result<Core, String> {
    let config = ConfigManager::new().map_err(|e| e.to_string())?.config;
    let core_config = resolve_setup(&config)?
      .ok_or("No voice setup is configured. Open Azalea and set one up first.")?;
    let core = Core::init(&core_config).map_err(|e| e.to_string())?;
    apply_saved_dictionary(&core, &user_dictionary_path())?;
    Ok(core)
  }

  fn output_dir(&self) -> PathBuf {
    std::env::temp_dir().join("azalea-mcp")
  }

  fn presets_path(&self) -> PathBuf {
    config_dir().join(PRESETS_FILE)
  }
}

#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct StyleInfo {
  /// Numeric style ID, also accepted by `synthesize` as the style.
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

#[derive(Debug, Default, Deserialize, schemars::JsonSchema)]
pub struct SynthesizeRequest {
  /// The Japanese text to read aloud.
  pub text: String,
  /// Speaker name or UUID, as listed by `list_speakers`. Required without a
  /// preset; must be omitted with one.
  pub speaker: Option<String>,
  /// Style name (such as ノーマル) or numeric style ID, as listed by
  /// `list_speakers`. Required without a preset; must be omitted with one.
  pub style: Option<String>,
  /// Name or ID of a preset from `list_presets`. Its voice, speed, pitch,
  /// intonation, volume and silences are used.
  pub preset: Option<String>,
}

/// What a synthesis request asks for once its arguments are checked.
#[derive(Debug, PartialEq)]
enum Voice {
  Explicit { speaker: String, style: String },
  Preset(String),
}

/// Checks that a request names either a speaker and style or a preset, treating
/// blank strings as omitted.
fn requested_voice(request: &SynthesizeRequest) -> Result<Voice, String> {
  let given = |value: &Option<String>| {
    value
      .as_deref()
      .map(str::trim)
      .filter(|value| !value.is_empty())
      .map(str::to_owned)
  };
  match (
    given(&request.speaker),
    given(&request.style),
    given(&request.preset),
  ) {
    (None, None, Some(preset)) => Ok(Voice::Preset(preset)),
    (_, _, Some(_)) => {
      Err("A preset supplies its own voice; omit speaker and style when passing preset.".into())
    }
    (Some(speaker), Some(style), None) => Ok(Voice::Explicit { speaker, style }),
    _ => Err("Pass both speaker and style, or a preset.".into()),
  }
}

#[derive(Debug, Clone, Serialize, schemars::JsonSchema)]
pub struct SynthesizeResult {
  /// Absolute path of the written WAV file.
  pub path: String,
  pub duration_seconds: f64,
  pub sample_rate: u32,
  pub speaker: String,
  pub style: String,
  pub style_id: u32,
  /// The preset's name, when one was used.
  pub preset: Option<String>,
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
      format!(
        "Unknown speaker \"{speaker}\". Available speakers: {}",
        names.join(", ")
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
      format!(
        "Unknown style \"{style}\" for {}. Available styles: {}",
        found.name,
        names.join(", ")
      )
    })?;
  Ok((found, found_style))
}

/// Sample rate and audio seconds of a 16-bit PCM WAV, from its header.
fn wav_info(wav: &[u8]) -> Result<(u32, f64), String> {
  let reader = hound::WavReader::new(wav).map_err(|e| e.to_string())?;
  let spec = reader.spec();
  let seconds = reader.duration() as f64 / spec.sample_rate as f64;
  Ok((spec.sample_rate, seconds))
}

fn write_wav(dir: &Path, style_id: u32, wav: &[u8]) -> Result<PathBuf, String> {
  std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
  let path = dir.join(format!("azalea-{style_id}-{}.wav", uuid::Uuid::new_v4()));
  std::fs::write(&path, wav).map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
  Ok(path)
}

#[derive(Clone)]
pub struct AzaleaMcp {
  environment: Arc<dyn McpEnvironment>,
  core: Arc<OnceCell<Arc<Core>>>,
  /// Serializes synthesis, like the app's core task gate.
  gate: Arc<Semaphore>,
  tool_router: ToolRouter<Self>,
}

#[tool_router]
impl AzaleaMcp {
  pub fn new(environment: impl McpEnvironment) -> Self {
    Self {
      environment: Arc::new(environment),
      core: Arc::new(OnceCell::new()),
      gate: Arc::new(Semaphore::new(1)),
      tool_router: Self::tool_router(),
    }
  }

  /// Checks the setting and loads the core on first use.
  async fn ready(&self) -> Result<(McpSettings, Arc<Core>), String> {
    let environment = self.environment.clone();
    let settings = tokio::task::spawn_blocking(move || environment.settings())
      .await
      .map_err(|e| e.to_string())??;
    if !settings.enabled {
      return Err(DISABLED_MESSAGE.into());
    }
    let core = self
      .core
      .get_or_try_init(|| async {
        let environment = self.environment.clone();
        tokio::task::spawn_blocking(move || environment.load_core().map(Arc::new))
          .await
          .map_err(|e| e.to_string())?
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

  #[tool(
    description = "List the installed VOICEVOX speakers and their talk styles. Use a speaker's \
    name or UUID and a style's name or ID with `synthesize`."
  )]
  pub async fn list_speakers(&self) -> Result<Json<SpeakerList>, String> {
    let (_, core) = self.ready().await?;
    Ok(Json(SpeakerList {
      speakers: Self::speakers(&core),
    }))
  }

  /// Reads the stored presets off the async runtime.
  async fn load_presets(&self) -> Result<Vec<crate::config::types::Preset>, String> {
    let path = self.environment.presets_path();
    tokio::task::spawn_blocking(move || presets::load_presets(&path))
      .await
      .map_err(|e| e.to_string())?
  }

  #[tool(
    description = "List the presets saved with create_preset: each one's voice, speed, pitch, \
    intonation, volume and silences. Pass a preset's name or ID to `synthesize`."
  )]
  pub async fn list_presets(&self) -> Result<Json<PresetList>, String> {
    let (_, core) = self.ready().await?;
    let speakers = Self::speakers(&core);
    let stored = self.load_presets().await?;
    Ok(Json(PresetList {
      presets: stored
        .iter()
        .map(|preset| presets::preset_info(&speakers, preset))
        .collect(),
    }))
  }

  #[tool(
    description = "Save a named preset: a speaker and style plus speed, pitch, intonation, \
    volume and silences (omitted values use VOICEVOX's defaults). Presets are kept by this \
    server, separate from the Azalea app's presets."
  )]
  pub async fn create_preset(
    &self,
    Parameters(request): Parameters<CreatePresetRequest>,
  ) -> Result<Json<PresetInfo>, String> {
    let (_, core) = self.ready().await?;
    let speakers = Self::speakers(&core);
    let (speaker, style) = resolve_style(&speakers, &request.speaker, &request.style)?;
    // Holding the gate keeps concurrent creations from losing each other's presets.
    let _permit = self.gate.acquire().await.map_err(|e| e.to_string())?;
    let mut stored = self.load_presets().await?;
    let preset = presets::new_preset(&request, speaker, style, &stored)?;
    let info = presets::preset_info(&speakers, &preset);
    stored.push(preset);
    let path = self.environment.presets_path();
    tokio::task::spawn_blocking(move || presets::save_presets(&path, &stored))
      .await
      .map_err(|e| e.to_string())??;
    Ok(Json(info))
  }

  #[tool(
    description = "Read Japanese text aloud with a VOICEVOX speaker and style, or with a preset \
    from list_presets (then omit speaker and style). Writes a WAV file to a temporary directory \
    and returns its path. Uses Azalea's user dictionary and English word settings."
  )]
  pub async fn synthesize(
    &self,
    Parameters(request): Parameters<SynthesizeRequest>,
  ) -> Result<Json<SynthesizeResult>, String> {
    if request.text.trim().is_empty() {
      return Err("The text is empty.".into());
    }
    let voice = requested_voice(&request)?;
    let (settings, core) = self.ready().await?;
    let speakers = Self::speakers(&core);
    let (preset, (speaker, style)) = match &voice {
      Voice::Explicit { speaker, style } => (None, resolve_style(&speakers, speaker, style)?),
      Voice::Preset(key) => {
        let stored = self.load_presets().await?;
        let preset = presets::find_preset(&stored, key)?.clone();
        let voice = presets::preset_voice(&speakers, &preset)?;
        (Some(preset), voice)
      }
    };
    let (speaker_name, style_name, style_id) = (speaker.name.clone(), style.name.clone(), style.id);
    let output_dir = self.environment.output_dir();
    let _permit = self.gate.acquire().await.map_err(|e| e.to_string())?;
    let text = request.text;
    tokio::task::spawn_blocking(move || {
      let id = StyleId(style_id);
      let mut query = core
        .audio_query_with_english(&text, id, settings.english)
        .map_err(|e| e.to_string())?;
      if let Some(preset) = &preset {
        presets::apply_preset(&mut query, preset)?;
      }
      let wav = core.synthesis(&query, id).map_err(|e| e.to_string())?;
      let (sample_rate, duration_seconds) = wav_info(&wav)?;
      let path = write_wav(&output_dir, style_id, &wav)?;
      Ok(Json(SynthesizeResult {
        path: path.to_string_lossy().into_owned(),
        duration_seconds,
        sample_rate,
        speaker: speaker_name,
        style: style_name,
        style_id,
        preset: preset.map(|preset| preset.name),
      }))
    })
    .await
    .map_err(|e| e.to_string())?
  }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for AzaleaMcp {
  fn get_info(&self) -> ServerConfig {
    ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
      .with_server_info(
        Implementation::new("azalea", env!("CARGO_PKG_VERSION")).with_title("Azalea"),
      )
      .with_instructions(
        "Azalea synthesizes Japanese speech with VOICEVOX. Call list_speakers to find a speaker \
        and style, then synthesize to get a WAV file path. To reuse a voice with adjusted speed, \
        pitch, intonation, volume or silences, save it with create_preset and pass the preset \
        to synthesize. The tools work only while the user has turned on the \"MCP Server\" \
        switch in Azalea's config dialog; if a tool reports that the server is disabled, ask \
        the user to turn it on rather than retrying. Generated audio must credit the \
        VOICEVOX character according to its terms of use (for example \"VOICEVOX:ずんだもん\").",
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
  }

  impl McpEnvironment for FakeEnvironment {
    fn settings(&self) -> Result<McpSettings, String> {
      self.settings.clone()
    }

    fn load_core(&self) -> Result<Core, String> {
      self.core_loads.fetch_add(1, Ordering::SeqCst);
      Err("no core in unit tests".into())
    }

    fn output_dir(&self) -> PathBuf {
      std::env::temp_dir()
    }

    fn presets_path(&self) -> PathBuf {
      std::env::temp_dir().join("azalea-mcp-unit-test-presets.toml")
    }
  }

  fn server(settings: Result<McpSettings, String>) -> (AzaleaMcp, Arc<AtomicUsize>) {
    let core_loads = Arc::new(AtomicUsize::new(0));
    let server = AzaleaMcp::new(FakeEnvironment {
      settings,
      core_loads: core_loads.clone(),
    });
    (server, core_loads)
  }

  fn error<T>(result: Result<Json<T>, String>) -> String {
    match result {
      Ok(_) => panic!("the tool unexpectedly succeeded"),
      Err(error) => error,
    }
  }

  fn request(text: &str) -> Parameters<SynthesizeRequest> {
    Parameters(SynthesizeRequest {
      text: text.into(),
      speaker: Some("ずんだもん".into()),
      style: Some("ノーマル".into()),
      preset: None,
    })
  }

  #[test]
  fn requested_voice_needs_a_speaker_and_style_or_a_preset_alone() {
    let voice = |speaker: Option<&str>, style: Option<&str>, preset: Option<&str>| {
      requested_voice(&SynthesizeRequest {
        text: "テスト".into(),
        speaker: speaker.map(Into::into),
        style: style.map(Into::into),
        preset: preset.map(Into::into),
      })
    };
    assert_eq!(
      voice(Some("ずんだもん"), Some("ノーマル"), None),
      Ok(Voice::Explicit {
        speaker: "ずんだもん".into(),
        style: "ノーマル".into()
      })
    );
    assert_eq!(
      voice(Some(" "), None, Some(" Narration ")),
      Ok(Voice::Preset("Narration".into()))
    );
    let error = voice(Some("ずんだもん"), None, Some("Narration")).unwrap_err();
    assert!(error.contains("omit speaker and style"), "{error}");
    assert!(voice(None, Some("ノーマル"), Some("Narration")).is_err());
    for (speaker, style) in [
      (Some("ずんだもん"), None),
      (None, Some("ノーマル")),
      (None, None),
    ] {
      let error = voice(speaker, style, Some("")).unwrap_err();
      assert!(error.contains("both speaker and style"), "{error}");
    }
  }

  #[tokio::test]
  async fn synthesize_rejects_bad_voice_arguments_before_reading_settings() {
    let (server, core_loads) = server(Err("unused".into()));
    let mut both = request("こんにちは");
    both.0.preset = Some("Narration".into());
    assert!(error(server.synthesize(both).await).contains("omit speaker and style"));
    assert_eq!(core_loads.load(Ordering::SeqCst), 0);
  }

  #[tokio::test]
  async fn disabled_server_refuses_tools_without_loading_the_core() {
    let (server, core_loads) = server(Ok(McpSettings::default()));
    assert_eq!(error(server.list_speakers().await), DISABLED_MESSAGE);
    assert_eq!(error(server.list_presets().await), DISABLED_MESSAGE);
    let create = Parameters(CreatePresetRequest {
      name: "Narration".into(),
      speaker: "ずんだもん".into(),
      style: "ノーマル".into(),
      speed: None,
      pitch: None,
      intonation: None,
      volume: None,
      start_silence_ms: None,
      end_silence_ms: None,
    });
    assert_eq!(error(server.create_preset(create).await), DISABLED_MESSAGE);
    assert_eq!(
      error(server.synthesize(request("こんにちは")).await),
      DISABLED_MESSAGE
    );
    assert_eq!(core_loads.load(Ordering::SeqCst), 0);
  }

  #[tokio::test]
  async fn tools_report_config_and_core_errors_and_retry_failed_core_loads() {
    let (failing, _) = server(Err("bad config".into()));
    assert_eq!(error(failing.list_speakers().await), "bad config");

    let (server, core_loads) = server(Ok(McpSettings {
      enabled: true,
      english: None,
    }));
    assert_eq!(error(server.list_speakers().await), "no core in unit tests");
    assert!(server.list_speakers().await.is_err());
    assert_eq!(core_loads.load(Ordering::SeqCst), 2);
  }

  #[tokio::test]
  async fn synthesize_rejects_empty_text_before_reading_settings() {
    let (server, core_loads) = server(Err("unused".into()));
    assert_eq!(
      error(server.synthesize(request("  \n")).await),
      "The text is empty."
    );
    assert_eq!(core_loads.load(Ordering::SeqCst), 0);
  }

  #[tokio::test]
  async fn stdio_protocol_lists_both_tools_and_returns_tool_errors() {
    use rmcp::model::CallToolRequestParams;

    let (server, _) = server(Ok(McpSettings::default()));
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
        "list_presets",
        "list_speakers",
        "synthesize"
      ]
    );

    let result = client
      .call_tool(CallToolRequestParams::new("list_speakers"))
      .await
      .unwrap();
    assert_eq!(result.is_error, Some(true));
    let text = serde_json::to_string(&result.content).unwrap();
    assert!(text.contains("MCP server is disabled"), "{text}");

    client.cancel().await.unwrap();
    handle.await.unwrap();
  }
}
