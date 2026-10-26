//! Optional downloads that keep the bundle small: the Noto Sans CJK fonts for
//! the embedded-font setting and the e2k English reading models. Only pinned
//! files are fetched; no URL or destination path crosses IPC.
use super::downloads::{
  commit, directory, fetch_file, remove_owned_path, verified_file, FileCheck, VerifiedFiles,
};
use crate::async_job::JobCancellation;
use crate::config::manager::{english_models_dir, fonts_dir};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri_specta::Event;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
pub enum ExtraPack {
  Fonts,
  EnglishModels,
}

pub(crate) struct ExtraFile {
  pub(crate) name: &'static str,
  url: &'static str,
  pub(crate) bytes: u64,
  sha256: &'static str,
}

const FONT_FILES: &[ExtraFile] = &[
  ExtraFile {
    name: "NotoSansJP-VF.otf",
    url: "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/Variable/OTF/Subset/NotoSansJP-VF.otf",
    bytes: 8128756,
    sha256: "85e5ef353081175fb9f764f037c550dd4b5ad913cb030c0de98a5d4d4018014b",
  },
  ExtraFile {
    name: "NotoSansSC-VF.otf",
    url: "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/Variable/OTF/Subset/NotoSansSC-VF.otf",
    bytes: 15054748,
    sha256: "d13ed01ec8aa45d6178999b648e96fb92150683e9f8e2a581f2acf208dcbe44b",
  },
  ExtraFile {
    name: "LICENSE",
    url: "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/LICENSE",
    bytes: 4301,
    sha256: "6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2",
  },
];

/// The models of the e2k tag `Cargo.toml` pins.
const ENGLISH_MODEL_FILES: &[ExtraFile] = &[
  ExtraFile {
    name: "model-c2k.safetensors",
    url: "https://raw.githubusercontent.com/Patchethium/e2k/v0.8.2/src/e2k/models/model-c2k.safetensors",
    bytes: 4449744,
    sha256: "ffc05e3a27be0e167e240d529ea1d60fa6db626f6eafafaed366a4fac09d8f71",
  },
  ExtraFile {
    name: "model-c2k-turbo.safetensors",
    url: "https://raw.githubusercontent.com/Patchethium/e2k/v0.8.2/src/e2k/models/model-c2k-turbo.safetensors",
    bytes: 1145264,
    sha256: "fea9de9ac0de35f313fb5652967ae3d750a68a46a2ce2d28879a73532729be08",
  },
  ExtraFile {
    name: "accent.safetensors",
    url: "https://raw.githubusercontent.com/Patchethium/e2k/v0.8.2/src/e2k/models/accent.safetensors",
    bytes: 1625242,
    sha256: "179c99c99be03fdcd18f7aac809a683e7b1e56402153d9fba532692440204138",
  },
  ExtraFile {
    name: "ngram.json.zip",
    url: "https://raw.githubusercontent.com/Patchethium/e2k/v0.8.2/src/e2k/models/ngram.json.zip",
    bytes: 667590,
    sha256: "475e573aa9ffb30e2b27a1cabfb907ca7ff3ea19b75cdc6e0d501bc4326742a2",
  },
];

impl ExtraPack {
  const ALL: [ExtraPack; 2] = [ExtraPack::Fonts, ExtraPack::EnglishModels];

  pub(crate) fn files(self) -> &'static [ExtraFile] {
    match self {
      ExtraPack::Fonts => FONT_FILES,
      ExtraPack::EnglishModels => ENGLISH_MODEL_FILES,
    }
  }

  pub(crate) fn directory(self) -> Result<std::path::PathBuf, String> {
    match self {
      ExtraPack::Fonts => fonts_dir(),
      ExtraPack::EnglishModels => english_models_dir(),
    }
  }

  fn bytes(self) -> u64 {
    self.files().iter().map(|file| file.bytes).sum()
  }
}

#[derive(Clone, Serialize, Type)]
pub struct ExtraStatus {
  pub pack: ExtraPack,
  pub bytes: u64,
  pub installed: bool,
}

#[derive(Clone, Serialize, Deserialize, Type, Event)]
pub struct ExtraDownloadProgressEvent {
  pub operation_id: String,
  pub pack: ExtraPack,
  pub completed_bytes: u64,
  pub total_bytes: u64,
}

/// One download per pack; both packs may download at the same time.
static OPERATIONS: LazyLock<Mutex<HashMap<ExtraPack, (String, Arc<JobCancellation>)>>> =
  LazyLock::new(Mutex::default);

struct Operation(ExtraPack);
impl Drop for Operation {
  fn drop(&mut self) {
    OPERATIONS.lock().unwrap().remove(&self.0);
  }
}

/// Cheap presence check, by name and size, for hot paths. Downloads are
/// verified before they are moved into place.
pub(crate) fn files_present(root: &Path, files: &[ExtraFile]) -> bool {
  files.iter().all(|file| {
    fs::symlink_metadata(root.join(file.name))
      .is_ok_and(|m| m.file_type().is_file() && m.len() == file.bytes)
  })
}

