# Repository Guidelines

## Project Structure & Module Organization

Azalea is a Tauri 2 desktop application. The SolidJS/TypeScript frontend lives in `src/`: reusable UI belongs in `components/`, pages in `layout/`, shared state in `contexts/`, and translations in `i18n/`. Styles use colocated CSS modules; UnoCSS is configured in `uno.config.ts`.

The Rust backend is under `src-tauri/`. Tauri commands are grouped in `src-tauri/src/commands/`, configuration handling in `config/`, and audio code in `audio/`. Rust integration tests and fixtures live in `src-tauri/tests/`. Application icons are in `src-tauri/icons/`; project artwork is in `icon/`. Treat `src/binding.ts` as generated bindings and avoid hand-editing it.

## Project Files

`.azp` files are versioned TOML documents. The disk-only wrapper and
`CURRENT_PROJECT_SCHEMA_VERSION` live in
`src-tauri/src/commands/project.rs`; keep the schema marker at this
serialization boundary rather than adding it to the frontend `Project` model
unless the UI needs it as application state. Current saves must always include
the current schema version. Azalea is unreleased, so only the current schema is
supported; reject unversioned files and files with any other schema version.

Schema version `1` persists stable text-block and preset IDs plus preset
`speaker_uuid` and `style_name` fallbacks. Preserve IDs when loading or moving
existing blocks and presets, and generate a new ID only when creating or
copying one. Text blocks reference presets by stable ID rather than array
position. Resolve preset fallbacks against the current metadata before using a
numeric style ID; an unavailable stored identity must not silently select a
different speaker that reused the same numeric ID. Omit pristine generated
`AudioQuery` values from the disk DTO so they regenerate after loading, but
preserve manually edited queries as `query_override`; accent, phoneme, pitch,
and duration edits must set `query_is_modified`.

Evolve schema version `1` in place until the first release containing
versioned project files; do not add compatibility or migrations for unreleased
formats. Add Rust tests for the current-version round trip, malformed and
unversioned files, and rejection of unsupported versions. A disk-wrapper-only
change does not require regenerating `src/binding.ts`; changes to registered
command signatures or shared Rust command types do.

## Spectrogram Preview

The pitch-tuning panel in `src/components/BottomPanel.tsx` renders a mel spectrogram on a canvas behind the pitch controls. Do not show it in the accent panel. Its width follows the editable mora-duration timeline; configured leading and trailing silence is cropped from the preview so the image remains aligned with that timeline.

`request_spectrogram_preview` in `src-tauri/src/commands/core.rs` queues work
through the same reusable latest-generation job abstraction as buffered
waveform synthesis. Newer requests cancel stale running and pending preview
jobs for the same block. The worker reuses the waveform LRU cache, uses
cancellable nonblocking synthesis on a cache miss, decodes the cached WAV to
mono samples, and runs `MelSpec` from `src-tauri/src/audio/spectal.rs`. Keep the
frontend payload compact and normalized rather than transferring the full
waveform unless a future implementation specifically needs it. Run CPU-heavy
spectrogram extraction in a blocking task and suppress its result if the job
was cancelled.

Refresh behavior depends on `UIConfig.buffer_render`: with buffering enabled,
debounce queued refreshes alongside automatic waveform synthesis; without it,
queue a refresh only after playback has synthesized the waveform. Preserve the
previous canvas while a replacement is pending and render it grayed out until
the new spectrogram arrives. Match completion events by block ID, generation
ID, and hash so stale async responses cannot replace newer previews.

`UIConfig.spectrogram_preview` controls the feature and defaults to enabled. Disabling it must cancel pending refreshes, clear the canvas, and avoid spectrogram extraction. Keep its switch in `src/layout/ConfigPage.tsx`, synchronize its English, Japanese, and Simplified Chinese labels, and regenerate `src/binding.ts` after changing related Rust commands or types.

## Build, Test, and Development Commands

