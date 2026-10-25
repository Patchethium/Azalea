//! Fixed-release CPU setup downloader. No arbitrary URLs or destination paths cross IPC.
use crate::async_job::{run_cancellable, JobCancellation};
use crate::config::manager::downloaded_components_dir;
use crate::config::types::{AzaleaConfig, SetupSource};
use crate::config::CoreConfig;
use crate::AppState;
use flate2::read::GzDecoder;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri_specta::Event;
use voicevox_core::blocking::VoiceModelFile;

#[derive(Clone, Deserialize)]
struct Catalog {
  archives: Vec<Archive>,
  models: Vec<Package>,
}

#[derive(Clone, Deserialize)]
struct Archive {
  id: String,
  url: String,
  bytes: u64,
  sha256: String,
  library: Option<String>,
  expanded_limit: u64,
}

#[derive(Clone, Deserialize)]
struct Package {
  id: String,
  url: String,
  bytes: u64,
  sha256: String,
  entries: Vec<PackageVoice>,
}

#[derive(Clone, Deserialize, Serialize, Type)]
pub struct PackageVoice {
  pub character: String,
  pub style: String,
  pub style_id: u32,
}

#[derive(Clone, Serialize, Type)]
pub struct DownloadComponent {
  pub id: String,
  pub bytes: u64,
  pub installed: bool,
  pub entries: Vec<PackageVoice>,
}

#[derive(Serialize, Type)]
pub struct DownloadSetup {
  pub directory: String,
  pub components: Vec<DownloadComponent>,
  pub core_config: Option<CoreConfig>,
  /// Model files loaded by the running core, or `None` when it is not using
  /// the downloaded setup.
  pub loaded_models: Option<Vec<String>>,
}

#[derive(Clone, Serialize, Deserialize, Type, Event)]
pub struct DownloadProgressEvent {
  pub operation_id: String,
  pub component_id: String,
  pub completed_bytes: u64,
  pub total_bytes: u64,
  pub extracting: bool,
}

#[derive(Serialize, Type)]
pub struct DownloadOutcome {
  pub cancelled: bool,
  pub icon_errors: Vec<String>,
}

static CATALOG: LazyLock<Catalog> = LazyLock::new(|| {
  serde_json::from_str(include_str!("../assets/download_catalog.json"))
    .expect("valid download catalog")
});
// ponytail: one download operation per process; a queue only if parallel setup downloads are needed.
static OPERATION: Mutex<Option<(String, Arc<JobCancellation>)>> = Mutex::new(None);

struct Operation;
impl Drop for Operation {
  fn drop(&mut self) {
    *OPERATION.lock().unwrap() = None;
  }
}

fn runtime_id(os: &str, arch: &str) -> Result<&'static str, String> {
  match (os, arch) {
    ("linux", "x86_64") => Ok("runtime-linux-x64"),
    ("linux", "aarch64") => Ok("runtime-linux-arm64"),
    ("macos", "aarch64") => Ok("runtime-osx-arm64"),
    ("macos", "x86_64") => Ok("runtime-osx-x86_64"),
    ("windows", "x86_64") => Ok("runtime-win-x64"),
    _ => Err(format!("CPU downloads are unavailable for {os}/{arch}")),
  }
}

fn runtime_archive() -> Result<&'static Archive, String> {
  let id = runtime_id(std::env::consts::OS, std::env::consts::ARCH)?;
  CATALOG
    .archives
    .iter()
    .find(|a| a.id == id)
    .ok_or_else(|| "Runtime is missing from the catalog".into())
}

fn model_directory(root: &Path) -> PathBuf {
  root.join("models/0.16.4")
}

fn archive_directory(root: &Path, archive: &Archive) -> PathBuf {
  if archive.id == "dictionary" {
    root.join("dictionary/1.11")
  } else {
    root.join("runtime/1.17.3").join(&archive.id)
  }
}

fn safe_relative(path: &Path) -> bool {
  !path.as_os_str().is_empty()
    && path
      .components()
      .all(|part| matches!(part, Component::Normal(_) | Component::CurDir))
    && !path.to_string_lossy().contains(['\\', ':'])
}

fn regular_file(path: &Path) -> bool {
  fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_file())
}

fn digest_file(path: &Path) -> Result<(u64, String), String> {
  if !regular_file(path) {
    return Err("Expected a regular file".into());
  }
  let mut file = File::open(path).map_err(|e| e.to_string())?;
  let mut hash = Sha256::new();
  let mut length = 0;
  let mut buffer = [0; 65536];
  loop {
    let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
    if count == 0 {
      break;
    }
    hash.update(&buffer[..count]);
    length += count as u64;
  }
  Ok((length, format!("{:x}", hash.finalize())))
}

fn verified_file(path: &Path, bytes: u64, sha256: &str) -> bool {
  fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_file() && m.len() == bytes)
    && digest_file(path).is_ok_and(|(length, hash)| length == bytes && hash == sha256)
}

const VERIFIED_FILES: &str = ".verified.json";

struct FileCheck {
  path: PathBuf,
  bytes: u64,
  sha256: String,
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
struct VerifiedStamp {
  bytes: u64,
  modified: (u64, u32),
  sha256: String,
}

/// Hashing every model on each status check is slow, so a successful hash is
/// reused while the file keeps the same size and modification time.
struct VerifiedFiles {
  root: PathBuf,
  previous: HashMap<PathBuf, VerifiedStamp>,
  current: HashMap<PathBuf, VerifiedStamp>,
}

impl VerifiedFiles {
  fn load(root: &Path) -> Self {
    let path = root.join(VERIFIED_FILES);
    let previous = regular_file(&path)
      .then(|| fs::read(&path).ok())
      .flatten()
      .and_then(|bytes| serde_json::from_slice(&bytes).ok())
      .unwrap_or_default();
    Self {
      root: root.to_path_buf(),
      previous,
      current: HashMap::new(),
    }
  }