pub(crate) fn pack_present(pack: ExtraPack) -> bool {
  pack
    .directory()
    .is_ok_and(|root| files_present(&root, pack.files()))
}

fn installed_at(root: &Path, files: &[ExtraFile]) -> bool {
  let checks: Vec<_> = files
    .iter()
    .map(|file| FileCheck {
      path: root.join(file.name),
      bytes: file.bytes,
      sha256: file.sha256.to_owned(),
    })
    .collect();
  let mut verified = VerifiedFiles::load(root);
  let installed = verified.check_all(&checks).into_iter().all(|valid| valid);
  verified.save();
  installed
}

async fn download_at(
  root: &Path,
  client: &reqwest::Client,
  files: &[ExtraFile],
  cancellation: &JobCancellation,
  progress: impl Fn(u64),
) -> Result<(), String> {
  directory(root)?;
  let staging = root.join(".staging");
  remove_owned_path(&staging)?;
  directory(&staging)?;
  let result = async {
    let mut completed = 0;
    for file in files {
      let destination = root.join(file.name);
      if !verified_file(&destination, file.bytes, file.sha256) {
        let path = staging.join(file.name);
        fetch_file(
          client,
          file.url,
          &path,
          file.bytes,
          file.sha256,
          cancellation,
          |n| progress(completed + n),
        )
        .await?;
        commit(&path, &destination, cancellation)?;
      }
      completed += file.bytes;
      progress(completed);
    }
    Ok(())
  }
  .await;
  let cleanup = remove_owned_path(&staging);
  result.and(cleanup)
}

/// Removes every downloaded pack; part of clearing the asset cache.
pub(crate) fn clear_extras() -> Result<(), String> {
  for pack in ExtraPack::ALL {
    remove_owned_path(&pack.directory()?)?;
  }
  Ok(())
}

pub(crate) fn extras_size() -> Result<u64, String> {
  let mut size = 0;
  for pack in ExtraPack::ALL {
    let root = pack.directory()?;
    for file in pack.files() {
      if let Ok(metadata) = fs::symlink_metadata(root.join(file.name)) {
        if metadata.file_type().is_file() {
          size += metadata.len();
        }
      }
    }
  }
  Ok(size)
}

#[tauri::command]
#[specta::specta]
pub async fn get_extras_status() -> Result<Vec<ExtraStatus>, String> {
  let roots = ExtraPack::ALL
    .into_iter()
    .map(|pack| Ok((pack, pack.directory()?)))
    .collect::<Result<Vec<_>, String>>()?;
  tauri::async_runtime::spawn_blocking(move || {
    roots
      .into_iter()
      .map(|(pack, root)| ExtraStatus {
        pack,
        bytes: pack.bytes(),
        installed: installed_at(&root, pack.files()),
      })
      .collect()
  })
  .await
  .map_err(|e| e.to_string())
}

