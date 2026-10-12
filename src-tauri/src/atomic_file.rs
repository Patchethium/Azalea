//! Crash-safe file replacement that keeps the previous version as a backup.

use std::ffi::OsString;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// The sibling file that holds the last successfully saved version of `path`.
pub(crate) fn backup_path(path: &Path) -> PathBuf {
  let mut name = path.file_name().map(OsString::from).unwrap_or_default();
  name.push(".bak");
  path.with_file_name(name)
}

/// Replaces `path` with `contents` so that it is never left partially written.
///
/// The data is written and flushed to a temporary sibling file first. Only
/// then is the current file, if any, copied to [`backup_path`] and the
/// temporary file renamed over it. A failure at any step leaves the existing
/// file untouched and removes the temporary file.
pub(crate) fn write_with_backup(path: &Path, contents: &[u8]) -> io::Result<()> {
  let file_name = path.file_name().ok_or_else(|| {
    io::Error::new(
      io::ErrorKind::InvalidInput,
      format!("{} is not a file path", path.display()),
    )
  })?;
  let dir = match path.parent() {
    Some(parent) if !parent.as_os_str().is_empty() => parent,
    _ => Path::new("."),
  };
  let mut prefix = OsString::from(".");
  prefix.push(file_name);
  prefix.push(".");
  let mut temp = tempfile::Builder::new()
    .prefix(&prefix)
    .suffix(".tmp")
    .tempfile_in(dir)?;
  temp.write_all(contents)?;
  temp.as_file().sync_all()?;

  let existing = fs::metadata(path).ok();
  if let Some(metadata) = &existing {
    if !metadata.is_file() {
      return Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("{} is not a regular file", path.display()),
      ));
    }
    // Temporary files are owner-only; keep the permissions of the original.
    fs::set_permissions(temp.path(), metadata.permissions())?;
    fs::copy(path, backup_path(path))?;
  } else {
    set_new_file_permissions(temp.path())?;
  }
  temp.persist(path).map_err(|error| error.error)?;
  sync_dir(dir);
  Ok(())
}

#[cfg(unix)]
fn set_new_file_permissions(path: &Path) -> io::Result<()> {
  use std::os::unix::fs::PermissionsExt;
  fs::set_permissions(path, fs::Permissions::from_mode(0o644))
}

#[cfg(not(unix))]
fn set_new_file_permissions(_path: &Path) -> io::Result<()> {
  Ok(())
}

/// Persists the rename itself; best effort, since the data is already synced.
#[cfg(unix)]
fn sync_dir(dir: &Path) {
  if let Ok(dir) = fs::File::open(dir) {
    let _ = dir.sync_all();
  }
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

#[cfg(test)]
mod tests {
  use super::*;

  fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<_> = fs::read_dir(dir)
      .unwrap()
      .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
      .collect();
    names.sort();
    names
  }

  #[test]
  fn creates_a_new_file_without_a_backup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("project.azp");

    write_with_backup(&path, b"first").unwrap();

    assert_eq!(fs::read(&path).unwrap(), b"first");
    assert_eq!(entries(dir.path()), ["project.azp"]);
  }

  #[test]
  fn keeps_the_previous_version_as_a_backup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("project.azp");

    write_with_backup(&path, b"first").unwrap();
    write_with_backup(&path, b"second").unwrap();
    write_with_backup(&path, "三番目".as_bytes()).unwrap();

    assert_eq!(fs::read_to_string(&path).unwrap(), "三番目");
    assert_eq!(fs::read(backup_path(&path)).unwrap(), b"second");
    assert_eq!(entries(dir.path()), ["project.azp", "project.azp.bak"]);
  }

  #[test]
  fn failed_writes_leave_the_target_and_no_temporary_files() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("occupied");
    fs::create_dir(&target).unwrap();
    fs::write(target.join("inside"), b"kept").unwrap();

    assert!(write_with_backup(&target, b"data").is_err());
    assert_eq!(fs::read(target.join("inside")).unwrap(), b"kept");
    assert_eq!(entries(dir.path()), ["occupied"]);

    let missing = dir.path().join("missing").join("project.azp");
    assert!(write_with_backup(&missing, b"data").is_err());
    assert!(write_with_backup(Path::new("/"), b"data").is_err());
  }

  #[test]
  fn backup_path_appends_to_the_file_name() {
    assert_eq!(
      backup_path(Path::new("dir/config.toml")),
      Path::new("dir/config.toml.bak")
    );
  }

  #[cfg(unix)]
  #[test]
  fn preserves_permissions_of_the_replaced_file() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("project.azp");

    write_with_backup(&path, b"first").unwrap();
    assert_eq!(
      fs::metadata(&path).unwrap().permissions().mode() & 0o777,
      0o644
    );
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    write_with_backup(&path, b"second").unwrap();
    assert_eq!(
      fs::metadata(&path).unwrap().permissions().mode() & 0o777,
      0o600
    );
  }
}