  #[cfg(test)]
  fn check(&mut self, path: &Path, bytes: u64, sha256: &str) -> bool {
    self.check_all(&[FileCheck {
      path: path.to_path_buf(),
      bytes,
      sha256: sha256.to_owned(),
    }])[0]
  }

  /// Hashes uncached files in parallel and returns one result per file.
  fn check_all(&mut self, files: &[FileCheck]) -> Vec<bool> {
    let results: Vec<_> = files
      .par_iter()
      .map(|file| self.verify(&file.path, file.bytes, &file.sha256))
      .collect();
    results
      .into_iter()
      .map(|(valid, stamp)| {
        if let Some((key, stamp)) = stamp {
          self.current.insert(key, stamp);
        }
        valid
      })
      .collect()
  }

  fn verify(
    &self,
    path: &Path,
    bytes: u64,
    sha256: &str,
  ) -> (bool, Option<(PathBuf, VerifiedStamp)>) {
    // Read the metadata before hashing so a concurrent write invalidates the stamp.
    let Ok(metadata) = fs::symlink_metadata(path) else {
      return (false, None);
    };
    if !metadata.file_type().is_file() || metadata.len() != bytes {
      return (false, None);
    }
    let Some(modified) = metadata
      .modified()
      .ok()
      .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
    else {
      return (verified_file(path, bytes, sha256), None);
    };
    let key = path.strip_prefix(&self.root).unwrap_or(path).to_path_buf();
    let stamp = VerifiedStamp {
      bytes,
      modified: (modified.as_secs(), modified.subsec_nanos()),
      sha256: sha256.to_owned(),
    };
    if self.previous.get(&key) == Some(&stamp) || verified_file(path, bytes, sha256) {
      (true, Some((key, stamp)))
    } else {
      (false, None)
    }
  }

  /// Persists only files verified by this check; failures are not fatal.
  fn save(self) {
    if self.current == self.previous
      || !fs::symlink_metadata(&self.root).is_ok_and(|m| m.file_type().is_dir())
    {
      return;
    }
    let Ok(bytes) = serde_json::to_vec(&self.current) else {
      return;
    };
    let staging = self
      .root
      .join(format!("{VERIFIED_FILES}.{}", uuid::Uuid::new_v4()));
    if fs::write(&staging, bytes).is_err()
      || fs::rename(&staging, self.root.join(VERIFIED_FILES)).is_err()
    {
      let _ = fs::remove_file(staging);
    }
  }
}

#[derive(Serialize, Deserialize)]
struct Receipt {
  archive_sha256: String,
  files: Vec<ReceiptFile>,
}
#[derive(Serialize, Deserialize)]
struct ReceiptFile {
  path: PathBuf,
  bytes: u64,
  sha256: String,
}

fn archive_installed(root: &Path, archive: &Archive, verified: &mut VerifiedFiles) -> bool {
  archive_files(root, archive)
    .is_some_and(|files| verified.check_all(&files).into_iter().all(|valid| valid))
}

/// Returns the receipt files that must hash correctly, or `None` when the
/// extracted archive is already known to be incomplete.
fn archive_files(root: &Path, archive: &Archive) -> Option<Vec<FileCheck>> {
  let directory = archive_directory(root, archive);
  if !fs::symlink_metadata(&directory).is_ok_and(|m| m.file_type().is_dir()) {
    return None;
  }
  let receipt_path = directory.join(".receipt.json");
  if !regular_file(&receipt_path) {
    return None;
  }
  let receipt = serde_json::from_slice::<Receipt>(&fs::read(receipt_path).ok()?).ok()?;
  (receipt.archive_sha256 == archive.sha256
    && !receipt.files.is_empty()
    && archive_contents_valid(&directory, archive)
    && receipt.files.iter().all(|file| safe_relative(&file.path)))
  .then(|| {
    receipt
      .files
      .into_iter()
      .map(|file| FileCheck {
        path: directory.join(file.path),
        bytes: file.bytes,
        sha256: file.sha256,
      })
      .collect()
  })
}

fn archive_contents_valid(directory: &Path, archive: &Archive) -> bool {
  if let Some(library) = &archive.library {
    regular_file(&directory.join(library))
  } else {
    [
      "sys.dic",
      "unk.dic",
      "char.bin",
      "matrix.bin",
      "left-id.def",
      "right-id.def",
      "rewrite.def",
      "pos-id.def",
      "COPYING",
    ]
    .iter()
    .all(|name| regular_file(&directory.join("open_jtalk_dic_utf_8-1.11").join(name)))
  }
}

fn directory(path: &Path) -> Result<(), String> {
  fs::create_dir_all(path).map_err(|e| e.to_string())?;
  if !fs::symlink_metadata(path)
    .map_err(|e| e.to_string())?
    .file_type()
    .is_dir()
  {
    return Err(format!("Expected a directory: {}", path.display()));
  }
  Ok(())
}

fn setup_at(
  root: &Path,
  settings: &crate::config::types::DownloadedSetupConfig,
) -> Result<DownloadSetup, String> {
  let runtime = runtime_archive()?;
  let dictionary = CATALOG
    .archives
    .iter()
    .find(|a| a.id == "dictionary")
    .unwrap();
  let terms = CATALOG.models.iter().find(|m| m.id == "TERMS.txt").unwrap();
  let models: Vec<_> = CATALOG
    .models
    .iter()
    .filter(|m| m.id.ends_with(".vvm"))
    .collect();
  // Hash every component in one parallel batch; each group records its range.
  let mut files = Vec::new();
  let mut groups = Vec::new();
  for archive in [runtime, dictionary] {
    let archive_files = archive_files(root, archive);
    let start = files.len();
    let complete = archive_files.is_some();
    files.extend(archive_files.into_iter().flatten());
    groups.push((complete, start..files.len()));
  }
  for model in std::iter::once(terms).chain(models.iter().copied()) {
    let start = files.len();
    files.push(FileCheck {
      path: model_directory(root).join(&model.id),
      bytes: model.bytes,
      sha256: model.sha256.clone(),
    });
    groups.push((true, start..files.len()));
  }
  let mut verified = VerifiedFiles::load(root);
  let results = verified.check_all(&files);
  let ready: Vec<bool> = groups
    .into_iter()
    .map(|(complete, range)| complete && results[range].iter().all(|&valid| valid))
    .collect();
  let (runtime_ready, dictionary_ready, terms_ready) = (ready[0], ready[1], ready[2]);
  let mut components = vec![
    DownloadComponent {
      id: runtime.id.clone(),
      bytes: runtime.bytes,
      installed: runtime_ready,
      entries: vec![],
    },
    DownloadComponent {
      id: dictionary.id.clone(),
      bytes: dictionary.bytes,
      installed: dictionary_ready,
      entries: vec![],
    },
    DownloadComponent {
      id: terms.id.clone(),
      bytes: terms.bytes,
      installed: terms_ready,
      entries: vec![],
    },
  ];
  let mut models_ready = false;
  let mut models_valid = true;
  for (model, &installed) in models.iter().zip(&ready[3..]) {
    models_ready |= installed;
    models_valid &= installed
      || fs::symlink_metadata(model_directory(root).join(&model.id))
        .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound);
    components.push(DownloadComponent {
      id: model.id.clone(),
      bytes: model.bytes,
      installed,
      entries: model.entries.clone(),
    });
  }
  let core_config =
    (runtime_ready && dictionary_ready && terms_ready && models_ready && models_valid).then(|| {
      CoreConfig {
        ort_path: archive_directory(root, runtime).join(runtime.library.as_ref().unwrap()),
        ojt_dir: archive_directory(root, dictionary).join("open_jtalk_dic_utf_8-1.11"),
        vvm_dir: model_directory(root),
        cache_size: settings.cache_size,
        cpu_num_threads: settings.cpu_num_threads,
        setup_source: SetupSource::Downloaded,
      }
    });
  verified.save();
  Ok(DownloadSetup {
    directory: root.display().to_string(),
    components,
    core_config,
    loaded_models: None,
  })
}

