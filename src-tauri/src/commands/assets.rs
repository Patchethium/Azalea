use crate::config::manager::assets_dir;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use futures_util::{stream, StreamExt};
use reqwest::{Client, Response, Url};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;

// One recursive tree lists every character directory and portrait variant.
const CHARACTER_INFO_URL: &str = "https://api.github.com/repos/VOICEVOX/voicevox_resource/git/trees/main:character_info?recursive=1";
const RAW_CHARACTER_INFO_URL: &str =
  "https://raw.githubusercontent.com/VOICEVOX/voicevox_resource/main/character_info";
const MAX_ICON_BYTES: usize = 2 * 1024 * 1024;
const MAX_DIRECTORY_LIST_BYTES: usize = 8 * 1024 * 1024;
const MAX_CONCURRENT_ICON_DOWNLOADS: usize = 8;
const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);

static ASSET_OPERATION_LOCK: LazyLock<tokio::sync::Mutex<()>> =
  LazyLock::new(|| tokio::sync::Mutex::new(()));

#[derive(Clone, Debug, Deserialize, Type)]
pub struct SpeakerIconRequest {
  pub speaker_uuid: String,
  pub style_id: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Type)]
pub struct SpeakerIconResult {
  pub speaker_uuid: String,
  pub data_url: Option<String>,
  pub error: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Type)]
pub struct SpeakerPortraitResult {
  pub speaker_uuid: String,
  /// Whether the speaker's default portrait is cached after the download.
  pub cached: bool,
  pub error: Option<String>,
}

impl SpeakerIconResult {
  fn cached(request: &SpeakerIconRequest, bytes: &[u8]) -> Self {
    Self {
      speaker_uuid: request.speaker_uuid.clone(),
      data_url: Some(png_data_url(bytes)),
      error: None,
    }
  }

  fn missing(request: &SpeakerIconRequest) -> Self {
    Self {
      speaker_uuid: request.speaker_uuid.clone(),
      data_url: None,
      error: None,
    }
  }

  fn failed(request: &SpeakerIconRequest, error: impl std::fmt::Display) -> Self {
    Self {
      speaker_uuid: request.speaker_uuid.clone(),
      data_url: None,
      error: Some(error.to_string()),
    }
  }
}

fn png_data_url(bytes: &[u8]) -> String {
  format!("data:image/png;base64,{}", BASE64_STANDARD.encode(bytes))
}

#[derive(Deserialize)]
struct CharacterTree {
  tree: Vec<CharacterTreeEntry>,
}

#[derive(Deserialize)]
struct CharacterTreeEntry {
  path: String,
  #[serde(rename = "type")]
  kind: String,
}

/// A `character_info/{name}_{uuid}` directory and the portraits it provides.
#[derive(Debug, Default, PartialEq)]
struct CharacterResource {
  directory: String,
  portrait: bool,
  portrait_styles: Vec<u32>,
}

fn parse_character_tree(entries: Vec<CharacterTreeEntry>) -> Vec<CharacterResource> {
  let mut resources: Vec<CharacterResource> = Vec::new();
  for entry in entries {
    let parts: Vec<&str> = entry.path.split('/').collect();
    let Some(directory) = parts.first().filter(|name| !name.is_empty()) else {
      continue;
    };
    let index = match resources.iter().position(|r| r.directory == *directory) {
      Some(index) => index,
      None if parts.len() == 1 && entry.kind == "tree" => {
        resources.push(CharacterResource {
          directory: (*directory).to_owned(),
          ..Default::default()
        });
        resources.len() - 1
      }
      None => continue,
    };
    if entry.kind != "blob" {
      continue;
    }
    match parts[1..] {
      ["portrait.png"] => resources[index].portrait = true,
      ["portraits", file] => {
        if let Some(style_id) = file
          .strip_suffix(".png")
          .and_then(|id| id.parse::<u32>().ok())
        {
          resources[index].portrait_styles.push(style_id);
        }
      }
      _ => {}
    }
  }
  resources
}

fn speaker_icon_dir(assets_root: &Path) -> PathBuf {
  assets_root.join("speaker-icons")
}

