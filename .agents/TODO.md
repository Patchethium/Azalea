# Azalea TODO

Reviewed 13 October 2026 against `master` at `cd707c8`. This file replaces the
former `.agents/todos/` notes (public release, roadmap, shortcuts, tests).
Completed work and duplicate entries were removed; check items off here as
they land.

## Before the public preview

The gate for an announced, explicitly pre-1.0 preview: a new user can install
Azalea, finish the main workflow, recover from common mistakes, and uninstall
it without help.

### Data safety

- [x] **Sanitize generated WAV filenames.** `audio_export_path`
      (`src-tauri/src/commands/process.rs`) reduces block text to one
      portable file stem for single-block and Export All exports.
- [x] **Save projects and settings atomically.** `atomic_file::write_with_backup`
      writes a synced temporary sibling, keeps the previous version as
      `<name>.bak`, and renames into place.
- [ ] **Autosave unsaved drafts and offer Restore Draft on launch.** Autosave
      only runs once a project has a path; recover text, preset assignments,
      and manual tuning for never-saved projects after a crash.

### Errors and setup

- [ ] **Show failures in the UI with recovery actions.** Error toasts
      (`useToasts` in `src/components/toast`) now name the operation and file
      with the backend error as detail for project save/load, SRT import,
      audio export, playback, accent/phoneme edits, tuning reset, and config
      read/write failures. Still missing: Retry or Choose Another Location
      actions, and toasts for background synthesis failures.
- [ ] **Finish setup diagnostics.** The voice section already shows and
      re-picks Core paths and manages downloads. Still missing: separate
      messages for missing or incompatible runtime, dictionary, and VVM
      files; Back Up & Reset for a broken configuration; and a copyable
      diagnostic report (Azalea, OS/architecture, WebView/WebKitGTK and Core
      versions, relevant paths, recent errors).

### Release

- [ ] **Gate packaging on tests.** `.github/workflows/release.yml` packages
      without running the frontend checks/build/tests or the real-Core Rust
      suite.
- [ ] **Cut a new version and tag.** Package, Cargo, and Tauri are still at
      0.2.3 and the last tag is `app-v0.2.2`. Build every artifact from the
      tag and write feature notes, setup steps, and the `.azp` schema-1
      limitation into the release body.
- [ ] **Smoke-test packaged builds on clean machines** for Windows x64, macOS
      Apple Silicon, and Linux x64: install, first launch, voice setup
      (existing installation and download), non-ASCII user and project paths,
      the full edit → synthesize → export → save → reopen workflow, upgrade
      from 0.2.x settings, and uninstall.
- [ ] **Soak test a release build for one to two hours** (rapid edits,
      cancellation, sequence playback, reopening projects, sleep/wake) and
      check for unbounded memory, cache, or temporary-file growth.

### Announcement

- [ ] **Rewrite the README features and quickstart in English and
      Japanese.** The feature list predates spectrogram preview, pitch noise
      and completion, the voice downloader, portraits, Export All,
      drag-and-drop ordering, and Simplified Chinese.
- [ ] **Add a screenshot, a demo `.azp`, and a 30-second video with audio**
      near the top of the README: a short two-speaker Japanese script showing
      a preset change, pitch and spectrogram tuning, playback, and export.

## After the preview

### Editing

- [ ] Shared undo/redo for block operations (create, delete, move, split),
      preset assignments and values, and accent/phoneme/pitch/duration edits;
      one slider or pitch drag is one step. Text edits already have local
      history in `AutogrowInput`.
- [ ] Keep manual tuning when the voice changes: offer Keep Tuning /
      Regenerate instead of `updateProjectPreset` clearing the edit flags of
      every block using the preset.
- [x] Save Project As; update the active path only after a successful write.
      The project menu and the `save_project_as` shortcut (Ctrl/Cmd+Shift+S)
      always open the save dialog; the path, recent list, and saved state
      change only after the write succeeds.
