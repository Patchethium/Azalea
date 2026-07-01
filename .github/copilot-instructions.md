# Azalea Copilot Instructions

## Build, test, and lint commands

- Install deps with `pnpm i`.
- Start the desktop app in development with `pnpm tauri dev`.
- Build the frontend only with `pnpm build`.
- Build the desktop app with `pnpm tauri build`.
- Run the frontend formatter/linter with `pnpm check`.
- Run all Rust tests with `cargo test --manifest-path src-tauri/Cargo.toml`.
- Run one Rust test with `cargo test --manifest-path src-tauri/Cargo.toml --test test_wrapper test::test_query -- --exact --nocapture`.

The Rust tests and `pnpm tauri dev` rely on a configured VOICEVOX core. In debug builds, the app reads and writes its config at `config_dev/config.json`.

## High-level architecture

Azalea is a Tauri desktop app with a SolidJS frontend in `src/` and a Rust backend in `src-tauri/`.

- `src/index.tsx` boots the app by wrapping `App` in a `MultiProvider`. The provider order matters: `MetaProvider`, `UIProvider`, `ConfigProvider`, `SystemProvider`, `i18nProvider`, then `TextProvider`.
- `src/App.tsx` drives startup. It loads persisted config with `commands.initConfig()`, lets `ConfigProvider` initialize the VOICEVOX core, shows `InitDialog` until the core is ready, and then switches between `MainPage` and `ConfigPage`.
- The main UI is split between `src/layout/Sidebar.tsx` for preset/speaker/project actions and `src/layout/MainPage.tsx` for the text-block editor plus the lower tuning/accent panel.
- Frontend state is intentionally divided by concern:
  - `src/contexts/config.ts` owns persisted config plus core initialization and pitch-range loading.
  - `src/contexts/meta.ts` owns speaker/style metadata.
  - `src/contexts/text.ts` owns the current project: text blocks, project presets, and the open project path.
  - `src/contexts/ui.ts` owns selection and page/panel state.
  - `src/contexts/i18n.ts` and `src/i18n/index.ts` provide locale-aware translation with English fallback.
- Rust starts in `src-tauri/src/main.rs`, then `src-tauri/src/lib.rs` creates the shared `AppState`, registers Tauri commands, and exports TypeScript bindings to `src/binding.ts` in debug builds via `tauri-specta`.
- The backend command surface is split by responsibility under `src-tauri/src/commands/`: core synthesis and caching in `core.rs`, config persistence in `config.rs`, project load/save in `project.rs`, and playback/process helpers in `process.rs`.
- `src-tauri/src/core.rs` wraps `voicevox_core`. It discovers the runtime library, OpenJTalk dictionary, and `.vvm` files, lazily loads voice models, and performs synthesis.

## Key conventions

- Do not hand-edit `src/binding.ts`. It is generated from Rust commands in debug builds and is intentionally excluded from Biome checks.
- New frontend/backend calls should be added as Tauri commands with `#[tauri::command]` and `#[specta::specta]`, then consumed through `commands` from `src/binding.ts` instead of raw `invoke()` calls.
- `ConfigProvider` is more than storage: changing `config.core_config` triggers `commands.initCore()` through a Solid `createResource`. The `"Core already loaded"` error is treated as a successful restore path.
- `MetaProvider` normalizes raw backend metadata by merging entries with the same `speaker_uuid` and sorting styles. UI code should use `useMetaStore()` rather than assuming `commands.getMetas()` already returns display-ready data.
- Audio synthesis is cache-oriented. The backend keeps LRU caches in `AppState`, `commands.synthesize()` warms the cache, and the frontend checks progress by polling `commands.synthesizeState()` instead of waiting for events.
- Preserve the query-modification flow in `src/utils.ts`: preset values are applied by cloning an `AudioQuery` and rewriting `pitchScale`, `speedScale`, `intonationScale`, `volumeScale`, and the phoneme-length fields there.
- Preset silence values are handled in frontend milliseconds and converted to seconds inside `getModifiedQuery()`. Follow that existing conversion instead of writing query timing fields directly.
- The app persists config as JSON, not TOML. Debug builds use `config_dev/config.json`; release builds use the OS config directory under `azalea/`.
- `src/contexts/text.ts` seeds a sample Japanese block only in dev mode. Keep that behavior behind `import.meta.env.DEV` if you touch project initialization.
- Locale files live in `src/i18n/*.json`. `src/i18n/index.ts` treats English as the fallback source of truth and merges other locales onto it, so missing keys should usually be added to `en.json` first.
- `src-tauri/src/core.rs` searches for the VOICEVOX assets recursively with `WalkDir::max_depth(8)`. If core-path discovery changes, keep the ONNX runtime library, `open_jtalk_dic_utf_8-1.11`, and `.vvm` model lookup in sync.
- `src-tauri/build.rs` prepares the bundled pitch-range asset before Rust builds. It writes `range.json` to `OUT_DIR`, regenerates it when a usable Azalea config is available, and otherwise falls back to the committed `src-tauri/src/assets/range.json`.
