//! Voicevox Core Wrapper
//! Provides a safe Rust interface to the Voicevox Core library.
//! This module is not thread-safe, you should your own synchronization mechanism.
#![allow(non_upper_case_globals)]
use std::ffi::c_char;
use std::path::PathBuf;
use std::ptr;

use super::audio_query::AudioQuery;
use super::binding::*;
use super::metas::{StyleType, VoiceModelMeta};
use super::utils::{
  c_char_to_string, search_file, string_to_c_char, CANDIDATES, VOICEVOX_LIB_NAME,
};

use anyhow::{Error, Result};
use libloading::Library;
use serde_json::{from_str, to_string};

/// Error type for Voicevox Core
#[derive(Debug, thiserror::Error)]
pub enum VoicevoxError {
  #[error("Voicevox error: {0}")]
  VoicevoxError(VoicevoxResultCode),
}

impl From<VoicevoxResultCode> for VoicevoxError {
  fn from(code: VoicevoxResultCode) -> Self {
    VoicevoxError::VoicevoxError(code)
  }
}

pub struct DynWrapper {
  core: VoicevoxCore,
  _ort: Library, // onnxruntime, it's not directly used in azalea
  pub metas: VoiceModelMeta,
}

impl DynWrapper {
  pub fn new(path: &str, openjtalk_path: Option<&str>) -> Result<Self> {
    let lib_path = PathBuf::from(path).join(VOICEVOX_LIB_NAME);
    // load onnxruntime before core
    let mut ort_path = None;
    for c in CANDIDATES {
      if let Some(p) = search_file(c, path) {
        ort_path = Some(p);
        break;
      }
    }
    let ort = if let Some(ort_path) = ort_path {
      unsafe { Ok(Library::new(ort_path)?) }
    } else {
      Err(Error::msg("Onnxruntime not found"))
    }?;
    // load core after onnxruntime
    let core = unsafe { VoicevoxCore::new(lib_path)? };
    // find ojt dict dir
    let ojt_matrix = "matrix.bin";
    let mut option = unsafe { core.voicevox_make_default_initialize_options() };
    if let Some(openjtalk_path) = openjtalk_path {
      option.open_jtalk_dict_dir = string_to_c_char(openjtalk_path)?;
    } else if let Some(p) = search_file(ojt_matrix, path) {
      option.open_jtalk_dict_dir = string_to_c_char(&p.parent().unwrap().to_string_lossy())?;
    } else {
      return Err(Error::msg(
        "OpenJTalk dict dir not found, specify it manually or put it under the core dir",
      ));
    }
    // init core
    unsafe {
      match core.voicevox_initialize(option) {
        VoicevoxResultCode_VOICEVOX_RESULT_OK => {}
        code => return Err(VoicevoxError::from(code).into()),
      }
    }
    let metas = unsafe {
      let meta_str = core.voicevox_get_metas_json();
      let mut metas = serde_json::from_str::<VoiceModelMeta>(
        &c_char_to_string(meta_str).ok_or(Error::msg("Empty meta json string"))?,
      )?;
      metas.iter_mut().for_each(|meta| {
        meta.styles = meta
          .clone()
          .styles
          .into_iter()
          .filter(|style| style.r#type == StyleType::Talk)
          .collect::<Vec<_>>();
        meta.styles.sort_by_key(|style| style.order);
      });
      metas
    };
    Ok(Self {
      core,
      _ort: ort,
      metas,
    })
  }

  pub fn load_speaker(&self, speaker_id: u32) -> Result<()> {
    unsafe {
      match self.core.voicevox_load_model(speaker_id) {
        VoicevoxResultCode_VOICEVOX_RESULT_OK => Ok(()),
        _ => Err(Error::msg("Failed to load speaker")),
      }
    }
  }

  pub fn is_speaker_loaded(&self, speaker_id: u32) -> bool {
    unsafe { self.core.voicevox_is_model_loaded(speaker_id) }
  }

  pub fn make_default_audio_query_options(&self) -> VoicevoxAudioQueryOptions {
    unsafe { self.core.voicevox_make_default_audio_query_options() }
  }

  pub fn make_default_synthesis_options(&self) -> VoicevoxSynthesisOptions {
    unsafe { self.core.voicevox_make_default_synthesis_options() }
  }

  pub fn audio_query(
    &self,
    text: &str,
    speaker_id: u32,
    options: Option<VoicevoxAudioQueryOptions>,
  ) -> Result<AudioQuery> {
    if !self.is_speaker_loaded(speaker_id) {
      self.load_speaker(speaker_id)?;
    }
    let options = match options {
      Some(options) => options,
      None => self.make_default_audio_query_options(),
    };
    let mut data_ptr: *mut c_char = ptr::null_mut();
    unsafe {
      match self.core.voicevox_audio_query(
        string_to_c_char(text)?,
        speaker_id,
        options,
        &mut data_ptr,
      ) {
        VoicevoxResultCode_VOICEVOX_RESULT_OK => {
          let data = c_char_to_string(data_ptr).ok_or(Error::msg("Empty audio query string"))?;
          // clean it up
          self.core.voicevox_audio_query_json_free(data_ptr);
          Ok(from_str::<AudioQuery>(&data)?)
        }
        _ => {
          self.core.voicevox_audio_query_json_free(data_ptr);
          Err(Error::msg("Failed to encode text"))
        }
      }
    }
  }

  /// TODO: Is it possible to make this zero-copy?
  pub fn synthesis(
    &self,
    audio_query: &AudioQuery,
    speaker_id: u32,
    options: Option<VoicevoxSynthesisOptions>,
  ) -> Result<Vec<u8>> {
    if !self.is_speaker_loaded(speaker_id) {
      self.load_speaker(speaker_id)?;
    }
    let options = match options {
      Some(options) => options,
      None => self.make_default_synthesis_options(),
    };
    let mut data_length = 0;
    let mut data_ptr: *mut u8 = ptr::null_mut();
    unsafe {
      let audio_query_json_str_raw = string_to_c_char(&to_string(audio_query)?).unwrap();
      match self.core.voicevox_synthesis(
        audio_query_json_str_raw,
        speaker_id,
        options,
        &mut data_length,
        &mut data_ptr,
      ) {
        VoicevoxResultCode_VOICEVOX_RESULT_OK => {
          let slice = std::slice::from_raw_parts(data_ptr, data_length);
          let vec = slice.to_vec();
          self.core.voicevox_wav_free(data_ptr);
          Ok(vec)
        }
        _ => {
          self.core.voicevox_wav_free(data_ptr);
          Err(Error::msg("Failed to decode audio query"))
        }
      }
    }
  }
}

impl Drop for DynWrapper {
  fn drop(&mut self) {
    unsafe {
      self.core.voicevox_finalize();
    }
  }
}