- [x] Import `.txt` files and paste multi-line text as separate blocks, split
      by line or sentence (SRT import already exists). `splitTextIntoBlocks`
      in `src/utils.ts` follows `UIConfig.text_split_mode`.
- [ ] Join blocks and project-wide find and replace.
- [ ] Multi-block selection (range, toggle, Select All) with batch preset
      assignment, move, delete, play, and export.
- [ ] Keyboard reordering for blocks and presets; drag-and-drop is currently
      the only way and the Alt+↑/↓ attempt was removed.

### Voices and presets

- [ ] Speaker search and a voice-audition button in the speaker picker.
- [ ] Default preset, preset search/tags/favorites, and preset-pack
      import/export.
- [ ] Report project styles unavailable in the current model set; show the
      detected Core version; model preload/unload with a memory budget.

### Export

- [x] Combined single-WAV export with configured block silences. Export All
      as One File (`save_combined_audio`) joins every non-empty block's
      waveform, including its preset silences, with combined `.txt`/`.lab`
      sidecars.
- [ ] Filename templates.
- [ ] Sample-rate, loudness-normalization, and silence-trim options; evaluate
      FLAC and OGG.

### Playback

- [ ] Pause and resume, seeking and looping, a playhead over the spectrogram,
      configurable gaps in sequence playback, and output-device selection.

### Dictionary

- [ ] Project-specific entries, search, pronunciation preview, import/export,
      and multi-word entries with per-word accents.

### Keyboard workflow

Configurable shortcuts and the shortcut reference exist for save, save as, export,
play/stop, play current, play next, undo/redo, and the pitch-completion lock.

- [ ] Cell create/delete/move/navigate shortcuts that reuse the toolbar
      actions.
- [ ] Evaluate a notebook-style command/edit mode (`Enter`/`Esc`, single-letter
      structural commands) and a command palette.
- Conflict rules: preserve native text-editing shortcuts while editing; never
  override `Ctrl/Cmd + R/W/T/N`; ignore single-letter commands in text fields,
  listboxes, and dialogs; confirm destructive commands.

### Navigation

- [x] **Recent projects and an Open Previous Project action.** The project
      menu lists up to five recent projects (`UIConfig.recent_projects`) and
      reopens the most recent project other than the current one.
- [ ] A block outline with search and jump-to-result.

### Streaming synthesis

Blocked on upstream: voicevox_core 0.17.0 keeps `__precompute_render` /
`__render` hidden and blocking-only; a public `streaming_synthesis` API is on
`main` for 0.17.1 and may still change (#1364, #1454). Only the voicevox_vvm
0.17.0 pre-release ships the split decoder (`vvm_format_version` 2,
`streaming_talk`).

- [ ] Rebase the `generative-noise` fork onto the release with the public API:
      load v2 VVMs, move pitch noise and prefix inputs to `streaming_talk`,
      and keep the `specta` branch in sync.
- [ ] Benchmark `generate_full_intermediate` against `render_audio_segment`
      to confirm the time-to-first-audio gain is worth it.
- [ ] Feed rendered chunks to a channel-backed `rodio` source, fall back to
      full synthesis for v1 models, fill the waveform cache only after a
      complete render, and stop the chunk loop on stop or a newer generation.

### Optional

- [x] Single-instance handling for a second application launch. A second
      launch focuses the existing window and forwards an existing `.azp`
      argument as `OpenProjectRequested`. Opening a `.azp` passed to the first
      launch (and OS file associations) is still missing.
- [ ] Application updates and a release-notes view.
- [ ] A headless CLI for project validation and batch rendering.
- [ ] More locales (Traditional Chinese currently falls back to Simplified).
- [ ] Decide whether reference-audio guided synthesis stays in scope.

## Maintenance

- [ ] Enforce a measured Rust coverage baseline and publish frontend and Rust
      coverage artifacts in CI; only ratchet the gates upward.
- [ ] Re-sync or remove `vendor/voicevox_core-generative-noise` (at `5c47d2f`,
      while `Cargo.lock` pins `c0cf315`).
