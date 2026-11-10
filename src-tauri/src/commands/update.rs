//! In-app updates from the GitHub releases the publish workflow creates.
//!
//! The updater plugin fetches the release manifest, verifies the package
//! against the public key in `tauri.conf.json` and installs it. No URL crosses
//! IPC, and the plugin's own commands stay unreachable because no capability
//! grants them.
use crate::async_job::JobCancellation;
use futures_util::future::{select, Either};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::Path;
use std::pin::pin;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::utils::config::BundleType;
use tauri::{AppHandle, Manager, Runtime, State, Url};
use tauri_plugin_updater::{Error, Update, UpdaterExt};
use tauri_specta::Event;

/// The page of a release; the publish workflow tags releases `app-v{version}`.
const RELEASE_PAGE: &str = "https://github.com/Patchethium/Azalea/releases/tag/app-v";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Type)]
pub struct AvailableUpdate {
  pub version: String,
  pub current_version: String,
  /// Whether Azalea can download and install the update itself. Otherwise the
  /// user installs it from `release_url`.
  pub installable: bool,
  pub release_url: String,
}

#[derive(Clone, Serialize, Deserialize, Type, Event)]
pub struct UpdateDownloadProgressEvent {
  pub operation_id: String,
  pub completed_bytes: u64,
  /// Unknown when the server does not announce the size.
  pub total_bytes: Option<u64>,
}

struct PendingUpdate {
  update: Update,
  /// The downloaded package, already verified against the update's signature.
  package: Option<Arc<Vec<u8>>>,
}

#[derive(Default)]
pub struct UpdateState {
  pending: Mutex<Option<PendingUpdate>>,
  download: Mutex<Option<(String, Arc<JobCancellation>)>>,
}

struct Download<'a>(&'a UpdateState);
impl Drop for Download<'_> {
  fn drop(&mut self) {
    self.0.download.lock().unwrap().take();
  }
}

/// Where development builds look for updates, if anywhere. They never check
/// the real releases: a development build carries the version it was built
/// from and is not an installation an update could replace.
fn development_endpoint() -> Option<Url> {
  std::env::var("AZALEA_DEV_UPDATE_ENDPOINT")
    .ok()
    .and_then(|url| url.parse().ok())
}

fn supported() -> bool {
  !cfg!(debug_assertions) || development_endpoint().is_some()
}

/// Whether an installation of this kind can be replaced in place.
///
/// `.deb` and `.rpm` packages belong to the system's package manager and
/// unbundled binaries have no installer, so those are pointed at the release
/// page. An AppImage's contents run outside their image when extracted, and a
/// macOS binary may run outside an application bundle; neither can be
/// replaced by the package either.
fn installable_as(bundle: Option<BundleType>, in_appimage: bool, executable: &Path) -> bool {
  match bundle {
    Some(BundleType::AppImage) => in_appimage,
    Some(BundleType::Msi | BundleType::Nsis) => true,
    Some(BundleType::App | BundleType::Dmg) => {
      let mut parents = executable.ancestors().skip(1);
      parents.next().is_some_and(|dir| dir.ends_with("MacOS"))
        && parents.next().is_some_and(|dir| dir.ends_with("Contents"))
        && parents
          .next()
          .is_some_and(|dir| dir.extension().is_some_and(|ext| ext == "app"))
    }
    Some(BundleType::Deb | BundleType::Rpm) | None => false,
  }
}

fn installable<R: Runtime>(app: &AppHandle<R>) -> bool {
  if cfg!(debug_assertions) {
    return false;
  }
  #[cfg(target_os = "linux")]
  let in_appimage = app.env().appimage.is_some();
  #[cfg(not(target_os = "linux"))]
  let in_appimage = {
    let _ = app;
    false
  };
  tauri::utils::platform::current_exe().is_ok_and(|executable| {
    installable_as(
      tauri::utils::platform::bundle_type(),
      in_appimage,
      &executable,
    )
  })
}

