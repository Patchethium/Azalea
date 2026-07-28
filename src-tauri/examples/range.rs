use std::collections::HashMap;
use std::fs::write;

use azalea_lib::{
  config::{ConfigManager, CoreConfig},
  core::Core,
};
use serde_json::to_string;
use voicevox_core::StyleId;

const BENCHMARK_TEXT: &str = "rashoumon.txt";
const PROJ_ROOT: &str = env!("CARGO_MANIFEST_DIR");

fn core_config() -> CoreConfig {
  if let Some(root) = std::env::var_os("AZALEA_TEST_CORE_DIR") {
    return Core::find_path(std::path::Path::new(&root))
      .expect("AZALEA_TEST_CORE_DIR does not contain all required core assets");
  }

  ConfigManager::new()
    .expect("failed to load config_dev/config.json")
    .config
    .core_config
    .expect("configure a development core in config_dev/config.json or set AZALEA_TEST_CORE_DIR")
}

fn main() {
  let root = std::path::Path::new(PROJ_ROOT).to_path_buf();
  let core = Core::init(&core_config()).unwrap();
  let metas = core.metas.clone();
  let pitch_range: std::sync::Mutex<HashMap<StyleId, (f32, f32)>> =
    std::sync::Mutex::new(HashMap::new());
  let text_path = root.join("tests").join(BENCHMARK_TEXT);
  let lines = std::fs::read_to_string(text_path).unwrap();
  let lines: Vec<&str> = lines.lines().collect();

  metas.iter().for_each(|(_, characters)| {
    characters.iter().for_each(|character| {
      for style in character.styles.clone() {
        let id = style.id;
        let mut values: Vec<f32> = lines
          // Loaded speakers are not thread-safe, so do not use par_iter here.
          .iter()
          .flat_map(|line| {
            let audio_query = core.audio_query(line.trim(), id).unwrap();
            audio_query
              .accent_phrases
              .iter()
              .flat_map(|phrase| phrase.moras.iter().map(|mora| mora.pitch))
              .filter(|&pitch| pitch > 0.1)
              .collect::<Vec<_>>()
          })
          .collect();

        values.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let count = values.len();
        let (low, high) = if count == 0 {
          (0.0, 0.0)
        } else {
          let target_count = ((count as f32 * 0.97).ceil() as usize).max(1);
          if target_count >= count {
            (*values.first().unwrap(), *values.last().unwrap())
          } else {
            let mut min_range_len = f32::INFINITY;
            let mut best_pair = (0.0, 0.0);
            for index in 0..=(count - target_count) {
              let start = values[index];
              let end = values[index + target_count - 1];
              let difference = end - start;
              if difference < min_range_len {
                min_range_len = difference;
                best_pair = (start, end);
              }
            }
            best_pair
          }
        };
        println!(
          "{}/{}: low: {}, high: {}",
          character.name, style.name, low, high
        );
        pitch_range.lock().unwrap().insert(id, (low, high));
      }
    });
  });

  let serialized = to_string(&pitch_range).unwrap();
  write(
    root.join("src").join("assets").join("range.json"),
    serialized,
  )
  .unwrap();
}