/// The default portrait (`style_id = None`) or a style-specific variant.
fn speaker_portrait_path(
  assets_root: &Path,
  speaker_uuid: &str,
  style_id: Option<u32>,
) -> Result<PathBuf, String> {
  validate_speaker_uuid(speaker_uuid)?;
  let directory = assets_root.join("speaker-portraits").join(speaker_uuid);
  Ok(match style_id {
    Some(style_id) => directory.join(format!("{style_id}.png")),
    None => directory.join("portrait.png"),
  })
}

fn portrait_is_cached(assets_root: &Path, speaker_uuid: &str) -> bool {
  speaker_portrait_path(assets_root, speaker_uuid, None)
    .is_ok_and(|path| matches!(read_cached_icon(&path), Ok(Some(_))))
}

fn validate_speaker_uuid(speaker_uuid: &str) -> Result<(), String> {
  if speaker_uuid.is_empty() || speaker_uuid.len() > 128 {
    return Err("Speaker UUID must contain between 1 and 128 characters".into());
  }
  if !speaker_uuid
    .bytes()
    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
  {
    return Err("Speaker UUID contains invalid filename characters".into());
  }
  Ok(())
}

fn speaker_icon_path(assets_root: &Path, request: &SpeakerIconRequest) -> Result<PathBuf, String> {
  validate_speaker_uuid(&request.speaker_uuid)?;
  Ok(
    speaker_icon_dir(assets_root)
      .join(format!("{}-{}.png", request.speaker_uuid, request.style_id)),
  )
}

fn validate_png(bytes: &[u8]) -> Result<(), String> {
  if bytes.len() > MAX_ICON_BYTES {
    return Err(format!("Icon exceeds the {MAX_ICON_BYTES} byte size limit"));
  }
  if !bytes.starts_with(PNG_SIGNATURE) {
    return Err("Icon does not have a valid PNG signature".into());
  }
  Ok(())
}

fn read_cached_icon(path: &Path) -> Result<Option<Vec<u8>>, String> {
  let metadata = match fs::symlink_metadata(path) {
    Ok(metadata) => metadata,
    Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
    Err(error) => return Err(format!("Failed to inspect cached icon: {error}")),
  };
  if !metadata.file_type().is_file() {
    return Err("Cached icon is not a regular file".into());
  }
  if metadata.len() > MAX_ICON_BYTES as u64 {
    return Err(format!(
      "Cached icon exceeds the {MAX_ICON_BYTES} byte size limit"
    ));
  }
  let bytes = fs::read(path).map_err(|error| format!("Failed to read cached icon: {error}"))?;
  validate_png(&bytes)?;
  Ok(Some(bytes))
}

fn remove_invalid_cache_file(path: &Path) -> Result<(), String> {
  match fs::symlink_metadata(path) {
    Ok(metadata) if metadata.file_type().is_file() || metadata.file_type().is_symlink() => {
      fs::remove_file(path)
        .map_err(|error| format!("Failed to remove invalid cached icon: {error}"))
    }
    Ok(_) => Err("Cached icon path is not a file".into()),
    Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
    Err(error) => Err(format!("Failed to inspect invalid cached icon: {error}")),
  }
}

fn ensure_directory(path: &Path) -> Result<(), String> {
  match fs::symlink_metadata(path) {
    Ok(metadata) if metadata.file_type().is_dir() => Ok(()),
    Ok(_) => Err(format!("Asset path is not a directory: {}", path.display())),
    Err(error) if error.kind() == ErrorKind::NotFound => {
      fs::create_dir_all(path).map_err(|error| format!("Failed to create asset directory: {error}"))
    }
    Err(error) => Err(format!("Failed to inspect asset directory: {error}")),
  }
}