fn release_url(version: &str) -> String {
  format!("{RELEASE_PAGE}{version}")
}

/// Looks for a newer release, at `endpoints` instead of the configured ones
/// when given, and remembers it for `download` and `install`.
async fn check<R: Runtime>(
  app: &AppHandle<R>,
  state: &UpdateState,
  endpoints: Option<Vec<Url>>,
  installable: bool,
) -> Result<Option<AvailableUpdate>, String> {
  // The plugin compares versions before it looks for this platform's package,
  // so a newer release without one is still worth announcing.
  let announced = Arc::new(Mutex::new(None::<String>));
  let seen = announced.clone();
  let mut builder = app
    .updater_builder()
    .version_comparator(move |current, release| {
      let newer = release.version > current;
      if newer {
        seen.lock().unwrap().replace(release.version.to_string());
      }
      newer
    })
    .timeout(Duration::from_secs(30))
    // The check's timeout does not cover the download; do not let a stalled
    // one hang forever.
    .configure_client(|client| {
      client
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(30))
    });
  if let Some(endpoints) = endpoints {
    builder = builder.endpoints(endpoints).map_err(|e| e.to_string())?;
  }
  let updater = builder.build().map_err(|e| e.to_string())?;
  let current_version = app.package_info().version.to_string();
  let update = match updater.check().await {
    Ok(update) => update,
    Err(Error::TargetNotFound(_) | Error::TargetsNotFound(_)) => {
      let version = announced.lock().unwrap().take();
      state.pending.lock().unwrap().take();
      return Ok(version.map(|version| AvailableUpdate {
        release_url: release_url(&version),
        version,
        current_version,
        installable: false,
      }));
    }
    Err(error) => return Err(error.to_string()),
  };
  let mut pending = state.pending.lock().unwrap();
  let Some(update) = update else {
    pending.take();
    return Ok(None);
  };
  let available = AvailableUpdate {
    version: update.version.clone(),
    current_version,
    installable,
    release_url: release_url(&update.version),
  };
  if !installable {
    pending.take();
    return Ok(Some(available));
  }
  // Checking again must not discard a package downloaded for this release.
  let package = pending
    .take()
    .filter(|known| {
      known.update.version == update.version && known.update.signature == update.signature
    })
    .and_then(|known| known.package);
  pending.replace(PendingUpdate { update, package });
  Ok(Some(available))
}

/// Downloads and verifies the update found by `check`; returns whether it was
/// cancelled.
async fn download<R: Runtime>(
  app: &AppHandle<R>,
  state: &UpdateState,
  operation_id: String,
) -> Result<bool, String> {
  uuid::Uuid::parse_str(&operation_id).map_err(|_| "Invalid download operation ID")?;
  let update = {
    let pending = state.pending.lock().unwrap();
    let pending = pending.as_ref().ok_or("No update is available")?;
    if pending.package.is_some() {
      return Ok(false);
    }
    pending.update.clone()
  };
  let cancellation = Arc::new(JobCancellation::default());
  {
    let mut running = state.download.lock().unwrap();
    if running.is_some() {
      return Err("The update is already being downloaded".into());
    }
    running.replace((operation_id.clone(), cancellation.clone()));
  }
  let _download = Download(state);
  let mut completed = 0;
  let mut last_event = Instant::now() - Duration::from_secs(1);
  let transfer = update.download(
    |chunk, total_bytes| {
      completed += chunk as u64;
      if total_bytes == Some(completed) || last_event.elapsed() >= Duration::from_millis(100) {
        let _ = UpdateDownloadProgressEvent {
          operation_id: operation_id.clone(),
          completed_bytes: completed,
          total_bytes,
        }
        .emit(app);
        last_event = Instant::now();
      }
    },
    || {},
  );
  let package = match select(pin!(cancellation.cancelled()), pin!(transfer)).await {
    Either::Left(_) => return Ok(true),
    Either::Right((package, _)) => package.map_err(|e| e.to_string())?,
  };
  if cancellation.is_cancelled() {
    return Ok(true);
  }
  let mut pending = state.pending.lock().unwrap();
  match pending.as_mut() {
    Some(pending)
      if pending.update.version == update.version
        && pending.update.signature == update.signature =>
    {
      pending.package.replace(Arc::new(package));
      Ok(false)
    }
    _ => Err("The update changed while it was downloading; check for updates again".into()),
  }
}

