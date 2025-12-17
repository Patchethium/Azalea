use azalea_lib::app::state::{AppConfig, AppStateInner, RangeMap};

pub fn main() {
  let cfg = AppConfig::read(None).unwrap();
  let mut state = AppStateInner::default();
  let core_cfg = cfg.core.expect("No core config found.");
  state.load_core(&core_cfg).expect("Failed to load core.");
  let metas = state.core.as_ref().unwrap().metas.clone();
  let mut range_map = RangeMap::new();
  for m in metas.values().flatten() {
    for st in &m.styles {
      state
        .core
        .as_mut()
        .unwrap()
        .load_voice_model_by_id(st.id.clone())
        .unwrap();
      let range = state
        .core
        .as_ref()
        .unwrap()
        .optimal_pitch_range(st.id.clone(), 0.98);
      range_map.insert(st.id.clone(), range.clone());
      println!("Style ID: {:?}, Range: {:?}", st.id, range);
    }
  }
  let range_str = toml::to_string(&range_map).unwrap();
  let cargo_manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
  let mut output_path = std::path::PathBuf::from(cargo_manifest_dir);
  output_path.push("src");
  output_path.push("assets");
  output_path.push("range.toml");
  std::fs::write(output_path, range_str).unwrap();
}
