
use std::collections::HashMap;

use azalea_lib::config::ConfigManager;
use azalea_lib::voicevox_sys::metas::StyleType;
use azalea_lib::voicevox_sys::DynWrapper;
use rayon::prelude::*;
use serde_json::to_string;
use std::fs::write;
struct Welford {
  n: usize,
  mean: f32,
  m2: f32,
}

impl Welford {
  fn new() -> Self {
    Welford {
      n: 0,
      mean: 0.0,
      m2: 0.0,
    }
  }

  fn update(&mut self, x: f32) {
    self.n += 1;
    let delta = x - self.mean;
    self.mean += delta / self.n as f32;
    let delta2 = x - self.mean;
    self.m2 += delta * delta2;
  }

  fn mean(&self) -> f32 {
    self.mean
  }

  fn variance(&self) -> f32 {
    self.m2 / self.n as f32
  }

  fn std(&self) -> f32 {
    self.variance().sqrt()
  }
}

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

const BENCHMARK_TEXT: &str = "rashoumon.txt";
const PROJ_ROOT: &str = env!("CARGO_MANIFEST_DIR");

fn main() {
  let root = std::path::Path::new(PROJ_ROOT).to_path_buf();
  let core_path = get_core_dir();
  let core = DynWrapper::new(&core_path, None).unwrap();
  let metas = core.metas.clone();
  let pitch_range: std::sync::Mutex<HashMap<u32, (f32, f32)>> =
    std::sync::Mutex::new(HashMap::new());
  let text_path = root.join("benches").join(BENCHMARK_TEXT);
  let lines = std::fs::read_to_string(text_path).unwrap();
  let lines: Vec<&str> = lines.lines().collect();
  let threshold = 1.0;
  metas.iter().for_each(|m| {
    m.styles
      .iter()
      .filter(|s| s.r#type == StyleType::Talk)
      .for_each(|s| {
        let welford = std::sync::Mutex::new(Welford::new());
        let id = s.id;
        lines.par_iter().for_each(|line| {
          let line = line.trim();
          let audio_query = core.audio_query(line, id.raw_id(), None).unwrap();
          audio_query.accent_phrases.iter().for_each(|ap| {
            ap.moras.iter().for_each(|mora| {
              if mora.pitch > threshold {
                welford.lock().unwrap().update(mora.pitch);
              }
            });
          });
        });
        let mut mean = welford.lock().unwrap().mean();
        let mut std = welford.lock().unwrap().std();
        if mean < threshold {
          mean = 0.0;
          std = 0.0;
        }
        println!("{}/{}: mean: {}, std: {}", m.name, s.name, mean, std);
        pitch_range.lock().unwrap().insert(id.raw_id(), (mean, std));
      });
  });
  let serialized = to_string(&pitch_range).unwrap();
  write(root.join("src").join("assets").join("range.json"), serialized).unwrap();
}
