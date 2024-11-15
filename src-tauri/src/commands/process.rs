use tauri::AppHandle;

#[tauri::command]
#[specta::specta]
pub async fn quit(app: AppHandle) {
  app.exit(0);
}
