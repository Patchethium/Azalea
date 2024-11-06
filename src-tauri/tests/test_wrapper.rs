#![allow(unused_variables)]
#[cfg(test)]
mod test {
  use azalea_lib::voicevox_sys::DynWrapper;
  use serde_json::to_string;
  use std::{
    panic,
    sync::{LazyLock, Mutex},
  };

  /// A lock to make the core thread-safe.
  /// TODO: Build the core with thread-safety.
  static SEMAPHORE: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

  fn get_core() -> DynWrapper {
    let path = std::env::var("VOICEVOX_CORE_DIR").unwrap();
    let path = std::path::PathBuf::from(&path);
    let core_path = path.to_string_lossy().to_string();
    if let Ok(ojt_path) = std::env::var("OPENJTALK_DIR") {
      // if it's set, use the openjtalk path
      DynWrapper::new(&core_path, Some(&ojt_path)).unwrap()
    } else {
      // let the wrapper search for the openjtalk path
      DynWrapper::new(&core_path, None).unwrap()
    }
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
    let join_handlers = (0..100)
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
}
