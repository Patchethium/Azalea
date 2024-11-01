#[cfg(test)]
mod test {
  use azalea_lib::voicevox_sys::VOICEVOX_CORE;

  #[test]
  fn test_init_voicevox() {
    let _ = VOICEVOX_CORE.get_metas();
  }
  #[test]
  fn test_metas() {
    let metas = VOICEVOX_CORE.get_metas().unwrap();
    println!("{:?}", metas[0].styles[0].id);
  }

  #[test]
  fn test_tts() {
    let waveform = VOICEVOX_CORE.tts("こんにちは", 1, None).unwrap();
    println!("{:?}", waveform);
  }
}