fn write_icon_atomically(assets_root: &Path, path: &Path, bytes: &[u8]) -> Result<(), String> {
  validate_png(bytes)?;
  ensure_directory(assets_root)?;
  let parent = path.parent().ok_or("Cached icon path has no parent")?;
  let relative = parent
    .strip_prefix(assets_root)
    .map_err(|_| "Cached icon path is outside the asset directory")?;
  let mut directory = assets_root.to_path_buf();
  for component in relative.components() {
    directory.push(component);
    ensure_directory(&directory)?;
  }

  let file_name = path
    .file_name()
    .and_then(|name| name.to_str())
    .ok_or("Cached icon path has an invalid filename")?;
  let temporary_path = path.with_file_name(format!(
    ".{file_name}.{}.tmp",
    uuid::Uuid::new_v4().as_hyphenated()
  ));
  let write_result = (|| -> Result<(), String> {
    let mut file = OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&temporary_path)
      .map_err(|error| format!("Failed to create temporary icon file: {error}"))?;
    file
      .write_all(bytes)
      .map_err(|error| format!("Failed to write temporary icon file: {error}"))?;
    file
      .sync_all()
      .map_err(|error| format!("Failed to sync temporary icon file: {error}"))?;
    drop(file);
    fs::rename(&temporary_path, path)
      .map_err(|error| format!("Failed to commit cached icon: {error}"))?;
    Ok(())
  })();
  if write_result.is_err() {
    let _ = fs::remove_file(&temporary_path);
  }
  write_result
}

async fn response_bytes_limited(mut response: Response, limit: usize) -> Result<Vec<u8>, String> {
  if let Some(content_length) = response.content_length() {
    if content_length > limit as u64 {
      return Err(format!("Response exceeds the {limit} byte size limit"));
    }
  }

  let mut bytes = Vec::with_capacity(
    response
      .content_length()
      .unwrap_or_default()
      .min(limit as u64) as usize,
  );
  while let Some(chunk) = response
    .chunk()
    .await
    .map_err(|error| format!("Failed to read response body: {error}"))?
  {
    if bytes.len().saturating_add(chunk.len()) > limit {
      return Err(format!("Response exceeds the {limit} byte size limit"));
    }
    bytes.extend_from_slice(&chunk);
  }
  Ok(bytes)
}

async fn fetch_character_resources(client: &Client) -> Result<Vec<CharacterResource>, String> {
  let response = client
    .get(CHARACTER_INFO_URL)
    .send()
    .await
    .map_err(|error| format!("Character resource lookup failed: {error}"))?;
  if !response.status().is_success() {
    return Err(format!(
      "Character resource lookup failed with status {}",
      response.status()
    ));
  }
  let bytes = response_bytes_limited(response, MAX_DIRECTORY_LIST_BYTES).await?;
  let tree: CharacterTree = serde_json::from_slice(&bytes)
    .map_err(|error| format!("Character resource lookup returned invalid data: {error}"))?;
  Ok(parse_character_tree(tree.tree))
}

fn find_character_resource<'a>(
  resources: &'a [CharacterResource],
  speaker_uuid: &str,
) -> Option<&'a CharacterResource> {
  let suffix = format!("_{speaker_uuid}");
  resources
    .iter()
    .find(|resource| resource.directory.ends_with(&suffix))
}

fn resource_url(segments: &[&str]) -> Result<Url, String> {
  let mut url = Url::parse(RAW_CHARACTER_INFO_URL)
    .map_err(|error| format!("Invalid character resource URL: {error}"))?;
  url
    .path_segments_mut()
    .map_err(|_| "Character resource URL cannot contain path segments")?
    .extend(segments);
  Ok(url)
}

fn icon_download_url(directory: &str, style_id: u32) -> Result<Url, String> {
  resource_url(&[directory, "icons", &format!("{style_id}.png")])
}

fn portrait_download_url(directory: &str, style_id: Option<u32>) -> Result<Url, String> {
  match style_id {
    Some(style_id) => resource_url(&[directory, "portraits", &format!("{style_id}.png")]),
    None => resource_url(&[directory, "portrait.png"]),
  }
}

async fn download_png(client: &Client, url: Url) -> Result<Vec<u8>, String> {
  let response = client
    .get(url)
    .send()
    .await
    .map_err(|error| format!("Icon download failed: {error}"))?;
  if !response.status().is_success() {
    return Err(format!(
      "Icon download failed with status {}",
      response.status()
    ));
  }
  let content_type = response
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|value| value.to_str().ok())
    .and_then(|value| value.split(';').next())
    .map(str::trim);
  if content_type != Some("image/png") {
    return Err("Icon response is not a PNG image".into());
  }
  let bytes = response_bytes_limited(response, MAX_ICON_BYTES).await?;
  validate_png(&bytes)?;
  Ok(bytes)
}