pub(crate) fn resolve_setup(config: &AzaleaConfig) -> Result<Option<CoreConfig>, String> {
  match config.setup_source {
    SetupSource::ExistingInstallation => Ok(config.core.clone()),
    SetupSource::Downloaded => setup_at(&downloaded_components_dir()?, &config.downloaded_setup)?
      .core_config
      .map(Some)
      .ok_or_else(|| {
        "The downloaded CPU setup is incomplete. Download the missing components.".into()
      }),
  }
}

#[tauri::command]
#[specta::specta]
pub async fn get_download_setup(
  state: tauri::State<'_, crate::AppState>,
) -> Result<DownloadSetup, String> {
  let settings = state
    .config_manager
    .read()
    .map_err(|e| e.to_string())?
    .as_ref()
    .map(|m| m.config.downloaded_setup.clone())
    .unwrap_or_default();
  let root = downloaded_components_dir()?;
  let mut setup = tauri::async_runtime::spawn_blocking(move || setup_at(&root, &settings))
    .await
    .map_err(|e| e.to_string())??;
  setup.loaded_models = state
    .core
    .read()
    .await
    .as_ref()
    .filter(|core| core.config.setup_source == SetupSource::Downloaded)
    .map(|core| loaded_model_ids(core.metas.keys()));
  Ok(setup)
}

fn loaded_model_ids<'a>(paths: impl Iterator<Item = &'a String>) -> Vec<String> {
  let mut ids: Vec<String> = paths
    .filter_map(|path| Some(Path::new(path).file_name()?.to_str()?.to_owned()))
    .collect();
  ids.sort();
  ids
}

fn selected_packages(ids: &[String]) -> Result<Vec<Package>, String> {
  if ids.is_empty() {
    return Err("Select at least one voice package".into());
  }
  let mut seen = HashSet::new();
  ids
    .iter()
    .filter(|id| seen.insert(id.as_str()))
    .map(|id| {
      CATALOG
        .models
        .iter()
        .find(|m| m.id == *id && m.id.ends_with(".vvm"))
        .cloned()
        .ok_or_else(|| format!("Unknown voice package: {id}"))
    })
    .collect()
}

