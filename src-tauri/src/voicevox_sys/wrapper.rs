//! Voicevox Core Wrapper
//! Provides a safe Rust interface to the Voicevox Core library.
//! Do I really need this? Since the Voicevox Core library itself is written in Rust
//! I could just use the library directly, right? Well, no.
//! The Core is distributed in binary form only to prevent abuse.
//! And they (yet) don't provide a Rust API, or I'm to dumb to find how to use it.
#![allow(non_upper_case_globals)]
use std::ffi::c_char;
use std::num::NonZeroUsize;
use std::ptr;
use std::sync::{LazyLock, RwLock};

use super::binding::*;
use super::audio_query::AudioQuery;
use super::metas::VoiceModelMeta;
use super::utils::{string_to_c_char, c_char_to_string};

use anyhow::{Error, Result};
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

pub static VOICEVOX_CORE: LazyLock<RwLock<Wrapper>> = LazyLock::new(|| RwLock::new(Wrapper::new(None).unwrap()));

#[allow(dead_code)]
pub struct Wrapper {
  pub metas: VoiceModelMeta,
  pub query_cache: Option<lru::LruCache<String, AudioQuery>>,
  pub wav_cache: Option<lru::LruCache<String, Vec<u8>>>,
}

pub struct WrapperInitializeOptions {
  pub voicevox_initialize_options: VoicevoxInitializeOptions,
  pub cache_size: usize,
}

impl From<VoicevoxInitializeOptions> for WrapperInitializeOptions {
  fn from(options: VoicevoxInitializeOptions) -> Self {
    Self {
      voicevox_initialize_options: options,
      cache_size: 1024,
    }
  }
}

impl Into<VoicevoxInitializeOptions> for WrapperInitializeOptions {
  fn into(self) -> VoicevoxInitializeOptions {
    self.voicevox_initialize_options
  }
}

impl Wrapper {
  /// We don't expose the new function to outside
  /// so we can keep it a singleton
  fn new(
    option: Option<WrapperInitializeOptions>,
  ) -> Result<Self> {
    // set up default openjtalk dict dir
    let default_dir = std::path::Path::new(&std::env::var("VOICEVOX_CORE_DIR")?)
      .join("openjtalk");
    let default_dir = default_dir.to_string_lossy();

    // set up caches
    let mut wav_cache = None;
    let mut query_cache = None;
    if let Some(option) = &option {
      query_cache = match option.cache_size {
        0 => None,
        size => Some(lru::LruCache::new(NonZeroUsize::new(size).unwrap())),
      };
      wav_cache = match option.cache_size {
        0 => None,
        size => Some(lru::LruCache::new(NonZeroUsize::new(size).unwrap())),
      };
    }
    // initialize voicevox
    unsafe {
      let option = option.unwrap_or_else(|| {
        let mut option = voicevox_make_default_initialize_options();
        if let Ok(dir) = string_to_c_char(&default_dir) {
          option.open_jtalk_dict_dir = dir;
        }
        WrapperInitializeOptions::from(option)
      });
      match voicevox_initialize(option.into()) {
        VoicevoxResultCode_VOICEVOX_RESULT_OK => {}
        code => return Err(VoicevoxError::from(code).into()),
      }
      let metas = Self::load_metas()?;
      Ok(Self { metas, wav_cache, query_cache })
    }
  }

  fn load_metas() -> Result<VoiceModelMeta> {
    unsafe {
      let meta_str = voicevox_get_metas_json();
      Ok(serde_json::from_str(
        &c_char_to_string(meta_str).ok_or(Error::msg("Empty meta json string"))?,
      )?)
    }
  }

  pub fn load_speaker(&self, speaker_id: u32) -> Result<()> {
    unsafe {
      match voicevox_load_model(speaker_id) {
        VoicevoxResultCode_VOICEVOX_RESULT_OK => Ok(()),
        _ => Err(Error::msg("Failed to load speaker")),
      }
    }
  }

  pub fn is_speaker_loaded(&self, speaker_id: u32) -> bool {
    unsafe { voicevox_is_model_loaded(speaker_id) }
  }