fn cached_speaker_icons_at(
  assets_root: &Path,
  requests: Vec<SpeakerIconRequest>,
) -> Vec<SpeakerIconResult> {
  requests
    .iter()
    .map(|request| {
      let path = match speaker_icon_path(assets_root, request) {
        Ok(path) => path,
        Err(error) => return SpeakerIconResult::failed(request, error),
      };
      match read_cached_icon(&path) {
        Ok(Some(bytes)) => SpeakerIconResult::cached(request, &bytes),
        Ok(None) => SpeakerIconResult::missing(request),
        Err(error) => SpeakerIconResult::failed(request, error),
      }
    })
    .collect()
}

fn http_client() -> Result<Client, String> {
  Client::builder()
    .timeout(HTTP_TIMEOUT)
    .user_agent(concat!("Azalea/", env!("CARGO_PKG_VERSION")))
    .build()
    .map_err(|error| format!("Failed to create HTTP client: {error}"))
}

/// Downloads and caches PNG files, returning one result per job in input order.
async fn download_pngs(
  client: &Client,
  assets_root: &Path,
  jobs: Vec<(PathBuf, Url)>,
) -> Vec<Result<Vec<u8>, String>> {
  let mut completed = stream::iter(jobs.into_iter().enumerate())
    .map(|(index, (path, url))| {
      let client = client.clone();
      async move {
        let written = download_png(&client, url).await.and_then(|bytes| {
          write_icon_atomically(assets_root, &path, &bytes)?;
          Ok(bytes)
        });
        (index, written)
      }
    })
    .buffer_unordered(MAX_CONCURRENT_ICON_DOWNLOADS)
    .collect::<Vec<_>>()
    .await;
  completed.sort_by_key(|(index, _)| *index);
  completed.into_iter().map(|(_, written)| written).collect()
}

async fn download_speaker_icons_at(
  assets_root: &Path,
  requests: Vec<SpeakerIconRequest>,
) -> Vec<SpeakerIconResult> {
  let mut results = vec![None; requests.len()];
  let mut pending = Vec::new();

  for (index, request) in requests.iter().enumerate() {
    let path = match speaker_icon_path(assets_root, request) {
      Ok(path) => path,
      Err(error) => {
        results[index] = Some(SpeakerIconResult::failed(request, error));
        continue;
      }
    };
    match read_cached_icon(&path) {
      Ok(Some(bytes)) => results[index] = Some(SpeakerIconResult::cached(request, &bytes)),
      Ok(None) => pending.push((index, path)),
      Err(_) => match remove_invalid_cache_file(&path) {
        Ok(()) => pending.push((index, path)),
        Err(error) => results[index] = Some(SpeakerIconResult::failed(request, error)),
      },
    }
  }

  if !pending.is_empty() {
    let lookup = match http_client() {
      Ok(client) => fetch_character_resources(&client)
        .await
        .map(|resources| (client, resources)),
      Err(error) => Err(error),
    };
    match lookup {
      Err(error) => {
        for (index, _) in pending {
          results[index] = Some(SpeakerIconResult::failed(&requests[index], &error));
        }
      }
      Ok((client, resources)) => {
        let mut jobs = Vec::new();
        let mut job_indices = Vec::new();
        for (index, path) in pending {
          let request = &requests[index];
          if let Ok(Some(bytes)) = read_cached_icon(&path) {
            results[index] = Some(SpeakerIconResult::cached(request, &bytes));
            continue;
          }
          let url = find_character_resource(&resources, &request.speaker_uuid)
            .ok_or_else(|| "No icon resource was found for this speaker".to_owned())
            .and_then(|resource| icon_download_url(&resource.directory, request.style_id));
          match url {
            Ok(url) => {
              jobs.push((path, url));
              job_indices.push(index);
            }
            Err(error) => results[index] = Some(SpeakerIconResult::failed(request, error)),
          }
        }
        let written = download_pngs(&client, assets_root, jobs).await;
        for (index, written) in job_indices.into_iter().zip(written) {
          let request = &requests[index];
          results[index] = Some(match written {
            Ok(bytes) => SpeakerIconResult::cached(request, &bytes),
            Err(error) => SpeakerIconResult::failed(request, error),
          });
        }
      }
    }
  }

  results
    .into_iter()
    .enumerate()
    .map(|(index, result)| {
      result.unwrap_or_else(|| {
        SpeakerIconResult::failed(&requests[index], "Icon download did not complete")
      })
    })
    .collect()
}