fn delete_models_at(root: &Path, packages: &[Package]) -> Result<(), String> {
  let directory = model_directory(root);
  // Never traverse a substituted directory when deleting managed files.
  for parent in [root.to_path_buf(), root.join("models"), directory.clone()] {
    match fs::symlink_metadata(&parent) {
      Ok(metadata) if metadata.file_type().is_dir() => {}
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
      _ => return Err(format!("Expected a directory: {}", parent.display())),
    }
  }
  for package in packages {
    match fs::symlink_metadata(directory.join(&package.id)) {
      Ok(metadata) if metadata.file_type().is_dir() => {
        return Err(format!("Expected a model file: {}", package.id));
      }
      Ok(_) => {}
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
      Err(error) => return Err(error.to_string()),
    }
  }
  for package in packages {
    match fs::remove_file(directory.join(&package.id)) {
      Ok(()) => {}
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
      Err(error) => return Err(error.to_string()),
    }
  }
  Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_downloaded_models(
  app: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
  package_ids: Vec<String>,
) -> Result<(), String> {
  let packages = selected_packages(&package_ids)?;
  let root = downloaded_components_dir()?;
  {
    let mut running = OPERATION.lock().map_err(|e| e.to_string())?;
    if running.is_some() {
      return Err("A model operation is already running".into());
    }
    *running = Some((uuid::Uuid::new_v4().to_string(), Arc::default()));
  }
  let _operation = Operation;
  let _permit = state
    .core_task_gate
    .acquire()
    .await
    .map_err(|e| e.to_string())?;
  let active = state
    .core
    .read()
    .await
    .as_ref()
    .filter(|core| core.config.setup_source == SetupSource::Downloaded)
    .map(|core| core.config.clone());
  let result = tauri::async_runtime::spawn_blocking(move || delete_models_at(&root, &packages))
    .await
    .map_err(|e| e.to_string())?;
  if let Some(config) = active {
    if let Err(error) = super::core::reinitialize_core_locked(&app, &state, config).await {
      // Removed voices cannot remain available when rebuilding the core fails.
      state.core.write().await.take();
      super::core::discard_core_work(&app, &state).await?;
      state.wav_lru.write().await.take();
      state.query_lru.write().map_err(|e| e.to_string())?.take();
      return Err(error);
    }
  }
  result
}

async fn fetch_file(
  client: &reqwest::Client,
  url: &str,
  path: &Path,
  bytes: u64,
  sha256: &str,
  cancellation: &JobCancellation,
  mut progress: impl FnMut(u64),
) -> Result<(), String> {
  let mut response = run_cancellable(cancellation, client.get(url).send())
    .await
    .ok_or("Download cancelled")?
    .map_err(|e| e.to_string())?
    .error_for_status()
    .map_err(|e| e.to_string())?;
  if response
    .content_length()
    .is_some_and(|length| length != bytes)
  {
    return Err("Unexpected download size".into());
  }
  let mut file = OpenOptions::new()
    .write(true)
    .create_new(true)
    .open(path)
    .map_err(|e| e.to_string())?;
  let mut length = 0;
  let mut hash = Sha256::new();
  while let Some(chunk) = run_cancellable(cancellation, response.chunk())
    .await
    .ok_or("Download cancelled")?
    .map_err(|e| e.to_string())?
  {
    length += chunk.len() as u64;
    if length > bytes {
      return Err("Download exceeds expected size".into());
    }
    file.write_all(&chunk).map_err(|e| e.to_string())?;
    hash.update(&chunk);
    progress(length);
  }
  if length != bytes || format!("{:x}", hash.finalize()) != sha256 {
    return Err("Download size or SHA-256 checksum does not match".into());
  }
  file.sync_all().map_err(|e| e.to_string())?;
  if cancellation.is_cancelled() {
    return Err("Download cancelled".into());
  }
  Ok(())
}

fn extract_archive(
  path: &Path,
  destination: &Path,
  archive: &Archive,
  cancellation: &JobCancellation,
) -> Result<(), String> {
  directory(destination)?;
  let decoder = GzDecoder::new(File::open(path).map_err(|e| e.to_string())?);
  let mut tar = tar::Archive::new(decoder);
  let mut expanded = 0_u64;
  let mut files = Vec::new();
  for entry in tar.entries().map_err(|e| e.to_string())? {
    if cancellation.is_cancelled() {
      return Err("Download cancelled".into());
    }
    let mut entry = entry.map_err(|e| e.to_string())?;
    let path = entry.path().map_err(|e| e.to_string())?.into_owned();
    if !safe_relative(&path) {
      return Err("Archive contains an unsafe path".into());
    }
    let kind = entry.header().entry_type();
    if kind.is_symlink() || kind.is_hard_link() {
      continue;
    }
    if kind.is_dir() {
      directory(&destination.join(&path))?;
      continue;
    }
    if !kind.is_file() {
      return Err("Archive contains an unsupported entry".into());
    }
    expanded = expanded
      .checked_add(entry.size())
      .ok_or("Archive is too large")?;
    if expanded > archive.expanded_limit {
      return Err("Archive exceeds expanded size limit".into());
    }
    let output = destination.join(&path);
    directory(output.parent().ok_or("Invalid archive path")?)?;
    let mut file = OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&output)
      .map_err(|e| e.to_string())?;
    let mut buffer = [0; 65536];
    let mut hash = Sha256::new();
    let mut length = 0;
    loop {
      if cancellation.is_cancelled() {
        return Err("Download cancelled".into());
      }
      let count = entry.read(&mut buffer).map_err(|e| e.to_string())?;
      if count == 0 {
        break;
      }
      file
        .write_all(&buffer[..count])
        .map_err(|e| e.to_string())?;
      hash.update(&buffer[..count]);
      length += count as u64;
    }
    file.sync_all().map_err(|e| e.to_string())?;
    files.push(ReceiptFile {
      path,
      bytes: length,
      sha256: format!("{:x}", hash.finalize()),
    });
  }
  if !archive_contents_valid(destination, archive) {
    return Err("Archive is missing required component files".into());
  }
  let receipt = Receipt {
    archive_sha256: archive.sha256.clone(),
    files,
  };
  fs::write(
    destination.join(".receipt.json"),
    serde_json::to_vec(&receipt).map_err(|e| e.to_string())?,
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

fn remove_owned_path(path: &Path) -> Result<(), String> {
  match fs::symlink_metadata(path) {
    Ok(m) if m.file_type().is_dir() => fs::remove_dir_all(path).map_err(|e| e.to_string()),
    Ok(_) => fs::remove_file(path).map_err(|e| e.to_string()),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
    Err(e) => Err(e.to_string()),
  }
}

fn commit(source: &Path, destination: &Path, cancellation: &JobCancellation) -> Result<(), String> {
  if cancellation.is_cancelled() {
    return Err("Download cancelled".into());
  }
  directory(
    destination
      .parent()
      .ok_or("Invalid component destination")?,
  )?;
  // Only invalid/missing owned components reach this path; verified components are skipped.
  remove_owned_path(destination)?;
  fs::rename(source, destination).map_err(|e| e.to_string())
}

fn validate_model(
  path: &Path,
  package: &Package,
) -> Result<Vec<super::assets::SpeakerIconRequest>, String> {
  let model = VoiceModelFile::open(path).map_err(|e| e.to_string())?;
  let actual: HashSet<_> = model
    .metas()
    .iter()
    .flat_map(|m| &m.styles)
    .filter(|s| crate::core::is_talk_style(s.r#type))
    .map(|s| s.id.0)
    .collect();
  let expected = package
    .entries
    .iter()
    .map(|e| e.style_id)
    .collect::<HashSet<_>>();
  if actual != expected {
    return Err("VVM metadata does not match the package catalog".into());
  }
  Ok(
    model
      .metas()
      .iter()
      .filter_map(|m| {
        m.styles
          .iter()
          .filter(|s| crate::core::is_talk_style(s.r#type))
          .min_by_key(|s| s.order.unwrap_or(u32::MAX))
          .map(|s| super::assets::SpeakerIconRequest {
            speaker_uuid: m.speaker_uuid.clone(),
            style_id: s.id.0,
          })
      })
      .collect(),
  )
}

async fn download_at(
  root: PathBuf,
  client: reqwest::Client,
  packages: Vec<Package>,
  cancellation: Arc<JobCancellation>,
  progress: impl Fn(&str, u64, u64, bool),
) -> Result<Vec<super::assets::SpeakerIconRequest>, String> {
  directory(&root)?;
  let staging = root.join(".staging");
  remove_owned_path(&staging)?;
  directory(&staging)?;
  let result = async {
    let mut archives = vec![
      runtime_archive()?.clone(),
      CATALOG
        .archives
        .iter()
        .find(|a| a.id == "dictionary")
        .unwrap()
        .clone(),
    ];
    for archive in archives.drain(..) {
      let root_copy = root.clone();
      let archive_copy = archive.clone();
      if tauri::async_runtime::spawn_blocking(move || {
        let mut verified = VerifiedFiles::load(&root_copy);
        let installed = archive_installed(&root_copy, &archive_copy, &mut verified);
        verified.save();
        installed
      })
      .await
      .map_err(|e| e.to_string())?
      {
        continue;
      }
      let path = staging.join("archive.tgz");
      fetch_file(
        &client,
        &archive.url,
        &path,
        archive.bytes,
        &archive.sha256,
        &cancellation,
        |n| progress(&archive.id, n, archive.bytes, false),
      )
      .await?;
      progress(&archive.id, archive.bytes, archive.bytes, true);
      let extracted = staging.join("extracted");
      let archive_copy = archive.clone();
      let path_copy = path.clone();
      let extracted_copy = extracted.clone();
      let cancel_copy = cancellation.clone();
      tauri::async_runtime::spawn_blocking(move || {
        extract_archive(&path_copy, &extracted_copy, &archive_copy, &cancel_copy)
      })
      .await
      .map_err(|e| e.to_string())??;
      commit(
        &extracted,
        &archive_directory(&root, &archive),
        &cancellation,
      )?;
      fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    directory(&model_directory(&root))?;
    let terms = CATALOG.models.iter().find(|m| m.id == "TERMS.txt").unwrap();
    let mut icons = Vec::new();
    for package in std::iter::once(terms).chain(packages.iter()) {
      let destination = model_directory(&root).join(&package.id);
      let destination_copy = destination.clone();
      let package_copy = package.clone();
      let installed = tauri::async_runtime::spawn_blocking(move || {
        verified_file(&destination_copy, package_copy.bytes, &package_copy.sha256)
      })
      .await
      .map_err(|e| e.to_string())?;
      let path = if installed {
        destination.clone()
      } else {
        let path = staging.join(&package.id);
        fetch_file(
          &client,
          &package.url,
          &path,
          package.bytes,
          &package.sha256,
          &cancellation,
          |n| progress(&package.id, n, package.bytes, false),
        )
        .await?;
        path
      };
      if package.id.ends_with(".vvm") {
        let package_copy = package.clone();
        let path_copy = path.clone();
        icons.extend(
          tauri::async_runtime::spawn_blocking(move || validate_model(&path_copy, &package_copy))
            .await
            .map_err(|e| e.to_string())??,
        );
      }
      if !installed {
        commit(&path, &destination, &cancellation)?;
      }
    }
    Ok(icons)
  }
  .await;
  let cleanup = remove_owned_path(&staging);
  result.and_then(|icons| cleanup.map(|_| icons))
}

#[tauri::command]
#[specta::specta]
pub async fn download_cpu_setup(
  app: tauri::AppHandle,
  operation_id: String,
  package_ids: Vec<String>,
) -> Result<DownloadOutcome, String> {
  uuid::Uuid::parse_str(&operation_id).map_err(|_| "Invalid download operation ID")?;
  let packages = selected_packages(&package_ids)?;
  let root = downloaded_components_dir()?;
  let client = reqwest::Client::builder()
    .user_agent("Azalea CPU setup downloader")
    .connect_timeout(Duration::from_secs(20))
    .read_timeout(Duration::from_secs(30))
    .https_only(true)
    .build()
    .map_err(|e| e.to_string())?;
  let cancellation = Arc::new(JobCancellation::default());
  {
    let mut running = OPERATION.lock().unwrap();
    if running.is_some() {
      return Err("A setup download is already running".into());
    }
    *running = Some((operation_id.clone(), cancellation.clone()));
  }
  let _operation = Operation;
  let last_event = Mutex::new(Instant::now() - Duration::from_secs(1));
  let result = download_at(
    root,
    client,
    packages,
    cancellation.clone(),
    |id, completed, total, extracting| {
      let mut last = last_event.lock().unwrap();
      if completed == total || extracting || last.elapsed() >= Duration::from_millis(100) {
        let _ = DownloadProgressEvent {
          operation_id: operation_id.clone(),
          component_id: id.to_owned(),
          completed_bytes: completed,
          total_bytes: total,
          extracting,
        }
        .emit(&app);
        *last = Instant::now();
      }
    },
  )
  .await;
  if cancellation.is_cancelled() {
    return Ok(DownloadOutcome {
      cancelled: true,
      icon_errors: vec![],
    });
  }
  let icons = result?;
  let icons = icons.into_iter().fold(
    Vec::<super::assets::SpeakerIconRequest>::new(),
    |mut result, request| {
      if !result
        .iter()
        .any(|r| r.speaker_uuid == request.speaker_uuid)
      {
        result.push(request);
      }
      result
    },
  );
  let _ = DownloadProgressEvent {
    operation_id,
    component_id: "speaker-icons".into(),
    completed_bytes: 0,
    total_bytes: 1,
    extracting: false,
  }
  .emit(&app);
  let icon_results = run_cancellable(&cancellation, super::download_speaker_icons(icons)).await;
  let icon_errors = match icon_results {
    Some(Ok(results)) => results.into_iter().filter_map(|r| r.error).collect(),
    Some(Err(error)) => vec![error],
    None => vec![],
  };
  Ok(DownloadOutcome {
    cancelled: cancellation.is_cancelled(),
    icon_errors,
  })
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_setup_download(operation_id: String) -> Result<(), String> {
  if let Some((id, cancellation)) = OPERATION.lock().map_err(|e| e.to_string())?.as_ref() {
    if *id == operation_id {
      cancellation.cancel();
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use flate2::{write::GzEncoder, Compression};
  use std::net::TcpListener;

  fn fixture_archive(root: &Path, content: &[u8], limit: u64) -> (PathBuf, Archive) {
    let path = root.join("fixture.tgz");
    let encoder = GzEncoder::new(File::create(&path).unwrap(), Compression::default());
    let mut tar = tar::Builder::new(encoder);
    let mut header = tar::Header::new_gnu();
    header.set_size(content.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    tar
      .append_data(&mut header, "root/lib.so", content)
      .unwrap();
    tar.into_inner().unwrap().finish().unwrap();
    let (bytes, sha256) = digest_file(&path).unwrap();
    (
      path,
      Archive {
        id: "runtime-fixture".into(),
        url: String::new(),
        bytes,
        sha256,
        library: Some("root/lib.so".into()),
        expanded_limit: limit,
      },
    )
  }

  fn http_response(response: Vec<u8>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    std::thread::spawn(move || {
      let (mut socket, _) = listener.accept().unwrap();
      let mut request = [0; 4096];
      socket.read(&mut request).unwrap();
      socket.write_all(&response).unwrap();
    });
    format!("http://{address}")
  }

  #[test]
  fn catalog_is_pinned_to_cpu_and_talk_packages() {
    assert_eq!(CATALOG.archives.len(), 6);
    assert_eq!(
      selected_packages(&["0.vvm".into(), "0.vvm".into(), "n0.vvm".into()])
        .unwrap()
        .len(),
      2
    );
    assert!(selected_packages(&[]).is_err());
    for id in ["../0.vvm", "s0.vvm", "TERMS.txt", "unknown.vvm"] {
      assert!(selected_packages(&[id.into()]).is_err());
    }
    assert_eq!(
      CATALOG
        .models
        .iter()
        .filter(|m| m.id.ends_with(".vvm"))
        .count(),
      26
    );
    for a in &CATALOG.archives {
      assert!(a.url.starts_with("https://github.com/"));
      assert_eq!(a.sha256.len(), 64);
      assert!(a.bytes > 0 && a.expanded_limit > 0);
      assert!(!a.id.contains("cuda") && !a.id.contains("dml"));
    }
    for (os, arch) in [
      ("linux", "x86_64"),
      ("linux", "aarch64"),
      ("windows", "x86_64"),
      ("macos", "x86_64"),
      ("macos", "aarch64"),
    ] {
      assert!(CATALOG
        .archives
        .iter()
        .any(|a| a.id == runtime_id(os, arch).unwrap()));
    }
    assert!(runtime_id("windows", "aarch64").is_err());
  }

  #[test]
  fn deletion_removes_only_selected_models_and_preserves_shared_components() {
    let root = tempfile::tempdir().unwrap();
    let models = model_directory(root.path());
    fs::create_dir_all(&models).unwrap();
    for name in ["0.vvm", "n0.vvm", "TERMS.txt"] {
      fs::write(models.join(name), b"keep").unwrap();
    }
    fs::create_dir_all(root.path().join("dictionary")).unwrap();
    fs::write(root.path().join("dictionary/sys.dic"), b"dictionary").unwrap();
    fs::create_dir_all(root.path().join("runtime")).unwrap();
    fs::write(root.path().join("runtime/lib.so"), b"runtime").unwrap();
    let selected = selected_packages(&["0.vvm".into(), "0.vvm".into()]).unwrap();
    delete_models_at(root.path(), &selected).unwrap();
    delete_models_at(root.path(), &selected).unwrap();
    assert!(!models.join("0.vvm").exists());
    assert!(models.join("n0.vvm").is_file());
    assert!(models.join("TERMS.txt").is_file());
    assert!(root.path().join("dictionary/sys.dic").is_file());
    assert!(root.path().join("runtime/lib.so").is_file());
    fs::create_dir(models.join("0.vvm")).unwrap();
    let selected = selected_packages(&["n0.vvm".into(), "0.vvm".into()]).unwrap();
    assert!(delete_models_at(root.path(), &selected).is_err());
    assert!(models.join("n0.vvm").is_file());
    let missing = tempfile::tempdir().unwrap();
    delete_models_at(missing.path(), &selected).unwrap();
  }

  #[cfg(unix)]
  #[test]
  fn deletion_rejects_linked_directories_and_never_deletes_link_targets() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("0.vvm");
    fs::write(&target, b"keep").unwrap();
    let selected = selected_packages(&["0.vvm".into()]).unwrap();
    let models = model_directory(root.path());
    fs::create_dir_all(models.parent().unwrap()).unwrap();
    symlink(outside.path(), &models).unwrap();
    assert!(delete_models_at(root.path(), &selected).is_err());
    assert!(target.is_file());
    fs::remove_file(&models).unwrap();
    fs::create_dir(&models).unwrap();
    symlink(&target, models.join("0.vvm")).unwrap();
    delete_models_at(root.path(), &selected).unwrap();
    assert!(target.is_file());
    assert!(!models.join("0.vvm").exists());
  }

  #[test]
  fn extraction_receipt_detects_corruption_and_commit_leaves_no_staging() {
    let root = tempfile::tempdir().unwrap();
    let (path, archive) = fixture_archive(root.path(), b"library", 100);
    let staging = root.path().join("staging");
    let cancellation = JobCancellation::default();
    extract_archive(&path, &staging, &archive, &cancellation).unwrap();
    let destination = archive_directory(root.path(), &archive);
    commit(&staging, &destination, &cancellation).unwrap();
    assert!(!staging.exists());
    assert!(archive_installed(
      root.path(),
      &archive,
      &mut VerifiedFiles::load(root.path())
    ));
    fs::write(destination.join("root/lib.so"), b"corrupt").unwrap();
    assert!(!archive_installed(
      root.path(),
      &archive,
      &mut VerifiedFiles::load(root.path())
    ));
    assert!(!verified_file(&path, archive.bytes + 1, &archive.sha256));
    fs::write(&path, b"truncated").unwrap();
    assert!(!verified_file(&path, archive.bytes, &archive.sha256));
  }

  #[test]
  fn extraction_and_commit_respect_cancellation_and_size_limits() {
    let root = tempfile::tempdir().unwrap();
    let (path, archive) = fixture_archive(root.path(), b"too big", 2);
    assert!(extract_archive(
      &path,
      &root.path().join("limited"),
      &archive,
      &JobCancellation::default()
    )
    .unwrap_err()
    .contains("size limit"));
    let cancellation = JobCancellation::default();
    cancellation.cancel();
    assert!(extract_archive(
      &path,
      &root.path().join("cancelled"),
      &archive,
      &cancellation
    )
    .is_err());
    let destination = root.path().join("existing");
    fs::write(&destination, b"keep").unwrap();
    assert!(commit(&path, &destination, &cancellation).is_err());
    assert_eq!(fs::read(destination).unwrap(), b"keep");
    let broken = root.path().join("bad.tgz");
    fs::write(&broken, b"not gzip").unwrap();
    assert!(extract_archive(
      &broken,
      &root.path().join("broken"),
      &archive,
      &JobCancellation::default()
    )
    .is_err());
  }

  #[test]
  fn verified_files_reuse_hashes_until_size_or_modification_time_changes() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("model.vvm");
    fs::write(&path, b"voice").unwrap();
    let hash = format!("{:x}", Sha256::digest(b"voice"));
    let mut verified = VerifiedFiles::load(root.path());
    assert!(verified.check(&path, 5, &hash));
    assert!(!verified.check(&path, 5, "wrong"));
    verified.save();
    assert!(regular_file(&root.path().join(VERIFIED_FILES)));

    // Same size and timestamp: the stored hash is trusted without rereading.
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    fs::write(&path, b"VOICE").unwrap();
    File::options()
      .write(true)
      .open(&path)
      .unwrap()
      .set_modified(modified)
      .unwrap();
    assert!(VerifiedFiles::load(root.path()).check(&path, 5, &hash));

    // A new timestamp forces a full hash, which detects the change.
    File::options()
      .write(true)
      .open(&path)
      .unwrap()
      .set_modified(modified + Duration::from_secs(1))
      .unwrap();
    assert!(!VerifiedFiles::load(root.path()).check(&path, 5, &hash));
    assert!(!VerifiedFiles::load(root.path()).check(&path, 4, &hash));
    assert!(!VerifiedFiles::load(root.path()).check(&root.path().join("missing"), 5, &hash));
  }

  #[test]
  fn parallel_verification_keeps_results_in_input_order() {
    let root = tempfile::tempdir().unwrap();
    let files: Vec<_> = (0..16)
      .map(|index| {
        let content = format!("file {index}");
        let path = root.path().join(format!("{index}.vvm"));
        fs::write(&path, &content).unwrap();
        let sha256 = if index % 3 == 0 {
          "wrong".to_owned()
        } else {
          format!("{:x}", Sha256::digest(content.as_bytes()))
        };
        FileCheck {
          path,
          bytes: content.len() as u64,
          sha256,
        }
      })
      .collect();
    let mut verified = VerifiedFiles::load(root.path());
    let results = verified.check_all(&files);
    assert_eq!(
      results,
      (0..16).map(|index| index % 3 != 0).collect::<Vec<_>>()
    );
    assert_eq!(verified.current.len(), 10);
  }

  #[test]
  fn verified_files_ignore_corrupt_stamps_and_missing_roots() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join(VERIFIED_FILES), b"not json").unwrap();
    let path = root.path().join("terms.txt");
    fs::write(&path, b"terms").unwrap();
    let mut verified = VerifiedFiles::load(root.path());
    assert!(verified.check(&path, 5, &format!("{:x}", Sha256::digest(b"terms"))));
    verified.save();
    assert!(serde_json::from_slice::<HashMap<PathBuf, VerifiedStamp>>(
      &fs::read(root.path().join(VERIFIED_FILES)).unwrap()
    )
    .is_ok());
    let missing = root.path().join("missing");
    let mut verified = VerifiedFiles::load(&missing);
    verified.current.insert(
      PathBuf::from("file"),
      VerifiedStamp {
        bytes: 1,
        modified: (0, 0),
        sha256: String::new(),
      },
    );
    verified.save();
    assert!(!missing.exists());
  }

  #[test]
  fn loaded_model_ids_use_sorted_file_names() {
    let paths = ["/models/n0.vvm".to_owned(), "/models/0.vvm".to_owned()];
    assert_eq!(loaded_model_ids(paths.iter()), ["0.vvm", "n0.vvm"]);
  }

  #[test]
  fn archive_paths_cannot_escape_and_missing_files_are_not_ready() {
    for path in [
      "../escape",
      "/absolute",
      "root/../../escape",
      "C:/evil",
      "root\\evil",
      "",
    ] {
      assert!(!safe_relative(Path::new(path)), "{path}");
    }
    assert!(safe_relative(Path::new("root/lib.so")));
    let root = tempfile::tempdir().unwrap();
    let (path, mut archive) = fixture_archive(root.path(), b"library", 100);
    archive.library = Some("missing.so".into());
    assert!(extract_archive(
      &path,
      &root.path().join("missing"),
      &archive,
      &JobCancellation::default()
    )
    .is_err());
    let setup = setup_at(root.path(), &Default::default()).unwrap();
    assert!(setup.core_config.is_none());
    assert!(setup.components.iter().all(|c| !c.installed));
    assert!(setup.directory.ends_with(root.path().to_str().unwrap()));
    let package = selected_packages(&["0.vvm".into()]).unwrap().remove(0);
    assert!(validate_model(&path, &package).is_err());
  }

  #[test]
  fn extraction_rejects_duplicate_and_traversing_entries_and_skips_links() {
    let root = tempfile::tempdir().unwrap();
    let (_, archive) = fixture_archive(root.path(), b"library", 100);
    for (name, escape, duplicate) in [
      ("escape", true, false),
      ("duplicate", false, true),
      ("links", false, false),
    ] {
      let path = root.path().join(format!("{name}.tgz"));
      let encoder = GzEncoder::new(File::create(&path).unwrap(), Compression::default());
      let mut tar = tar::Builder::new(encoder);
      let mut header = tar::Header::new_gnu();
      header.set_mode(0o644);
      header.set_size(7);
      header.set_path("root/lib.so").unwrap();
      if escape {
        // Build the raw malicious header; Builder::append_data rejects traversal itself.
        header.as_mut_bytes()[..100].fill(0);
        header.as_mut_bytes()[..9].copy_from_slice(b"../escape");
      }
      header.set_cksum();
      tar.append(&header, b"library".as_slice()).unwrap();
      if duplicate {
        tar.append(&header, b"library".as_slice()).unwrap();
      }
      if !escape && !duplicate {
        let mut link = tar::Header::new_gnu();
        link.set_path("root/link").unwrap();
        link.set_entry_type(tar::EntryType::Symlink);
        link.set_size(0);
        link.set_link_name("../../outside").unwrap();
        link.set_cksum();
        tar.append(&link, std::io::empty()).unwrap();
      }
      tar.into_inner().unwrap().finish().unwrap();
      let destination = root.path().join(name);
      let result = extract_archive(&path, &destination, &archive, &JobCancellation::default());
      if escape || duplicate {
        assert!(result.is_err());
      } else {
        result.unwrap();
        assert!(!destination.join("root/link").exists());
      }
    }
    assert!(!root.path().join("escape").is_file());
  }

  #[test]
  fn streaming_download_verifies_hash_size_http_errors_and_cancellation() {
    tauri::async_runtime::block_on(async {
      let root = tempfile::tempdir().unwrap();
      let client = reqwest::Client::new();
      let hash = format!("{:x}", Sha256::digest(b"hello"));
      let cancellation = JobCancellation::default();
      let response = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello";
      let url = http_response(response.to_vec());
      let path = root.path().join("success");
      let mut progress = 0;
      fetch_file(&client, &url, &path, 5, &hash, &cancellation, |n| {
        progress = n
      })
      .await
      .unwrap();
      assert_eq!(progress, 5);
      assert!(verified_file(&path, 5, &hash));
      for (name, bytes, checksum, body) in [
        ("size", 4, hash.as_str(), response.as_slice()),
        ("checksum", 5, "bad", response.as_slice()),
        (
          "truncated",
          5,
          hash.as_str(),
          b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nhi".as_slice(),
        ),
        (
          "overflow",
          4,
          hash.as_str(),
          b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nhello".as_slice(),
        ),
        (
          "http",
          5,
          hash.as_str(),
          b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".as_slice(),
        ),
      ] {
        let url = http_response(body.to_vec());
        assert!(
          fetch_file(
            &client,
            &url,
            &root.path().join(name),
            bytes,
            checksum,
            &cancellation,
            |_| {}
          )
          .await
          .is_err(),
          "{name}"
        );
      }
      cancellation.cancel();
      assert!(fetch_file(
        &client,
        "http://127.0.0.1:1",
        &root.path().join("cancelled"),
        5,
        &hash,
        &cancellation,
        |_| {}
      )
      .await
      .is_err());
    });
  }

  #[cfg(unix)]
  #[test]
  fn owned_cleanup_and_validation_do_not_follow_symlinks() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let file = outside.path().join("keep");
    fs::write(&file, b"keep").unwrap();
    let link = root.path().join("link");
    symlink(outside.path(), &link).unwrap();
    assert!(directory(&link).is_err());
    remove_owned_path(&link).unwrap();
    assert_eq!(fs::read(&file).unwrap(), b"keep");
    symlink(&file, &link).unwrap();
    assert!(!verified_file(
      &link,
      4,
      &format!("{:x}", Sha256::digest(b"keep"))
    ));
  }
}
