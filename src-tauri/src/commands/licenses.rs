use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
pub struct LicensePackage {
  pub name: String,
  pub version: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
pub struct DependencyLicense {
  pub id: String,
  pub name: String,
  pub text: String,
  pub packages: Vec<LicensePackage>,
}

/// The complete notices travel with the binary, including in offline installations.
#[tauri::command]
#[specta::specta]
pub fn get_dependency_licenses() -> Vec<DependencyLicense> {
  static LICENSES: OnceLock<Vec<DependencyLicense>> = OnceLock::new();
  LICENSES
    .get_or_init(|| {
      serde_json::from_str(include_str!(concat!(
        env!("OUT_DIR"),
        "/dependency-licenses.json"
      )))
      .expect("The build-time license collector must produce a valid report")
    })
    .clone()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn embedded_notices_include_dependencies_and_world_verbatim() {
    let licenses = get_dependency_licenses();
    assert!(licenses
      .iter()
      .any(|license| license.packages.iter().any(|pkg| pkg.name == "tauri")));
    assert!(licenses
      .iter()
      .any(|license| license.packages.iter().any(|pkg| pkg.name == "solid-js")));
    let world = licenses
      .iter()
      .find(|license| license.packages.iter().any(|pkg| pkg.name == "WORLD"))
      .expect("WORLD must be included manually");
    assert_eq!(
      world.text,
      include_str!("../../third_party/world/LICENSE.txt").replace("\r\n", "\n")
    );
    assert!(licenses
      .iter()
      .all(|license| !license.text.trim().is_empty() && !license.packages.is_empty()));
    assert_eq!(
      serde_json::to_value(&licenses).unwrap(),
      serde_json::to_value(get_dependency_licenses()).unwrap()
    );
  }
}