/// Downloads each uncached speaker's default and style-specific portraits.
async fn download_speaker_portraits_at(
  assets_root: &Path,
  speaker_uuids: Vec<String>,
) -> Vec<SpeakerPortraitResult> {
  let mut errors: Vec<Option<String>> = vec![None; speaker_uuids.len()];
  let pending: Vec<usize> = (0..speaker_uuids.len())
    .filter(|&index| {
      let uuid = &speaker_uuids[index];
      match validate_speaker_uuid(uuid) {
        Err(error) => {
          errors[index] = Some(error);
          false
        }
        Ok(()) => !portrait_is_cached(assets_root, uuid) && !speaker_uuids[..index].contains(uuid),
      }
    })
    .collect();

  if !pending.is_empty() {
    let lookup = match http_client() {
      Ok(client) => fetch_character_resources(&client)
        .await
        .map(|resources| (client, resources)),
      Err(error) => Err(error),
    };
    match lookup {
      Err(error) => {
        for index in pending {
          errors[index] = Some(error.clone());
        }
      }
      Ok((client, resources)) => {
        let mut jobs = Vec::new();
        let mut job_indices = Vec::new();
        for index in pending {
          let speaker_uuid = &speaker_uuids[index];
          let Some(resource) =
            find_character_resource(&resources, speaker_uuid).filter(|resource| resource.portrait)
          else {
            errors[index] = Some("No portrait resource was found for this speaker".into());
            continue;
          };
          let styles =
            std::iter::once(None).chain(resource.portrait_styles.iter().copied().map(Some));
          for style_id in styles {
            match speaker_portrait_path(assets_root, speaker_uuid, style_id)
              .and_then(|path| Ok((path, portrait_download_url(&resource.directory, style_id)?)))
            {
              Ok(job) => {
                jobs.push(job);
                job_indices.push(index);
              }
              Err(error) => {
                errors[index].get_or_insert(error);
              }
            }
          }
        }
        let written = download_pngs(&client, assets_root, jobs).await;
        for (index, written) in job_indices.into_iter().zip(written) {
          if let Err(error) = written {
            errors[index].get_or_insert(error);
          }
        }
      }
    }
  }

  speaker_uuids
    .into_iter()
    .zip(errors)
    .map(|(speaker_uuid, error)| SpeakerPortraitResult {
      cached: portrait_is_cached(assets_root, &speaker_uuid),
      speaker_uuid,
      error,
    })
    .collect()
}

/// Prefers the style's portrait variant and falls back to the default one.
fn speaker_portrait_at(
  assets_root: &Path,
  request: &SpeakerIconRequest,
) -> Result<Option<String>, String> {
  let variant = speaker_portrait_path(assets_root, &request.speaker_uuid, Some(request.style_id))?;
  if let Ok(Some(bytes)) = read_cached_icon(&variant) {
    return Ok(Some(png_data_url(&bytes)));
  }
  let default = speaker_portrait_path(assets_root, &request.speaker_uuid, None)?;
  Ok(read_cached_icon(&default)?.map(|bytes| png_data_url(&bytes)))
}

fn assets_size_at(assets_root: &Path) -> Result<u64, String> {
  match fs::symlink_metadata(assets_root) {
    Err(error) if error.kind() == ErrorKind::NotFound => return Ok(0),
    Err(error) => return Err(format!("Failed to inspect assets directory: {error}")),
    Ok(metadata) if !metadata.file_type().is_dir() => return Ok(0),
    Ok(_) => {}
  }

  let mut size = 0_u64;
  for entry in walkdir::WalkDir::new(assets_root).follow_links(false) {
    let entry = entry.map_err(|error| format!("Failed to inspect saved assets: {error}"))?;
    if entry.file_type().is_file() {
      let length = entry
        .metadata()
        .map_err(|error| format!("Failed to inspect saved asset: {error}"))?
        .len();
      size = size
        .checked_add(length)
        .ok_or("Saved asset size exceeds the supported range")?;
    }
  }
  Ok(size)
}

