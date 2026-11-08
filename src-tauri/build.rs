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
  compress_licenses();
}

/// The license texts are mostly repeated boilerplate, so the binary embeds them compressed.
fn compress_licenses() {
  use std::io::Write;

  let out_dir = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
  let report = std::fs::read(out_dir.join("dependency-licenses.json"))
    .expect("The license collector must write its report");
  let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
  encoder.write_all(&report).unwrap();
  std::fs::write(
    out_dir.join("dependency-licenses.json.gz"),
    encoder.finish().unwrap(),
  )
  .expect("Failed to write the compressed license report");
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
  // WORLD at -O0 makes post-processing and voice import several times slower
  // in dev and test builds; release keeps the profile's size optimization.
  if std::env::var("OPT_LEVEL").as_deref() == Ok("0") {
    build.opt_level(2);
  }
  for file in files {
    let path = format!("{src}/{file}.cpp");
    println!("cargo:rerun-if-changed={path}");
    build.file(path);
  }
  println!("cargo:rerun-if-changed={src}/world");
  build.compile("world");
}
