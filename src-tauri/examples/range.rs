use std::collections::BTreeMap;
use std::fs::write;

use azalea_lib::{
  config::{range::PitchRange, ConfigManager, CoreConfig},
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
    .expect("failed to load config_dev/config.toml")
    .config
    .core
    .expect("configure a development core in config_dev/config.toml or set AZALEA_TEST_CORE_DIR")
}

fn main() {
  let root = std::path::Path::new(PROJ_ROOT).to_path_buf();
  let core = Core::init(&core_config()).unwrap();
  let metas = core.metas.clone();
  let mut pitch_range = BTreeMap::<StyleId, PitchRange>::new();
  let text_path = root.join("tests").join(BENCHMARK_TEXT);
  let lines = std::fs::read_to_string(text_path).unwrap();
  let lines: Vec<&str> = lines.lines().collect();

  metas.iter().for_each(|(_, characters)| {
    characters.iter().for_each(|character| {
      for style in character.styles.clone() {
        let id = style.id;
        let values: Vec<f32> = lines
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

        let range = PitchRange::from_samples(values);
        println!(
          "{}/{}: low: {}, high: {}",
          character.name, style.name, range.min, range.max
        );
        pitch_range.insert(id, range);
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
