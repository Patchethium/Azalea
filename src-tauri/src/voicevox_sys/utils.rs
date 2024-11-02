use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use anyhow::Result;

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
pub fn string_to_c_char(s: &str) -> Result<*const c_char> {
  Ok(CString::new(s)?.into_raw())
}
