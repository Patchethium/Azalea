use crate::config::manager::assets_dir;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use reqwest::{Client, Response, Url};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;

const CHARACTER_INFO_URL: &str =
  "https://api.github.com/repos/VOICEVOX/voicevox_resource/contents/character_info?ref=main";
const RAW_CHARACTER_INFO_URL: &str =
  "https://raw.githubusercontent.com/VOICEVOX/voicevox_resource/main/character_info";
const MAX_ICON_BYTES: usize = 2 * 1024 * 1024;
const MAX_DIRECTORY_LIST_BYTES: usize = 2 * 1024 * 1024;
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

impl SpeakerIconResult {
  fn cached(request: &SpeakerIconRequest, bytes: &[u8]) -> Self {
    Self {
      speaker_uuid: request.speaker_uuid.clone(),
      data_url: Some(format!(
        "data:image/png;base64,{}",
        BASE64_STANDARD.encode(bytes)
      )),
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

#[derive(Deserialize)]
struct CharacterInfoEntry {
  name: String,
  #[serde(rename = "type")]
  kind: String,
}

fn speaker_icon_dir(assets_root: &Path) -> PathBuf {
  assets_root.join("speaker-icons")
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
  ensure_directory(&speaker_icon_dir(assets_root))?;

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

async fn fetch_character_directories(client: &Client) -> Result<Vec<String>, String> {
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
  let entries: Vec<CharacterInfoEntry> = serde_json::from_slice(&bytes)
    .map_err(|error| format!("Character resource lookup returned invalid data: {error}"))?;
  Ok(
    entries
      .into_iter()
      .filter(|entry| entry.kind == "dir")
      .map(|entry| entry.name)
      .collect(),
  )
}

fn find_character_directory<'a>(directories: &'a [String], speaker_uuid: &str) -> Option<&'a str> {
  let suffix = format!("_{speaker_uuid}");
  directories
    .iter()
    .find(|directory| directory.ends_with(&suffix))
    .map(String::as_str)
}

fn icon_download_url(directory: &str, style_id: u32) -> Result<Url, String> {
  let mut url = Url::parse(RAW_CHARACTER_INFO_URL)
    .map_err(|error| format!("Invalid icon resource URL: {error}"))?;
  url
    .path_segments_mut()
    .map_err(|_| "Icon resource URL cannot contain path segments")?
    .extend([directory, "icons", &format!("{style_id}.png")]);
  Ok(url)
}

async fn download_icon(client: &Client, directory: &str, style_id: u32) -> Result<Vec<u8>, String> {
  let response = client
    .get(icon_download_url(directory, style_id)?)
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
    let client = Client::builder()
      .timeout(HTTP_TIMEOUT)
      .user_agent(concat!("Azalea/", env!("CARGO_PKG_VERSION")))
      .build();
    match client {
      Err(error) => {
        for (index, _) in pending {
          results[index] = Some(SpeakerIconResult::failed(
            &requests[index],
            format!("Failed to create HTTP client: {error}"),
          ));
        }
      }
      Ok(client) => match fetch_character_directories(&client).await {
        Err(error) => {
          for (index, _) in pending {
            results[index] = Some(SpeakerIconResult::failed(&requests[index], &error));
          }
        }
        Ok(directories) => {
          for (index, path) in pending {
            let request = &requests[index];
            if let Ok(Some(bytes)) = read_cached_icon(&path) {
              results[index] = Some(SpeakerIconResult::cached(request, &bytes));
              continue;
            }
            let Some(directory) = find_character_directory(&directories, &request.speaker_uuid)
            else {
              results[index] = Some(SpeakerIconResult::failed(
                request,
                "No icon resource was found for this speaker",
              ));
              continue;
            };
            results[index] = Some(
              match download_icon(&client, directory, request.style_id).await {
                Ok(bytes) => match write_icon_atomically(assets_root, &path, &bytes) {
                  Ok(()) => SpeakerIconResult::cached(request, &bytes),
                  Err(error) => SpeakerIconResult::failed(request, error),
                },
                Err(error) => SpeakerIconResult::failed(request, error),
              },
            );
          }
        }
      },
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
    let valid_path = speaker_icon_path(&root, &valid_request).unwrap();
    let invalid_path = speaker_icon_path(&root, &invalid_request).unwrap();
    fs::create_dir_all(valid_path.parent().unwrap()).unwrap();
    fs::write(&valid_path, VALID_PNG).unwrap();
    fs::write(&invalid_path, b"not png").unwrap();

    let results = cached_speaker_icons_at(
      &root,
      vec![
        valid_request.clone(),
        invalid_request.clone(),
        request("missing", 3),
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
    assert_eq!(
      results[2],
      SpeakerIconResult::missing(&request("missing", 3))
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
    fs::create_dir_all(root.join("speaker-icons")).unwrap();
    fs::create_dir_all(root.join("other/nested")).unwrap();
    fs::write(root.join("speaker-icons/one.png"), [0_u8; 11]).unwrap();
    fs::write(root.join("other/nested/two.bin"), [0_u8; 7]).unwrap();

    assert_eq!(assets_size_at(&root).unwrap(), 18);
    clear_assets_at(&root).unwrap();
    assert_eq!(assets_size_at(&root).unwrap(), 0);
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

  #[test]
  fn directory_matching_requires_the_complete_uuid_suffix() {
    let directories = vec![
      "001_not-the-speaker".into(),
      "002_target-speaker-extra".into(),
      "003_target-speaker".into(),
    ];

    assert_eq!(
      find_character_directory(&directories, "target-speaker"),
      Some("003_target-speaker")
    );
  }
}
