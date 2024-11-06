use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::path::PathBuf;

use anyhow::Result;
use walkdir::WalkDir;

#[allow(dead_code)]
pub fn c_char_to_string(c_char_ptr: *const c_char) -> Option<String> {
  if c_char_ptr.is_null() {
    None
  } else {
    // Step 1: Wrap it in `CStr` (unsafe because of raw pointer dereference)
    let c_str = unsafe { CStr::from_ptr(c_char_ptr) };

    // Step 2: Convert `CStr` to `&str` and then to `String`
    c_str.to_str().ok().map(|s| s.to_string())
  }
}

// the reverse function
#[allow(dead_code)]
pub fn string_to_c_char(s: &str) -> Result<*const c_char> {
  Ok(CString::new(s)?.into_raw())
}

#[allow(dead_code)]
pub fn search_file(filename: &str, dir: &str) -> Option<PathBuf> {
  let search_dir = PathBuf::from(dir);
  for entry in WalkDir::new(search_dir) {
    if let Ok(entry) = entry {
      if entry.file_name() == filename && entry.path().is_file() {
        return Some(entry.path().to_owned());
      }
    }
  }
  None
}

#[allow(dead_code)]
pub fn search_dir(dirname: &str, dir: &str) -> Option<PathBuf> {
  let search_dir = PathBuf::from(dir);
  for entry in WalkDir::new(search_dir) {
    if let Ok(entry) = entry {
      if entry.file_name() == dirname && entry.path().is_dir() {
        return Some(entry.path().to_owned());
      }
    }
  }
  None
}
