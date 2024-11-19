#![allow(unused_variables)]
#[cfg(test)]
mod test {
  use azalea_lib::{config::ConfigManager, voicevox_sys::DynWrapper};
  use ndarray::Array1;
  use serde_json::to_string;
  use std::{
    panic,
    sync::{LazyLock, Mutex},
  };

  /// A lock to make the core thread-safe. In the application tauri will take care of this.
  /// TODO: Build the core with thread-safety.
  static SEMAPHORE: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

  fn get_core_dir() -> String {
    ConfigManager::new()
      .unwrap()
      .config
      .core_config
      .core_path
      .unwrap()
      .to_string_lossy()
      .to_string()
  }

  fn get_core() -> DynWrapper {
    let core_path = get_core_dir();

    DynWrapper::new(&core_path, None).unwrap()
  }
  #[test]
  fn test_init_voicevox() {
    let g = SEMAPHORE.lock().unwrap();
    let _ = get_core();
  }
  #[test]
  fn test_metas() {
    let g = SEMAPHORE.lock().unwrap();
    let metas = get_core().metas.clone();
    println!("{:?}", metas[0].styles[0].id);
  }

  #[test]
  fn test_query() {
    let g = SEMAPHORE.lock().unwrap();
    let audio_query = get_core().audio_query("こんにちは", 1, None).unwrap();
    println!("{:?}", to_string(&audio_query));
  }

  #[test]
  fn test_synthesis() {
    let g = SEMAPHORE.lock().unwrap();
    let audio_query = get_core().audio_query("こんにちは", 1, None).unwrap();
    let _ = get_core().synthesis(&audio_query, 1, None).unwrap();
  }

  #[test]
  fn test_parallel_query() {
    let g = SEMAPHORE.lock().unwrap();
    panic::set_hook(Box::new(|panic_info| {
      // Print the panic message and unwind the stack
      eprintln!("Panic occurred in a spawned thread: {:?}", panic_info);
      std::process::exit(1);
    }));
    let arc = std::sync::Arc::new(std::sync::RwLock::new(get_core()));
    let join_handlers = (0..10)
      .map(|i| {
        let arc_clone = arc.clone();
        std::thread::spawn(move || {
          let audio_query = arc_clone.read().unwrap().audio_query("こんにちは", 1, None);
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
    let g = SEMAPHORE.lock().unwrap();
    panic::set_hook(Box::new(|panic_info| {
      // Print the panic message and unwind the stack
      eprintln!("Panic occurred in a spawned thread: {:?}", panic_info);
      std::process::exit(1);
    }));
    let arc = std::sync::Arc::new(std::sync::RwLock::new(get_core()));
    let join_handlers = (0..10)
      .map(|i| {
        let arc_clone = arc.clone();
        std::thread::spawn(move || {
          let audio_query = arc_clone
            .read()
            .unwrap()
            .audio_query("こんにちは", 1, None)
            .unwrap();
          let _ = arc_clone
            .read()
            .unwrap()
            .synthesis(&audio_query, 1, None)
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
    let g = SEMAPHORE.lock().unwrap();
    let mut mel = azalea_lib::spectal::mel::MelSpec::new(1024, 512, 256, 24000);
    let core = get_core();
    let audio_query = core.audio_query("こんにちは", 1, None).unwrap();
    let signal = core.synthesis(&audio_query, 1, None).unwrap();
    let signal = signal.iter().map(|&x| x as f64).collect::<Array1<f64>>();
    let _ = mel.process(signal);
  }
}
