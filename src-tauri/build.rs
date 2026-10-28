fn main() {
  collect_licenses();
  build_world();
  tauri_build::build()
}

/// Keep generated notices out of the source tree and embed them in every build.
fn collect_licenses() {
  println!("cargo:rerun-if-env-changed=CARGO_ABOUT");
  println!("cargo:rerun-if-env-changed=CARGO_NET_OFFLINE");
  let status = std::process::Command::new("node")
    .arg("../scripts/licenses.mjs")
    .arg(std::env::var_os("OUT_DIR").expect("Cargo must set OUT_DIR"))
    .status()
    .expect("License collection requires Node.js and pnpm; install the frontend prerequisites");
  assert!(
    status.success(),
    "Dependency license collection failed; see the diagnostics above"
  );
}

/// Compiles the WORLD vocoder (the `third_party/world` submodule) used by the post-processing
/// tab.
fn build_world() {
  let src = "third_party/world/src";
  if !std::path::Path::new(src).join("harvest.cpp").is_file() {
    panic!(
      "The WORLD submodule is missing; run `git submodule update --init` in the repository root"
    );
  }
  let files = [
    "cheaptrick",
    "common",
    "d4c",
    "fft",
    "harvest",
    "matlabfunctions",
    "synthesis",
  ];
  let mut build = cc::Build::new();
  build.cpp(true).include(src).warnings(false);
  for file in files {
    let path = format!("{src}/{file}.cpp");
    println!("cargo:rerun-if-changed={path}");
    build.file(path);
  }
  println!("cargo:rerun-if-changed={src}/world");
  build.compile("world");
}
