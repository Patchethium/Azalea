//! Voicevox Core Wrapper
//! Provides a safe Rust interface to the Voicevox Core library.
//! Do I really need this? Since the Voicevox Core library itself is written in Rust
//! I could just use the library directly, right? Well, no.
//! The Core is distributed in binary form only to prevent abuse.
//! And they (yet) don't provide a Rust API, or I'm to dumb to find how to use it.
#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
include!("./binding/voicevox_core.rs");

use anyhow::{Error, Result};

use super::{metas::VoiceModelMeta, utils::c_char_to_string};

#[allow(dead_code)]
pub struct Wrapper {
  metas: VoiceModelMeta,
}

impl Wrapper {
  pub fn new() -> Result<Self> {
    unsafe {
      let metas = VoiceModelMeta::new();
      let default_option = voicevox_make_default_initialize_options();
      Self::init(default_option)?;
      Ok(Self { metas })
    }
  }
  pub fn init(option: VoicevoxInitializeOptions) -> Result<()> {
    unsafe {
      match voicevox_initialize(option) {
        VoicevoxResultCode_VOICEVOX_RESULT_OK => Ok(()),
        _ => Err(Error::msg("Failed to initialize Voicevox Core")),
      }
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
}
