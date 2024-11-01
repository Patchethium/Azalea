//! TODO: there's no reason we pass the audio to frontend, we can keep it in the buffer and avoid the IPC overhead
pub mod voicevox_sys;
pub mod audio_player;

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
  match VOICEVOX_CORE.write().unwrap().encode(text, speaker_id, None) {
    Ok(audio_query) => Ok(audio_query),
    Err(e) => Err(e.to_string()),
  }
}

/// decode audio query to waveform
#[tauri::command]
fn decode(audio_query: AudioQuery, speaker_id: u32) -> std::result::Result<Vec<u8>, String> {
  match VOICEVOX_CORE.write().unwrap().decode(&audio_query, speaker_id, None) {
    Ok(waveform) => Ok(waveform),
    Err(e) => Err(e.to_string()),
  }
}

/// play audio through Rust side
/// for safety and to avoid using the webaudio apis, they're terrible
#[tauri::command]
fn play_audio(waveform: Vec<u8>) {
  // send to a new thread to avoid blocking the main thread
  std::thread::spawn(move || {
    audio_player::play_samples(waveform).unwrap();
  });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![get_metas, encode, decode, play_audio])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