  pub fn make_default_audio_query_options() -> VoicevoxAudioQueryOptions {
    unsafe { voicevox_make_default_audio_query_options() }
  }

  pub fn make_default_synthesis_options() -> VoicevoxSynthesisOptions {
    unsafe { voicevox_make_default_synthesis_options() }
  }

  pub fn make_default_tts_options() -> VoicevoxTtsOptions {
    unsafe { voicevox_make_default_tts_options() }
  }

  /// text -> audio query
  /// production purpose
  /// I call it encode accroding to the manner of AI papers which makes no sense at all.
  pub fn encode(
    &mut self,
    text: &str,
    speaker_id: u32,
    options: Option<VoicevoxAudioQueryOptions>,
  ) -> Result<AudioQuery> {
    if !self.is_speaker_loaded(speaker_id) {
      self.load_speaker(speaker_id)?;
    }
    let options = match options {
      Some(options) => options,
      None => Self::make_default_audio_query_options(),
    };
    let mut data_ptr: *mut c_char = ptr::null_mut();
    unsafe {
      match voicevox_audio_query(string_to_c_char(text)?, speaker_id, options, &mut data_ptr) {
        VoicevoxResultCode_VOICEVOX_RESULT_OK => {
          let data = c_char_to_string(data_ptr).ok_or(Error::msg("Empty audio query string"))?;
          // clean it up
          voicevox_audio_query_json_free(data_ptr);
          Ok(from_str::<AudioQuery>(&data)?)
        }
        _ => {
          voicevox_audio_query_json_free(data_ptr);
          Err(Error::msg("Failed to encode text"))
        }
      }
    }
  }

  /// audio query -> waveform
  /// production purpose
  /// I call it decode for the same reason
  pub fn decode(
    &mut self,
    audio_query: &AudioQuery,
    speaker_id: u32,
    options: Option<VoicevoxSynthesisOptions>,
  ) -> Result<Vec<u8>> {
    if !self.is_speaker_loaded(speaker_id) {
      self.load_speaker(speaker_id)?;
    }
    let options = match options {
      Some(options) => options,
      None => Self::make_default_synthesis_options(),
    };
    let mut data_length = 0;
    let mut data_ptr: *mut u8 = ptr::null_mut();
    unsafe {
      let audio_query_json_str_raw = string_to_c_char(&to_string(audio_query)?).unwrap();
      match voicevox_synthesis(
        audio_query_json_str_raw,
        speaker_id,
        options,
        &mut data_length,
        &mut data_ptr,
      ) {
        VoicevoxResultCode_VOICEVOX_RESULT_OK => {
          let slice = std::slice::from_raw_parts(data_ptr, data_length);
          let vec = slice.to_vec();
          voicevox_wav_free(data_ptr);
          Ok(vec)
        }
        _ => {
          voicevox_wav_free(data_ptr);
          Err(Error::msg("Failed to decode audio query"))
        }
      }
    }
  }

  /// all-in-one function for generating waveform, no middle steps
  /// test purpose only
  pub fn tts(
    &mut self,
    text: &str,
    speaker_id: u32,
    options: Option<VoicevoxTtsOptions>,
  ) -> Result<Vec<u8>> {
    let mut data_length = 0;
    let mut data_ptr: *mut u8 = ptr::null_mut();

    let result = unsafe {
      voicevox_tts(
        string_to_c_char(text)?,
        speaker_id,
        options.unwrap_or(voicevox_make_default_tts_options()),
        &mut data_length,
        &mut data_ptr,
      )
    };
    if result != VoicevoxResultCode_VOICEVOX_RESULT_OK {
      return Err(VoicevoxError::from(result).into());
    }
    let out_data = unsafe {
      let slice = std::slice::from_raw_parts(data_ptr, data_length);
      let vec = slice.to_vec();

      voicevox_wav_free(data_ptr);
      vec
    };
    Ok(out_data)
  }
}

impl Drop for Wrapper {
  fn drop(&mut self) {
    unsafe {
      voicevox_finalize();
    }
  }
}
