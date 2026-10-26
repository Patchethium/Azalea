fn main() {
  build_world();
  tauri_build::build()
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
