#[cfg(test)]
mod test {
  use serde_json::to_string;
  use azalea_lib::voicevox_sys::VOICEVOX_CORE;
  use azalea_lib::audio::player::play_samples;

  #[test]
  fn test_init_voicevox() {
    let _ = VOICEVOX_CORE.read().unwrap().metas;
  }
  #[test]
  fn test_metas() {
    let metas = &VOICEVOX_CORE.read().unwrap().metas;
    println!("{:?}", metas[0].styles[0].id);
  }

  #[test]
  fn test_tts() {
    let _ = VOICEVOX_CORE
      .read()
      .unwrap()
      .tts("こんにちは", 1, None)
      .unwrap();
  }

  #[test]
  fn test_encode() {
    let audio_query = VOICEVOX_CORE
      .read()
      .unwrap()
      .encode("こんにちは", 1, None)
      .unwrap();
    println!("{:?}", to_string(&audio_query));
  }

  #[test]
  fn test_decode() {
    let audio_query = VOICEVOX_CORE
      .read()
      .unwrap()
      .encode("こんにちは", 1, None)
      .unwrap();
    let _ = VOICEVOX_CORE
      .read()
      .unwrap()
      .decode(&audio_query, 1, None)
      .unwrap();
  }

  #[test]
  fn test_play_audio() {
    let audio_query = VOICEVOX_CORE
      .read()
      .unwrap()
      .encode("こんにちは", 1, None)
      .unwrap();
    let waveform = VOICEVOX_CORE
      .read()
      .unwrap()
      .decode(&audio_query, 1, None)
      .unwrap();
    play_samples(waveform).unwrap();
  }
}