fn cancel_download(state: &UpdateState, operation_id: &str) {
  if let Some((id, cancellation)) = state.download.lock().unwrap().as_ref() {
    if id == operation_id {
      cancellation.cancel();
    }
  }
}

/// Whether this build can look for updates at all; development builds cannot.
#[tauri::command]
#[specta::specta]
pub fn updates_supported() -> bool {
  supported()
}

/// Looks for a newer release. Resolves to `None` when Azalea is up to date.
#[tauri::command]
#[specta::specta]
pub async fn check_for_update(
  app: AppHandle,
  state: State<'_, UpdateState>,
) -> Result<Option<AvailableUpdate>, String> {
  let endpoints = if cfg!(debug_assertions) {
    let endpoint = development_endpoint().ok_or("Development builds do not check for updates")?;
    Some(vec![endpoint])
  } else {
    None
  };
  check(&app, &state, endpoints, installable(&app)).await
}

/// Downloads the update found by the last check and returns whether the
/// download was cancelled. The package is verified before this succeeds.
#[tauri::command]
#[specta::specta]
pub async fn download_update(
  app: AppHandle,
  state: State<'_, UpdateState>,
  operation_id: String,
) -> Result<bool, String> {
  download(&app, &state, operation_id).await
}

#[tauri::command]
#[specta::specta]
pub fn cancel_update_download(state: State<'_, UpdateState>, operation_id: String) {
  cancel_download(&state, &operation_id);
}