fn clear_assets_at(assets_root: &Path) -> Result<(), String> {
  let metadata = match fs::symlink_metadata(assets_root) {
    Ok(metadata) => metadata,
    Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
    Err(error) => return Err(format!("Failed to inspect assets directory: {error}")),
  };
  if metadata.file_type().is_dir() {
    fs::remove_dir_all(assets_root)
      .map_err(|error| format!("Failed to clear saved assets: {error}"))
  } else {
    fs::remove_file(assets_root).map_err(|error| format!("Failed to clear saved assets: {error}"))
  }
}

#[tauri::command]
#[specta::specta]
pub async fn get_cached_speaker_icons(
  requests: Vec<SpeakerIconRequest>,
) -> Result<Vec<SpeakerIconResult>, String> {
  let _operation = ASSET_OPERATION_LOCK.lock().await;
  Ok(cached_speaker_icons_at(&assets_dir(), requests))
}

#[tauri::command]
#[specta::specta]
pub async fn download_speaker_icons(
  requests: Vec<SpeakerIconRequest>,
) -> Result<Vec<SpeakerIconResult>, String> {
  let _operation = ASSET_OPERATION_LOCK.lock().await;
  Ok(download_speaker_icons_at(&assets_dir(), requests).await)
}

#[tauri::command]
#[specta::specta]
pub async fn download_speaker_portraits(
  speaker_uuids: Vec<String>,
) -> Result<Vec<SpeakerPortraitResult>, String> {
  let _operation = ASSET_OPERATION_LOCK.lock().await;
  Ok(download_speaker_portraits_at(&assets_dir(), speaker_uuids).await)
}

#[tauri::command]
#[specta::specta]
pub async fn get_speaker_portrait(request: SpeakerIconRequest) -> Result<Option<String>, String> {
  let _operation = ASSET_OPERATION_LOCK.lock().await;
  speaker_portrait_at(&assets_dir(), &request)
}

#[tauri::command]
#[specta::specta]
pub async fn get_assets_size() -> Result<u64, String> {
  let _operation = ASSET_OPERATION_LOCK.lock().await;
  assets_size_at(&assets_dir())
}

#[tauri::command]
#[specta::specta]
pub async fn clear_assets() -> Result<(), String> {
  let _operation = ASSET_OPERATION_LOCK.lock().await;
  clear_assets_at(&assets_dir())
}

#[cfg(test)]
mod tests {
  use super::*;

  const VALID_PNG: &[u8] = b"\x89PNG\r\n\x1a\nfixture";

  fn request(speaker_uuid: &str, style_id: u32) -> SpeakerIconRequest {
    SpeakerIconRequest {
      speaker_uuid: speaker_uuid.into(),
      style_id,
    }
  }

  #[test]
  fn cache_path_rejects_filename_traversal() {
    let root = Path::new("assets");
    for invalid in ["", "../speaker", "/speaker", "speaker.png", "声"] {
      assert!(speaker_icon_path(root, &request(invalid, 1)).is_err());
    }

    assert_eq!(
      speaker_icon_path(root, &request("speaker_01-uuid", 42)).unwrap(),
      root.join("speaker-icons/speaker_01-uuid-42.png")
    );
  }

  #[test]
  fn cached_icons_require_small_regular_png_files() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("assets");
    let valid_request = request("valid-speaker", 1);
    let invalid_request = request("invalid-speaker", 2);
    let oversized_request = request("oversized-speaker", 3);
    let valid_path = speaker_icon_path(&root, &valid_request).unwrap();
    let invalid_path = speaker_icon_path(&root, &invalid_request).unwrap();
    let oversized_path = speaker_icon_path(&root, &oversized_request).unwrap();
    fs::create_dir_all(valid_path.parent().unwrap()).unwrap();
    fs::write(&valid_path, VALID_PNG).unwrap();
    fs::write(&invalid_path, b"not png").unwrap();
    fs::File::create(&oversized_path)
      .unwrap()
      .set_len(MAX_ICON_BYTES as u64 + 1)
      .unwrap();

