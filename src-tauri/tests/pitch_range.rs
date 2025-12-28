#[cfg(test)]
mod test {

  use std::collections::HashMap;

  use azalea_lib::{
    config::{ConfigManager, CoreConfig},
    core::Core,
  };
  use serde_json::to_string;
  use std::fs::write;
  use voicevox_core::StyleId;

  fn get_core_config() -> CoreConfig {
    ConfigManager::new().unwrap().config.core_config.unwrap()
  }

  const BENCHMARK_TEXT: &str = "rashoumon.txt";
  const PROJ_ROOT: &str = env!("CARGO_MANIFEST_DIR");

  // gets each character's pitch range
  // it takes around 1 minute without console messages, wait patiently
  #[test]
  #[ignore = "this test is slow and is only used when core characters change"]
  fn pitch_range() {
    let root = std::path::Path::new(PROJ_ROOT).to_path_buf();
    let core_cfg = get_core_config();
    let core = Core::init(&core_cfg).unwrap();
    let metas = core.metas.clone();
    let pitch_range: std::sync::Mutex<HashMap<StyleId, (f32, f32)>> =
      std::sync::Mutex::new(HashMap::new());
    let text_path = root.join("tests").join(BENCHMARK_TEXT);
    let lines = std::fs::read_to_string(text_path).unwrap();
    let lines: Vec<&str> = lines.lines().collect();
    metas.iter().for_each(|(_, m)| {
      m.into_iter().for_each(|cm| {
        for s in cm.styles.clone() {
          let id = s.id;
          let mut values: Vec<f32> = lines
            // loaded speaker is not thread safe, don't use par-iter here
            // TODO: make it safe
            .iter()
            .flat_map(|line| {
              let line = line.trim();
              let audio_query = core.audio_query(line, id).unwrap();
              audio_query
                .accent_phrases
                .iter()
                .flat_map(|ap| ap.moras.iter().map(|mora| mora.pitch))
                .filter(|&pitch| pitch > 0.1)
                .collect::<Vec<_>>()
            })
            .collect();

          values.sort_by(|a, b| a.partial_cmp(b).unwrap());

          let count = values.len();
          let (low, high) = if count == 0 {
            (0.0, 0.0)
          } else {
            let target_count = (count as f32 * 0.97).ceil() as usize;
            let target_count = target_count.max(1);

            if target_count >= count {
              (*values.first().unwrap(), *values.last().unwrap())
            } else {
              let mut min_range_len = f32::INFINITY;
              let mut best_pair = (0.0, 0.0);
              for i in 0..=(count - target_count) {
                let start = values[i];
                let end = values[i + target_count - 1];
                let diff = end - start;
                if diff < min_range_len {
                  min_range_len = diff;
                  best_pair = (start, end);
                }
              }
              best_pair
            }
          };
          println!("{}/{}: low: {}, high: {}", cm.name, s.name, low, high);
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
}
