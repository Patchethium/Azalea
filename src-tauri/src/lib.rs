//! TODO: there's no reason we pass the audio to frontend, we can keep it in the buffer and avoid the IPC overhead
use specta_typescript::Typescript;

use tauri_specta::{collect_commands, Builder};


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = Builder::<tauri::Wry>::new().commands(collect_commands![]);

  // In debug mode, export the typescript bindings
  #[cfg(debug_assertions)]
  builder
    .export(
      Typescript::default().bigint(specta_typescript::BigIntExportBehavior::Number),
      "../src/binding.ts",
    )
    .expect("Failed to export typescript");

  let app = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init());

  #[cfg(not(debug_assertions))] // prevent default on release build
  let app = app.plugin(tauri_plugin_prevent_default::init());

  app
    .manage({})
    .invoke_handler(builder.invoke_handler())
    .setup(move |app| {
      builder.mount_events(app);
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
