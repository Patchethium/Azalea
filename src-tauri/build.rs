use bindgen;
use std::fs;
use std::path::PathBuf;

fn main() {
  let voicevox_dir = std::env::var("VOICEVOX_CORE_DIR").expect("VOICEVOX_CORE_DIR is not set");
  let voicevox_dir = PathBuf::from(voicevox_dir);
  let header = voicevox_dir.join("voicevox_core.h");

  println!(
    "cargo:rustc-link-search=native={}",
    voicevox_dir.to_string_lossy()
  );
  println!("cargo:rustc-link-lib=dylib=voicevox_core");
  println!(
    "cargo:rustc-link-arg=-Wl,-rpath,{}",
    voicevox_dir.to_string_lossy()
  );

  let bindings = bindgen::Builder::default()
    .header(header.to_str().unwrap())
    .generate()
    .expect("Unable to generate bindings");

  let binding_dir = PathBuf::from("src/voicevox_sys/binding/");
  fs::create_dir_all(&binding_dir).expect("Couldn't create binding directory");
  let binding_path = binding_dir.join("voicevox_core.rs");
  bindings
    .write_to_file(binding_path)
    .expect("Couldn't write bindings!");
  tauri_build::build()
}