- `pnpm install` installs frontend and Tauri CLI dependencies.
- `pnpm tauri dev` runs the complete desktop app with hot reload.
- `pnpm dev` starts only the Vite frontend server.
- `pnpm build` creates the frontend bundle with Vite.
- `pnpm tauri build` creates a production desktop package.
- `pnpm check` runs Biome linting and formatting checks on `src/`.
- `pnpm test:run` runs the deterministic Vitest frontend suite once.
- `pnpm test:coverage` runs the frontend suite with a V8 coverage report and
  enforces at least 90% statements, branches, functions, and lines.
- `pnpm test:all` runs frontend checks, the frontend build, coverage-gated
  frontend tests, and every Rust test, including the real VOICEVOX pipeline.
- `cd src-tauri && cargo test --locked -- --test-threads=1` runs
  every Rust unit and integration test in one command, including the real
  VOICEVOX pipeline.
- `cd src-tauri && cargo test --lib regenerate_typescript_bindings` regenerates `src/binding.ts` without launching the desktop application.
- `cd src-tauri && cargo fmt --check` verifies Rust formatting.

Linux development also requires the Tauri prerequisites, `clang`, and `mold`. The development core path is stored in `config_dev/config.toml`.

`src/binding.ts` is generated from the registered Tauri commands, events, and their Rust types by `tauri-specta`. After changing any of them, agents and other automation should run the dedicated `regenerate_typescript_bindings` test and commit the resulting binding changes. Do not edit the generated file by hand.

## Coding Style & Naming Conventions

Use two-space indentation in both TypeScript and Rust, as configured by Biome and `rustfmt.toml`. Keep TypeScript strict and prefer focused Solid components. Name components and pages in `PascalCase.tsx`, context and utility modules in `camelCase.ts`, and CSS modules `*.module.css`. Rust modules, functions, and test files use `snake_case`; types use `PascalCase`. Run `pnpm check` and `cargo fmt` before submitting changes. Keep English, Japanese, and Simplified Chinese translation keys synchronized.

## Testing Guidelines

Keep frontend tests colocated as `*.test.ts` or `*.test.tsx`; shared DOM,
Tauri IPC/event mocks, providers, and VOICEVOX fixtures live in `src/test/`.
Use Vitest and Solid Testing Library to test behavior through accessible
interactions. Cover stale asynchronous responses, listener/timer cleanup, and
error paths explicitly. Do not make the default frontend suite depend on a
running Tauri application.

Add Rust unit tests beside the implementation and integration tests in
`src-tauri/tests/`, using descriptive `snake_case` test names. Use temporary
directories and Tauri's mock runtime where practical. Rust unit tests must not
depend on `config_dev`, VOICEVOX assets, network access, a graphical session,
audio hardware, or test ordering.

The complete Rust suite includes real VOICEVOX compatibility. It falls back to
the core in `config_dev/config.toml`; `AZALEA_TEST_CORE_DIR` overrides that
configuration:

```sh
cd src-tauri
cargo test --locked -- --test-threads=1
```

Do not ignore or feature-gate the real-core target. The complete suite must
fail clearly when neither the environment override nor the development
configuration supplies a valid core; do not silently skip it.

Keep frontend statement, branch, function, and line coverage at or above 90%.
`pnpm test:coverage` enforces these thresholds. Rust coverage is informational;
`pnpm test:coverage:rust` does not enforce a threshold. Future Rust coverage
enforcement is tracked in `.agents/todos/roadmap.md`.

## Commit & Pull Request Guidelines

Recent commits use short imperative, Conventional Commit-style prefixes such as `feat:`, `fix:`, and `chores:`. Keep each commit scoped to one concern. Open an issue before substantial work, as requested in the README. Pull requests should explain the problem and solution, link the issue, list validation commands, and include screenshots or recordings for visible UI changes. Avoid committing local core assets, generated build output, or machine-specific configuration.

## Git Guidelines

Prefer using `git add .` than `git add file1 file2 ...` to make review easier for the user.