    let results = cached_speaker_icons_at(
      &root,
      vec![
        valid_request.clone(),
        invalid_request.clone(),
        oversized_request.clone(),
        request("missing", 4),
      ],
    );

    assert!(results[0]
      .data_url
      .as_deref()
      .unwrap()
      .starts_with("data:image/png;base64,"));
    assert_eq!(results[0].error, None);
    assert_eq!(results[1].data_url, None);
    assert!(results[1]
      .error
      .as_deref()
      .unwrap()
      .contains("PNG signature"));
    assert_eq!(results[2].data_url, None);
    assert!(results[2].error.as_deref().unwrap().contains("size limit"));
    assert_eq!(
      results[3],
      SpeakerIconResult::missing(&request("missing", 4))
    );
  }

  #[test]
  fn icon_writes_are_atomic_and_leave_no_temporary_file() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("assets");
    let path = speaker_icon_path(&root, &request("speaker", 7)).unwrap();

    write_icon_atomically(&root, &path, VALID_PNG).unwrap();

    assert_eq!(fs::read(&path).unwrap(), VALID_PNG);
    let entries = fs::read_dir(path.parent().unwrap())
      .unwrap()
      .collect::<Result<Vec<_>, _>>()
      .unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].path(), path);
  }

  #[test]
  fn asset_size_and_clear_cover_the_whole_tree() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("assets");
    let config_path = directory.path().join("config.toml");
    fs::create_dir_all(root.join("speaker-icons")).unwrap();
    fs::create_dir_all(root.join("other/nested")).unwrap();
    fs::write(&config_path, b"config").unwrap();
    fs::write(root.join("speaker-icons/one.png"), [0_u8; 11]).unwrap();
    fs::write(root.join("other/nested/two.bin"), [0_u8; 7]).unwrap();

    assert_eq!(assets_size_at(&root).unwrap(), 18);
    clear_assets_at(&root).unwrap();
    assert_eq!(assets_size_at(&root).unwrap(), 0);
    assert_eq!(fs::read(&config_path).unwrap(), b"config");
    clear_assets_at(&root).unwrap();
  }

  #[cfg(unix)]
  #[test]
  fn asset_size_and_clear_do_not_follow_symlinks() {
    use std::os::unix::fs::symlink;

    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("assets");
    let outside = directory.path().join("outside");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&outside).unwrap();
    fs::write(root.join("inside.bin"), [0_u8; 3]).unwrap();
    fs::write(outside.join("preserved.bin"), [0_u8; 101]).unwrap();
    symlink(&outside, root.join("linked-outside")).unwrap();

    assert_eq!(assets_size_at(&root).unwrap(), 3);
    clear_assets_at(&root).unwrap();

    assert_eq!(fs::read(outside.join("preserved.bin")).unwrap().len(), 101);
  }

  fn tree_entry(path: &str, kind: &str) -> CharacterTreeEntry {
    CharacterTreeEntry {
      path: path.into(),
      kind: kind.into(),
    }
  }

  fn resource(directory: &str) -> CharacterResource {
    CharacterResource {
      directory: directory.into(),
      ..Default::default()
    }
  }

  #[test]
  fn directory_matching_requires_the_complete_uuid_suffix() {
    let resources = vec![
      resource("001_not-the-speaker"),
      resource("002_target-speaker-extra"),
      resource("003_target-speaker"),
    ];

    assert_eq!(
      find_character_resource(&resources, "target-speaker").map(|r| r.directory.as_str()),
      Some("003_target-speaker")
    );
  }

  #[test]
  fn character_tree_lists_default_and_style_portraits() {
    let resources = parse_character_tree(vec![
      tree_entry("A_one", "tree"),
      tree_entry("A_one/icons", "tree"),
      tree_entry("A_one/icons/1.png", "blob"),
      tree_entry("A_one/portrait.png", "blob"),
      tree_entry("A_one/portraits", "tree"),
      tree_entry("A_one/portraits/3.png", "blob"),
      tree_entry("A_one/portraits/30.png", "blob"),
      tree_entry("A_one/portraits/readme.md", "blob"),
      tree_entry("A_one/portraits/x.png", "blob"),
      tree_entry("B_two", "tree"),
      tree_entry("B_two/policy.md", "blob"),
      tree_entry("orphan/portrait.png", "blob"),
      tree_entry("README.md", "blob"),
    ]);

    assert_eq!(
      resources,
      vec![
        CharacterResource {
          directory: "A_one".into(),
          portrait: true,
          portrait_styles: vec![3, 30],
        },
        resource("B_two"),
      ]
    );
  }

  #[test]
  fn portrait_paths_reject_traversal_and_resource_urls_are_encoded() {
    let root = Path::new("assets");
    assert!(speaker_portrait_path(root, "../speaker", None).is_err());
    assert_eq!(
      speaker_portrait_path(root, "speaker", None).unwrap(),
      root.join("speaker-portraits/speaker/portrait.png")
    );
    assert_eq!(
      speaker_portrait_path(root, "speaker", Some(3)).unwrap(),
      root.join("speaker-portraits/speaker/3.png")
    );
    assert!(portrait_download_url("ず_a", None)
      .unwrap()
      .as_str()
      .ends_with("/character_info/%E3%81%9A_a/portrait.png"));
    assert!(portrait_download_url("a b", Some(7))
      .unwrap()
      .as_str()
      .ends_with("/character_info/a%20b/portraits/7.png"));
  }

  #[test]
  fn portraits_prefer_style_variants_and_fall_back_to_the_default() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("assets");
    let default = speaker_portrait_path(&root, "speaker", None).unwrap();
    let variant = speaker_portrait_path(&root, "speaker", Some(3)).unwrap();
    let variant_png = b"\x89PNG\r\n\x1a\nvariant";

    assert_eq!(
      speaker_portrait_at(&root, &request("speaker", 1)).unwrap(),
      None
    );
    assert!(!portrait_is_cached(&root, "speaker"));

    write_icon_atomically(&root, &default, VALID_PNG).unwrap();
    write_icon_atomically(&root, &variant, variant_png).unwrap();
    assert!(portrait_is_cached(&root, "speaker"));
    assert_eq!(
      speaker_portrait_at(&root, &request("speaker", 1)).unwrap(),
      Some(png_data_url(VALID_PNG))
    );
    assert_eq!(
      speaker_portrait_at(&root, &request("speaker", 3)).unwrap(),
      Some(png_data_url(variant_png))
    );

    // A corrupt variant still falls back to the valid default portrait.
    fs::write(&variant, b"not png").unwrap();
    assert_eq!(
      speaker_portrait_at(&root, &request("speaker", 3)).unwrap(),
      Some(png_data_url(VALID_PNG))
    );
    fs::write(&default, b"not png").unwrap();
    assert!(speaker_portrait_at(&root, &request("speaker", 1)).is_err());
    assert!(speaker_portrait_at(&root, &request("../x", 1)).is_err());
  }

  #[test]
  fn portrait_downloads_skip_cached_duplicate_and_invalid_speakers() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("assets");
    write_icon_atomically(
      &root,
      &speaker_portrait_path(&root, "cached", None).unwrap(),
      VALID_PNG,
    )
    .unwrap();

    // Every speaker is cached, duplicated or invalid, so no lookup is made.
    let results = tauri::async_runtime::block_on(download_speaker_portraits_at(
      &root,
      vec!["cached".into(), "cached".into(), "../bad".into()],
    ));
    assert_eq!(
      results,
      vec![
        SpeakerPortraitResult {
          speaker_uuid: "cached".into(),
          cached: true,
          error: None,
        },
        SpeakerPortraitResult {
          speaker_uuid: "cached".into(),
          cached: true,
          error: None,
        },
        SpeakerPortraitResult {
          speaker_uuid: "../bad".into(),
          cached: false,
          error: Some("Speaker UUID contains invalid filename characters".into()),
        },
      ]
    );
  }

  #[test]
  fn writes_outside_the_asset_root_are_rejected() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("assets");
    assert!(write_icon_atomically(&root, &directory.path().join("x.png"), VALID_PNG).is_err());
  }
}
