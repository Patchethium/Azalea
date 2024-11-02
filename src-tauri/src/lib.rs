//! TODO: there's no reason we pass the audio to frontend, we can keep it in the buffer and avoid the IPC overhead
pub mod audio_player;
pub mod voicevox_sys;

use voicevox_sys::{audio_query::AudioQuery, metas::VoiceModelMeta, VOICEVOX_CORE};

/// get metas from voicevox core
#[tauri::command]
fn get_metas() -> VoiceModelMeta {
  let metas = &VOICEVOX_CORE.read().unwrap().metas;
  metas.clone()
}

/// encode text to audio query
#[tauri::command]
fn encode(text: &str, speaker_id: u32) -> std::result::Result<AudioQuery, String> {
  match VOICEVOX_CORE
    .read()
    .unwrap()
    .encode(text, speaker_id, None)
  {
    Ok(audio_query) => Ok(audio_query),
    Err(e) => Err(e.to_string()),
  }
}

/// decode audio query to waveform
#[tauri::command]
async fn decode(audio_query: AudioQuery, speaker_id: u32) -> Vec<u8> {
  let waveform = VOICEVOX_CORE
    .read()
    .unwrap()
    .decode(&audio_query, speaker_id, None)
    .unwrap();
  play_audio(waveform.clone()).await;
  waveform
}

/// play audio through Rust side
/// for safety and to avoid using the webaudio apis, they're terrible
#[tauri::command]
async fn play_audio(waveform: Vec<u8>) {
  // send to a new thread to avoid blocking the main thread
  audio_player::play_samples(waveform).unwrap();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![
      get_metas, encode, decode, play_audio
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
