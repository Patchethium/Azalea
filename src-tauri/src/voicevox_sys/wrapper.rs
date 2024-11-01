//! Voicevox Core Wrapper
//! Provides a safe Rust interface to the Voicevox Core library.
//! Do I really need this? Since the Voicevox Core library itself is written in Rust
//! I could just use the library directly, right? Well, no.
//! The Core is distributed in binary form only to prevent abuse.
//! And they (yet) don't provide a Rust API, or I'm to dumb to find how to use it.
#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
use std::sync::{LazyLock};
use core::slice;
use std::ptr;

use super::{binding::*, utils::string_to_c_char};

use anyhow::{Error, Result};

use super::{metas::VoiceModelMeta, utils::c_char_to_string};

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

pub static VOICEVOX_CORE: LazyLock<Wrapper> = LazyLock::new(|| Wrapper::new().unwrap());

#[allow(dead_code)]
pub struct Wrapper {
  metas: VoiceModelMeta,
}

impl Wrapper {
  pub fn new() -> Result<Self, VoicevoxError> {
    unsafe {
      let metas = VoiceModelMeta::new();
      let mut default_option = voicevox_make_default_initialize_options();
      let openjtalk_dir = std::path::Path::new(&std::env::var("VOICEVOX_CORE_DIR").unwrap()).join("pyopenjtalk");
      default_option.open_jtalk_dict_dir = string_to_c_char(&openjtalk_dir.to_string_lossy());
      default_option.acceleration_mode = 1;
      default_option.load_all_models = true;
      match voicevox_initialize(default_option) {
        VoicevoxResultCode_VOICEVOX_RESULT_OK => {}
        code => return Err(code.into()),
      }
      Ok(Self { metas })
    }
  }

  pub fn get_metas(&self) -> Result<VoiceModelMeta> {
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

  /// although they call it "intonation", it's obviously pitch for me
  pub fn predict_pitch(
    &self,
    vowel_phoneme: &mut [i64],
    consonant_phoneme: &mut [i64],
    start_accent: &mut [i64],
    end_accent: &mut [i64],
    start_accent_phrase: &mut [i64],
    end_accent_phrase: &mut [i64],
    speaker_id: u32,
  ) -> Result<Vec<f32>, VoicevoxResultCode> {
    // who needs sanity checks when you can apply for bankruptcy?
    // assert_eq!(vowel_phoneme.len(), consonant_phoneme.len());
    // assert_eq!(vowel_phoneme.len(), start_accent.len());
    // assert_eq!(vowel_phoneme.len(), end_accent.len());
    // assert_eq!(vowel_phoneme.len(), start_accent_phrase.len());
    // assert_eq!(vowel_phoneme.len(), end_accent_phrase.len());

    let length = vowel_phoneme.len();
    let mut data_length = 0;
    let mut data_ptr: *mut f32 = ptr::null_mut();

    let result = unsafe {
      voicevox_predict_intonation(
        length,
        vowel_phoneme.as_mut_ptr(),
        consonant_phoneme.as_mut_ptr(),
        start_accent.as_mut_ptr(),
        end_accent.as_mut_ptr(),
        start_accent_phrase.as_mut_ptr(),
        end_accent_phrase.as_mut_ptr(),
        speaker_id,
        &mut data_length,
        &mut data_ptr,
      )
    };
    if result != VoicevoxResultCode_VOICEVOX_RESULT_OK {
      return Err(result);
    }
    let out_data = unsafe {
      let slice = slice::from_raw_parts(data_ptr, data_length);
      let vec = slice.to_vec();

      voicevox_predict_intonation_data_free(data_ptr);
      vec
    };
    Ok(out_data)
  }

  // follows the same manner of predict_pitch
  pub fn predict_duration(
    &self,
    length: usize,
    phoneme: &mut [i64],
    speaker_id: u32,
  ) -> Result<Vec<f32>, VoicevoxResultCode> {
    let mut data_length = 0;
    let mut data_ptr: *mut f32 = ptr::null_mut();

    let result = unsafe {
      voicevox_predict_duration(
        length,
        phoneme.as_mut_ptr(),
        speaker_id,
        &mut data_length,
        &mut data_ptr,
      )
    };
    if result != VoicevoxResultCode_VOICEVOX_RESULT_OK {
      return Err(result);
    }
    let out_data = unsafe {
      let slice = slice::from_raw_parts(data_ptr, data_length);
      let vec = slice.to_vec();

      voicevox_predict_duration_data_free(data_ptr);
      vec
    };
    Ok(out_data)
  }
  /// The process of generating the waveform is called "decoding" in Voicevox.
  fn predict_waveform(
    &self,
    length: usize,
    phoneme_size: usize,
    f0: &mut [f32],
    phoneme: &mut [f32],
    speaker_id: u32,
  ) -> Result<Vec<f32>, VoicevoxError> {
    let mut data_length = 0;
    let mut data_ptr: *mut f32 = ptr::null_mut();

    let result = unsafe {
      voicevox_decode(
        length,
        phoneme_size,
        f0.as_mut_ptr(),
        phoneme.as_mut_ptr(),
        speaker_id,
        &mut data_length,
        &mut data_ptr,
      )
    };
    if result != VoicevoxResultCode_VOICEVOX_RESULT_OK {
      return Err(result.into());
    }
    let out_data = unsafe {
      let slice = slice::from_raw_parts(data_ptr, data_length);
      let vec = slice.to_vec();

      voicevox_decode_data_free(data_ptr);
      vec
    };
    Ok(out_data)
  }

  /// all-in-one function for generating waveform, no middle steps
  pub fn tts(
    &self,
    text: &str,
    speaker_id: u32,
    options: Option<VoicevoxTtsOptions>,
  ) -> Result<Vec<u8>, VoicevoxError> {
    let mut data_length = 0;
    let mut data_ptr: *mut u8 = ptr::null_mut();

    let result = unsafe {
      voicevox_tts(string_to_c_char(text), speaker_id, options.unwrap_or(voicevox_make_default_tts_options()), &mut data_length, &mut data_ptr)
    };
    if result != VoicevoxResultCode_VOICEVOX_RESULT_OK {
      return Err(result.into());
    }
    let out_data = unsafe {
      let slice = slice::from_raw_parts(data_ptr, data_length);
      let vec = slice.to_vec();

      voicevox_wav_free(data_ptr);
      vec
    };
    Ok(out_data)
  }
}