/// Installs the downloaded update and restarts into it. On Windows the
/// installer takes over and the process exits without returning.
#[tauri::command]
#[specta::specta]
pub async fn install_update(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
  if !installable(&app) {
    return Err("This installation cannot update itself".into());
  }
  let (update, package) = {
    let pending = state.pending.lock().unwrap();
    let pending = pending.as_ref().ok_or("No update is available")?;
    let package = pending
      .package
      .clone()
      .ok_or("The update has not been downloaded")?;
    (pending.update.clone(), package)
  };
  // Installing may wait for an administrator prompt.
  tauri::async_runtime::spawn_blocking(move || update.install(package.as_slice()))
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
  app.request_restart();
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::{Read, Write};
  use std::net::TcpListener;
  use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};

  /// A throwaway key pair made with `tauri signer generate`, and `PACKAGE`
  /// signed with it for version 9.9.9 by `tauri signer sign --app-version`.
  const PUBLIC_KEY: &str = include_str!("update_fixtures/test.key.pub");
  const SIGNATURE: &str = include_str!("update_fixtures/package.bin.sig");
  const PACKAGE: &[u8] = include_bytes!("update_fixtures/package.bin");

  /// Serves each response to one request, in order, then stops.
  fn serve(responses: Vec<(&'static str, Vec<u8>)>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    std::thread::spawn(move || {
      for (status, body) in responses {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = Vec::new();
        let mut buffer = [0; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
          let read = stream.read(&mut buffer).unwrap();
          if read == 0 {
            break;
          }
          request.extend_from_slice(&buffer[..read]);
        }
        let head = format!(
          "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
          body.len()
        );
        stream.write_all(head.as_bytes()).unwrap();
        stream.write_all(&body).unwrap();
      }
    });
    format!("http://{address}")
  }

  fn app() -> tauri::App<MockRuntime> {
    let mut context = mock_context(noop_assets());
    context.config_mut().plugins.0.insert(
      "updater".into(),
      serde_json::json!({
        "pubkey": PUBLIC_KEY.trim(),
        "endpoints": [],
        "requireSignedVersion": true,
      }),
    );
    let app = mock_builder()
      .plugin(tauri_plugin_updater::Builder::new().build())
      .build(context)
      .unwrap();
    tauri_specta::Builder::<MockRuntime>::new()
      .events(tauri_specta::collect_events![UpdateDownloadProgressEvent])
      .mount_events(&app);
    app
  }

  fn target() -> String {
    tauri_plugin_updater::target().unwrap()
  }

  fn manifest(version: &str, target: &str, package_url: &str) -> Vec<u8> {
    serde_json::json!({
      "version": version,
      "notes": "",
      "pub_date": "2026-01-01T00:00:00Z",
      "platforms": { target: { "signature": SIGNATURE.trim(), "url": package_url } },
    })
    .to_string()
    .into_bytes()
  }

  async fn check_at(
    app: &tauri::App<MockRuntime>,
    state: &UpdateState,
    base: &str,
    installable: bool,
  ) -> Result<Option<AvailableUpdate>, String> {
    let endpoint = format!("{base}/latest.json").parse().unwrap();
    check(app.handle(), state, Some(vec![endpoint]), installable).await
  }

  fn operation() -> String {
    uuid::Uuid::new_v4().to_string()
  }

  #[test]
  fn only_replaceable_installations_update_in_place() {
    let anywhere = Path::new("/usr/bin/azalea");
    assert!(installable_as(Some(BundleType::AppImage), true, anywhere));
    assert!(!installable_as(Some(BundleType::AppImage), false, anywhere));
    assert!(installable_as(Some(BundleType::Msi), false, anywhere));
    assert!(installable_as(Some(BundleType::Nsis), false, anywhere));
    assert!(!installable_as(Some(BundleType::Deb), false, anywhere));
    assert!(!installable_as(Some(BundleType::Rpm), false, anywhere));
    assert!(!installable_as(None, true, anywhere));
    let bundled = Path::new("/Applications/azalea.app/Contents/MacOS/azalea");
    assert!(installable_as(Some(BundleType::App), false, bundled));
    assert!(installable_as(Some(BundleType::Dmg), false, bundled));
    for unbundled in [
      "/Users/me/Azalea/src-tauri/target/release/azalea",
      "/Applications/azalea.app/Contents/Resources/azalea",
      "/Applications/azalea/Contents/MacOS/azalea",
      "/MacOS/azalea",
      "azalea",
    ] {
      assert!(
        !installable_as(Some(BundleType::App), false, Path::new(unbundled)),
        "{unbundled}"
      );
    }
  }

  #[test]
  fn development_builds_never_install_updates() {
    assert!(!installable(app().handle()));
  }

  #[test]
  fn release_pages_follow_the_publish_workflow_tags() {
    assert_eq!(
      release_url("1.2.3"),
      "https://github.com/Patchethium/Azalea/releases/tag/app-v1.2.3"
    );
    let workflow = include_str!("../../../.github/workflows/release.yml");
    assert!(workflow.contains("tagName: app-v__VERSION__"));
  }

  #[tokio::test]
  async fn check_announces_only_newer_releases() {
    let app = app();
    let state = UpdateState::default();
    let base = serve(vec![
      ("200 OK", manifest("9.9.9", &target(), "http://unused")),
      ("200 OK", manifest("0.1.0", &target(), "http://unused")),
      ("200 OK", manifest("0.0.9", &target(), "http://unused")),
    ]);
    assert_eq!(
      check_at(&app, &state, &base, true).await,
      Ok(Some(AvailableUpdate {
        version: "9.9.9".into(),
        current_version: "0.1.0".into(),
        installable: true,
        release_url: "https://github.com/Patchethium/Azalea/releases/tag/app-v9.9.9".into(),
      }))
    );
    assert!(state.pending.lock().unwrap().is_some());
    // The running version and older ones are not updates, and forget the
    // release found before.
    assert_eq!(check_at(&app, &state, &base, true).await, Ok(None));
    assert!(state.pending.lock().unwrap().is_none());
    assert_eq!(check_at(&app, &state, &base, true).await, Ok(None));
  }

  #[tokio::test]
  async fn check_reports_unreachable_and_malformed_manifests() {
    let app = app();
    let state = UpdateState::default();
    let base = serve(vec![
      ("404 Not Found", b"Not Found".to_vec()),
      ("200 OK", b"{\"version\": \"not a version\"}".to_vec()),
    ]);
    assert!(check_at(&app, &state, &base, true).await.is_err());
    assert!(check_at(&app, &state, &base, true).await.is_err());
    // Nothing listens here any more.
    assert!(check_at(&app, &state, &base, true).await.is_err());
    assert!(state.pending.lock().unwrap().is_none());
  }

  #[tokio::test]
  async fn releases_without_a_package_for_this_platform_point_at_the_release_page() {
    let app = app();
    let state = UpdateState::default();
    let base = serve(vec![
      ("200 OK", manifest("9.9.9", "plan9-mips", "http://unused")),
      ("200 OK", manifest("0.1.0", "plan9-mips", "http://unused")),
    ]);
    let update = check_at(&app, &state, &base, true).await.unwrap().unwrap();
    assert_eq!(update.version, "9.9.9");
    assert!(!update.installable);
    assert!(state.pending.lock().unwrap().is_none());
    assert_eq!(
      download(app.handle(), &state, operation()).await,
      Err("No update is available".into())
    );
    assert_eq!(check_at(&app, &state, &base, true).await, Ok(None));
  }

  #[tokio::test]
  async fn installations_that_cannot_update_keep_nothing_to_download() {
    let app = app();
    let state = UpdateState::default();
    let base = serve(vec![(
      "200 OK",
      manifest("9.9.9", &target(), "http://unused"),
    )]);
    let update = check_at(&app, &state, &base, false).await.unwrap().unwrap();
    assert!(!update.installable);
    assert!(state.pending.lock().unwrap().is_none());
  }

  #[tokio::test]
  async fn download_keeps_a_verified_package_across_checks() {
    let app = app();
    let state = UpdateState::default();
    let packages = serve(vec![("200 OK", PACKAGE.to_vec())]);
    let package_url = format!("{packages}/package.bin");
    let base = serve(vec![
      ("200 OK", manifest("9.9.9", &target(), &package_url)),
      ("200 OK", manifest("9.9.9", &target(), &package_url)),
    ]);
    check_at(&app, &state, &base, true).await.unwrap().unwrap();
    assert_eq!(
      download(app.handle(), &state, "not a uuid".into()).await,
      Err("Invalid download operation ID".into())
    );
    let progress = Arc::new(Mutex::new(Vec::new()));
    let reported = progress.clone();
    UpdateDownloadProgressEvent::listen(app.handle(), move |event| {
      reported.lock().unwrap().push(event.payload);
    });
    let id = operation();
    assert_eq!(download(app.handle(), &state, id.clone()).await, Ok(false));
    let last = progress
      .lock()
      .unwrap()
      .pop()
      .expect("progress is reported");
    assert_eq!(last.operation_id, id);
    assert_eq!(last.completed_bytes, PACKAGE.len() as u64);
    assert_eq!(last.total_bytes, Some(PACKAGE.len() as u64));
    let package = || {
      let pending = state.pending.lock().unwrap();
      pending.as_ref().unwrap().package.clone().unwrap()
    };
    assert_eq!(package().as_slice(), PACKAGE);
    assert!(state.download.lock().unwrap().is_none());
    // The package server answers once: neither a second download nor a
    // second check fetches or forgets the package.
    assert_eq!(download(app.handle(), &state, operation()).await, Ok(false));
    check_at(&app, &state, &base, true).await.unwrap().unwrap();
    assert_eq!(package().as_slice(), PACKAGE);
  }

  #[tokio::test]
  async fn download_rejects_packages_that_fail_verification() {
    let app = app();
    let state = UpdateState::default();
    let mut tampered = PACKAGE.to_vec();
    tampered[0] ^= 1;
    let packages = serve(vec![
      ("200 OK", tampered),
      ("404 Not Found", Vec::new()),
      ("200 OK", PACKAGE.to_vec()),
    ]);
    let package_url = format!("{packages}/package.bin");
    // The signature binds version 9.9.9; an older signed package announced as
    // a newer version must not install.
    let base = serve(vec![
      ("200 OK", manifest("9.9.9", &target(), &package_url)),
      ("200 OK", manifest("10.0.0", &target(), &package_url)),
    ]);
    check_at(&app, &state, &base, true).await.unwrap().unwrap();
    assert!(download(app.handle(), &state, operation()).await.is_err());
    assert!(download(app.handle(), &state, operation()).await.is_err());
    check_at(&app, &state, &base, true).await.unwrap().unwrap();
    let error = download(app.handle(), &state, operation())
      .await
      .unwrap_err();
    assert!(error.contains("signed for version 9.9.9"), "{error}");
    let pending = state.pending.lock().unwrap();
    assert!(pending.as_ref().unwrap().package.is_none());
    assert!(state.download.lock().unwrap().is_none());
  }

  #[tokio::test]
  async fn cancelling_a_download_keeps_the_update_available() {
    let app = app();
    let state = UpdateState::default();
    // Accepts the package request and never answers it.
    let stalled = TcpListener::bind("127.0.0.1:0").unwrap();
    let package_url = format!("http://{}/package.bin", stalled.local_addr().unwrap());
    let base = serve(vec![("200 OK", manifest("9.9.9", &target(), &package_url))]);
    check_at(&app, &state, &base, true).await.unwrap().unwrap();
    let id = operation();
    let cancel = async {
      // Only the running download's ID cancels it.
      loop {
        tokio::time::sleep(Duration::from_millis(10)).await;
        if state.download.lock().unwrap().is_some() {
          break;
        }
      }
      assert_eq!(
        download(app.handle(), &state, operation()).await,
        Err("The update is already being downloaded".into())
      );
      cancel_download(&state, &operation());
      tokio::time::sleep(Duration::from_millis(50)).await;
      assert!(state.download.lock().unwrap().is_some());
      cancel_download(&state, &id);
    };
    let (cancelled, ()) = tokio::join!(download(app.handle(), &state, id.clone()), cancel);
    assert_eq!(cancelled, Ok(true));
    assert!(state.download.lock().unwrap().is_none());
    let pending = state.pending.lock().unwrap();
    assert!(pending.as_ref().unwrap().package.is_none());
    drop(stalled);
  }

  #[test]
  fn the_configured_public_key_and_endpoint_are_usable() {
    use base64::Engine;
    let config: serde_json::Value =
      serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
    let updater = &config["plugins"]["updater"];
    assert_eq!(
      updater["endpoints"],
      serde_json::json!([
        "https://github.com/Patchethium/Azalea/releases/latest/download/latest.json"
      ])
    );
    assert_eq!(updater["requireSignedVersion"], true);
    // Local builds must not need the signing key; only the release
    // configuration creates updater packages.
    assert!(config["bundle"].get("createUpdaterArtifacts").is_none());
    let release: serde_json::Value =
      serde_json::from_str(include_str!("../../tauri.release.conf.json")).unwrap();
    assert_eq!(release["bundle"]["createUpdaterArtifacts"], true);
    // A minisign public key file: a comment line, then the base64 of the
    // algorithm, key ID and Ed25519 key.
    let decode = |text: &str| base64::engine::general_purpose::STANDARD.decode(text);
    let key = decode(updater["pubkey"].as_str().unwrap()).expect("pubkey must be base64");
    let key = String::from_utf8(key).unwrap();
    let mut lines = key.lines();
    assert!(lines
      .next()
      .unwrap()
      .starts_with("untrusted comment: minisign public key"));
    let key = decode(lines.next().expect("pubkey must hold a key line")).unwrap();
    assert_eq!(key.len(), 42);
    assert_eq!(&key[..2], b"Ed");
  }
}
