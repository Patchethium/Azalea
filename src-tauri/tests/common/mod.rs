use azalea_lib::{
  config::{ConfigManager, CoreConfig},
  core::Core,
};

pub fn test_core_config() -> CoreConfig {
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
