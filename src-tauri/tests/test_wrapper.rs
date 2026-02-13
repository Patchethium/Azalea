#![allow(unused_variables)]
#[cfg(test)]
mod test {
  use azalea_lib::{
    config::{ConfigManager, CoreConfig},
    core::Core,
  };
  use ndarray::Array1;
  use serde_json::to_string;
  use std::{
    panic,
    sync::{Arc, Mutex},
  };
  use voicevox_core::StyleId;

  fn get_core_config() -> CoreConfig {
    ConfigManager::new().unwrap().config.core_config.unwrap()
  }

  fn get_core() -> Core {
    let cfg = get_core_config();
    Core::init(&cfg).unwrap()
  }
  #[test]
  fn test_init_voicevox() {
    let _ = get_core();
  }
  #[test]
  fn test_metas() {
    let metas = get_core().metas.clone();
    println!("{:?}", metas.values().next().unwrap()[0]);
  }

  #[test]
  fn test_query() {
    let audio_query = get_core().audio_query("こんにちは", StyleId(1)).unwrap();
    println!("{:?}", to_string(&audio_query));
  }

  #[test]
  fn test_synthesis() {
    let audio_query = get_core().audio_query("こんにちは", StyleId(1)).unwrap();
    let _ = get_core().synthesis(&audio_query, StyleId(1)).unwrap();
  }

  #[test]
  fn test_parallel_query() {
    panic::set_hook(Box::new(|panic_info| {
      // Print the panic message and unwind the stack
      eprintln!("Panic occurred in a spawned thread: {:?}", panic_info);
      std::process::exit(1);
    }));
    let arc = Arc::new(Mutex::new(get_core()));
    let join_handlers = (0..10)
      .map(|i| {
        let arc_clone = arc.clone();
        std::thread::spawn(move || {
          let audio_query = arc_clone
            .lock()
            .unwrap()
            .audio_query("こんにちは", StyleId(1));
          match audio_query {
            Ok(audio_query) => println!("Thread {} finished", i),
            Err(e) => panic!("Thread {} panicked {:?}", i, e),
          }
        })
      })
      .collect::<Vec<_>>();

    for h in join_handlers {
      h.join().unwrap();
    }
  }

  #[test]
  fn test_parallel_synthesize() {
    panic::set_hook(Box::new(|panic_info| {
      // Print the panic message and unwind the stack
      eprintln!("Panic occurred in a spawned thread: {:?}", panic_info);
      std::process::exit(1);
    }));
    let arc = Arc::new(Mutex::new(get_core()));
    let join_handlers = (0..10)
      .map(|i| {
        let arc_clone = arc.clone();
        std::thread::spawn(move || {
          let audio_query = arc_clone
            .lock()
            .unwrap()
            .audio_query("こんにちは", StyleId(1))
            .unwrap();
          let _ = arc_clone
            .lock()
            .unwrap()
            .synthesis(&audio_query, StyleId(1))
            .unwrap();
          println!("Thread {} finished", i);
        })
      })
      .collect::<Vec<_>>();

    for h in join_handlers {
      h.join().unwrap();
    }
  }

  #[test]
  fn test_spectal() {
    let mut mel = azalea_lib::audio::spectal::MelSpec::new(1024, 512, 256, 24000);
    let core = get_core();
    let audio_query = core.audio_query("こんにちは", StyleId(1)).unwrap();
    let signal = core.synthesis(&audio_query, StyleId(1)).unwrap();
    let signal = signal.iter().map(|&x| x as f64).collect::<Array1<f64>>();
    let _ = mel.process(signal);
  }
}