/// Downloads a pack and returns whether it was cancelled.
#[tauri::command]
#[specta::specta]
pub async fn download_extra(
  app: tauri::AppHandle,
  operation_id: String,
  pack: ExtraPack,
) -> Result<bool, String> {
  uuid::Uuid::parse_str(&operation_id).map_err(|_| "Invalid download operation ID")?;
  let root = pack.directory()?;
  let client = reqwest::Client::builder()
    .user_agent("Azalea downloader")
    .connect_timeout(Duration::from_secs(20))
    .read_timeout(Duration::from_secs(30))
    .https_only(true)
    .build()
    .map_err(|e| e.to_string())?;
  let cancellation = Arc::new(JobCancellation::default());
  {
    let mut running = OPERATIONS.lock().unwrap();
    if running.contains_key(&pack) {
      return Err("This download is already running".into());
    }
    running.insert(pack, (operation_id.clone(), cancellation.clone()));
  }
  let _operation = Operation(pack);
  let total = pack.bytes();
  let last_event = Mutex::new(Instant::now() - Duration::from_secs(1));
  let result = download_at(&root, &client, pack.files(), &cancellation, |completed| {
    let mut last = last_event.lock().unwrap();
    if completed == total || last.elapsed() >= Duration::from_millis(100) {
      let _ = ExtraDownloadProgressEvent {
        operation_id: operation_id.clone(),
        pack,
        completed_bytes: completed,
        total_bytes: total,
      }
      .emit(&app);
      *last = Instant::now();
    }
  })
  .await;
  if cancellation.is_cancelled() {
    return Ok(true);
  }
  result.map(|_| false)
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_extra_download(operation_id: String) -> Result<(), String> {
  let running = OPERATIONS.lock().map_err(|e| e.to_string())?;
  if let Some((_, cancellation)) = running.values().find(|(id, _)| *id == operation_id) {
    cancellation.cancel();
  }
  Ok(())
}

/// Serves the downloaded fonts to the webview through the `azalea-font` scheme.
pub(crate) fn font_response(path: &str) -> tauri::http::Response<Vec<u8>> {
  let not_found = || {
    tauri::http::Response::builder()
      .status(404)
      .body(Vec::new())
      .unwrap()
  };
  let name = path.trim_start_matches('/');
  let Some(file) = FONT_FILES
    .iter()
    .find(|file| file.name == name && file.name.ends_with(".otf"))
  else {
    return not_found();
  };
  let Ok(root) = fonts_dir() else {
    return not_found();
  };
  let path = root.join(file.name);
  if !fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_file()) {
    return not_found();
  }
  match fs::read(path) {
    Ok(bytes) => tauri::http::Response::builder()
      .header("Content-Type", "font/otf")
      // The page origin differs from the scheme's, and fonts require CORS.
      .header("Access-Control-Allow-Origin", "*")
      .body(bytes)
      .unwrap(),
    Err(_) => not_found(),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use sha2::{Digest, Sha256};
  use std::io::{Read, Write};
  use std::net::TcpListener;

  #[test]
  fn packs_pin_https_files_with_checksums() {
    for pack in ExtraPack::ALL {
      assert!(!pack.files().is_empty());
      for file in pack.files() {
        assert!(file.url.starts_with("https://raw.githubusercontent.com/"));
        assert!(file.url.ends_with(file.name));
        assert_eq!(file.sha256.len(), 64);
        assert!(file.bytes > 0);
      }
    }
    assert!(ENGLISH_MODEL_FILES
      .iter()
      .all(|file| file.url.contains("/e2k/v0.8.2/")));
  }

  #[test]
  fn presence_checks_names_and_sizes_and_installation_checks_hashes() {
    let root = tempfile::tempdir().unwrap();
    let file = ExtraFile {
      name: "model.bin",
      url: "",
      bytes: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    };
    let files = std::slice::from_ref(&file);
    assert!(!files_present(root.path(), files));
    assert!(!installed_at(root.path(), files));
    fs::write(root.path().join("model.bin"), b"HELLO").unwrap();
    assert!(files_present(root.path(), files));
    assert!(!installed_at(root.path(), files));
    fs::write(root.path().join("model.bin"), b"hello").unwrap();
    assert!(installed_at(root.path(), files));
    fs::write(root.path().join("model.bin"), b"hi").unwrap();
    assert!(!files_present(root.path(), files));
  }

  fn serve(bodies: Vec<&'static [u8]>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    std::thread::spawn(move || {
      for body in bodies {
        let (mut socket, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        socket.read(&mut request).unwrap();
        let header = format!(
          "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
          body.len()
        );
        socket.write_all(header.as_bytes()).unwrap();
        socket.write_all(body).unwrap();
      }
    });
    format!("http://{address}")
  }

  fn leak(value: String) -> &'static str {
    Box::leak(value.into_boxed_str())
  }

  #[test]
  fn download_fetches_missing_files_skips_verified_ones_and_cleans_staging() {
    tauri::async_runtime::block_on(async {
      let root = tempfile::tempdir().unwrap();
      let url = serve(vec![b"world"]);
      let digest = |body: &[u8]| leak(format!("{:x}", Sha256::digest(body)));
      let files = [
        ExtraFile {
          name: "kept.bin",
          url: "http://127.0.0.1:1",
          bytes: 5,
          sha256: digest(b"hello"),
        },
        ExtraFile {
          name: "fetched.bin",
          url: leak(url),
          bytes: 5,
          sha256: digest(b"world"),
        },
      ];
      fs::write(root.path().join("kept.bin"), b"hello").unwrap();
      let progress = Mutex::new(Vec::new());
      download_at(
        root.path(),
        &reqwest::Client::new(),
        &files,
        &JobCancellation::default(),
        |n| progress.lock().unwrap().push(n),
      )
      .await
      .unwrap();
      assert_eq!(fs::read(root.path().join("fetched.bin")).unwrap(), b"world");
      assert!(!root.path().join(".staging").exists());
      let progress = progress.into_inner().unwrap();
      assert_eq!(progress.first(), Some(&5));
      assert_eq!(progress.last(), Some(&10));
      assert!(installed_at(root.path(), &files));
    });
  }

  #[test]
  fn failed_and_cancelled_downloads_leave_no_partial_files() {
    tauri::async_runtime::block_on(async {
      let root = tempfile::tempdir().unwrap();
      let url = serve(vec![b"wrong"]);
      let file = ExtraFile {
        name: "model.bin",
        url: leak(url),
        bytes: 5,
        sha256: leak(format!("{:x}", Sha256::digest(b"world"))),
      };
      let files = std::slice::from_ref(&file);
      let client = reqwest::Client::new();
      assert!(download_at(
        root.path(),
        &client,
        files,
        &JobCancellation::default(),
        |_| {}
      )
      .await
      .is_err());
      assert!(!root.path().join("model.bin").exists());
      assert!(!root.path().join(".staging").exists());
      let cancellation = JobCancellation::default();
      cancellation.cancel();
      assert!(
        download_at(root.path(), &client, files, &cancellation, |_| {})
          .await
          .is_err()
      );
      assert!(!root.path().join("model.bin").exists());
    });
  }

  #[test]
  fn font_scheme_serves_only_listed_font_files() {
    for path in ["/LICENSE", "/../config.toml", "/missing.otf", ""] {
      assert_eq!(font_response(path).status(), 404, "{path}");
    }
  }
}
