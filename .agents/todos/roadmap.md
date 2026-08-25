# Azalea Development Roadmap

This backlog prioritizes making the existing editing and synthesis workflow
reliable and efficient before adding larger experimental features.

Tier meanings:

- **Urgent:** correctness, data-safety, or startup problems that should be
  resolved before expanding the product.
- **Necessary:** core editor workflows expected in a practical TTS application.
- **Ordinary:** valuable productivity and polish improvements.
- **Optional:** larger differentiators or conveniences that are not required for
  the core workflow.

## Urgent

### Reliable empty-project state

- [x] Guarantee that a new project always contains at least one editable text
      block.
- [x] Add an explicit empty-state action for creating the first block.
- [x] Guard every selected-block lookup and keep the selected index in bounds
      after loading, deleting, or resetting blocks.

### Project safety and recovery

- [ ] Track whether the current project has unsaved changes and show that state
      in the UI.
- [ ] Confirm before New, Open, Close, or destructive operations would discard
      unsaved work.
- [ ] Save projects and configuration atomically through a temporary file and
      replacement.
- [ ] Keep a recoverable backup or draft for interrupted and failed saves.
- [ ] Restore the previous project or unsaved draft after a crash.

### Visible errors and setup diagnostics

- [ ] Replace console-only save, load, playback, synthesis, export, and
      initialization failures with actionable UI feedback.
- [ ] Add shared operation states for loading, success, failure, and retry.
- [ ] Validate a selected VOICEVOX Core directory and identify missing or
      incompatible ONNX Runtime, OpenJTalk, and VVM assets separately.
- [ ] Let the user retry initialization or select a different Core without
      restarting Azalea.
- [ ] Provide a copyable diagnostic summary for setup failures.

### Preset and editor correctness

- [ ] Remap every block's preset reference correctly after deleting or
      reordering presets.
- [ ] Validate style IDs by value rather than by array index.
- [ ] Preserve manual accent, pitch, and duration edits when changing a preset
      unless the user explicitly requests regeneration.
- [ ] Prevent stale asynchronous audio-query responses from replacing newer
      text or speaker edits.
- [ ] Ensure pitch, duration, accent, phoneme, and preset changes invalidate and
      regenerate the correct cached waveform.

### Responsive synthesis jobs

- [x] Move blocking query and synthesis work onto a bounded background worker
      system.
- [x] Avoid holding shared cache locks while inference is running.
- [x] Give each request a generation ID so stale work can be ignored or
      cancelled safely.
- [x] Expose queued, running, completed, failed, cancelled, and evicted states
      through events.
- [x] Add per-block cancellation and reliable cache-eviction notification.
- [x] Extract the keyed, latest-generation queue, cancellation, and lifecycle
      event behavior into a reusable async-job abstraction.
- [x] Use that abstraction for both waveform synthesis and spectrogram preview
      so a newer request cancels stale running and pending work for the same
      block instead of leaving blocking preview synthesis behind the core gate.
- [x] Cover rapid tuning with concurrent waveform and spectrogram requests,
      including native cancellation, cache reuse, stale-response rejection, and
      proof that only the latest generation can consume inference time.

### Project format

- [x] Add a schema version to `.azp` files.
- [x] Validate project files and reject unsupported schema versions.
- [x] Give blocks stable IDs instead of relying only on array positions.
- [x] Store speaker/style identity fallbacks for projects opened with a
      different model set.
- [x] Avoid persisting derived `AudioQuery` data when it can be regenerated
      safely.

## Necessary

### Undo and redo

- [ ] Add shared undo/redo history for text edits.
- [ ] Include block creation, deletion, movement, split, and join operations.
- [ ] Include preset assignment and parameter changes.
- [ ] Include accent, phoneme, pitch, and duration edits.
- [ ] Coalesce continuous slider and drag changes into single history entries.

### Multi-block selection and batch actions

- [ ] Support range selection, toggle selection, and Select All.
- [ ] Apply a preset to all selected blocks.
- [ ] Move, delete, synthesize, and play selected blocks.
- [ ] Keep batch operations undoable.
- [ ] Make selection state clear and keyboard accessible.

### Silent and batch export

- [ ] Export the current block without reopening a save dialog after an output
      directory has been configured.
- [ ] Export selected blocks or the complete project.
- [ ] Support a combined WAV export with configured block silences.
- [ ] Add filename templates and deterministic collision handling.
- [ ] Show queue progress, per-item failures, cancellation, and a completion
      summary.

### Script import and organization

- [ ] Import plain-text files and multi-line clipboard content.
- [ ] Split imported text by line, sentence, or configurable punctuation.
- [ ] Join selected blocks and split a block at the cursor.
- [ ] Add project-wide find and replace.

### Complete keyboard workflow

- [ ] Extract shared cell actions so toolbar buttons and shortcuts use the same
      implementation.
- [ ] Add focus-safe create, delete, move, and navigation shortcuts.
- [ ] Add accessible shortcut labels to relevant controls.
- [ ] Add a visually distinct notebook-style command/edit mode.
- [ ] Keep native text-editing and platform shortcuts intact while editing.
- [ ] Keep `.agents/todos/shortcutkey.md` synchronized with implemented
      shortcuts.

### User dictionary and pronunciation management

- [ ] Add global and project-specific OpenJTalk dictionary entries.
- [ ] Support create, edit, delete, search, and pronunciation preview.
- [ ] Support multi-word dictionary entries with a separate pronunciation and
      accent position for each word while managing them as one phrase.
- [ ] Import and export dictionary entries.
- [ ] Indicate which project blocks depend on a project dictionary entry.

### Core and model management

- [ ] Show the active Core path, detected version, available models, and loaded
      models.
- [ ] Allow changing or rescanning the Core from settings.
- [ ] Report project styles that are unavailable in the current model set.
- [ ] Allow preloading or unloading models and enforce a memory budget.

## Ordinary

### Project navigation

- [ ] Add a project outline or block index.
- [ ] Add block search, filtering, and jump-to-result.
- [ ] Add recent projects and an Open Previous Project action.

### Playback transport

- [ ] Add pause and resume.
- [ ] Add seeking, scrubbing, and loop playback.
- [ ] Highlight the active block and display a playhead over the spectrogram.
- [ ] Allow configurable gaps between blocks during sequence playback.
- [ ] Add audio output-device selection.

### Advanced tuning tools

- [ ] Support multi-mora selection.
- [ ] Add copy and paste for pitch, duration, and prosody.
- [ ] Add smoothing and reset-selection operations.
- [ ] Add precise numeric entry for selected tuning values.

### Preset library improvements

- [ ] Add preset duplication and safe renaming.
- [ ] Add search, tags, favorites, and a configurable default preset.
- [ ] Add quick auditioning before applying a preset.
- [ ] Import and export preset packs.

### Export profiles

- [ ] Add sample-rate and channel settings where supported.
- [ ] Add loudness normalization and optional silence trimming.
- [ ] Add optional metadata or timing sidecar files.
- [ ] Evaluate explicit FLAC and OGG encoders.

### Performance controls

- [ ] Display cache and loaded-model memory usage.
- [ ] Add a Clear Cache action and configurable byte-based cache limits.
- [ ] Add model preload and smarter eviction preferences.
- [ ] Evaluate CPU/GPU selection and a small automatic benchmark.

## Optional

### Guided Synthesis

- [ ] Decide whether reference-audio alignment remains in scope.
- [ ] If retained, design audio import, forced alignment, timing review, and
      timing transfer as a standalone feature.
- [ ] Until it exists, remove or clearly qualify the current README claim.

### Managed installation and updates

- [ ] Evaluate a VOICEVOX Core and model downloader with integrity checks.
- [ ] Add model update detection if managed downloads are adopted.
- [ ] Add optional application updates and release-notes UI.

### Automation

- [ ] Add a headless CLI for project validation and batch rendering.
- [ ] Support subtitle or timing-metadata pipelines.

### Additional interface conveniences

- [ ] Add optional drag-and-drop ordering for blocks and presets.
- [ ] Add a command palette and advanced TTS parameter shortcuts.
- [ ] Add more locales, theme presets, speaker artwork, and visualization
      customization.

## Milestone: First Public Release

This milestone is the gate for an explicitly early, pre-1.0 public release,
not for a fully mature product. Azalea is ready when a new user can install it,
complete its main workflow, recover from common mistakes, and uninstall it
without help. Validate the gate with packaged release builds from clean
environments; development machines are not sufficient evidence.

### Core workflow and data safety

- [ ] On a fresh configuration, launch Azalea, configure a compatible VOICEVOX
      Core, enter and organize text, choose speakers and presets, tune speech,
      synthesize and play audio, export WAV files, and save and reopen an
      `.azp` project end to end.
- [ ] Repeat the primary workflow at least 20 times in a release build without
      an unexplained crash, corrupted project, lost edit, or incorrect output.
- [ ] Resolve every known realistic path that can overwrite unrelated files,
      silently lose or corrupt projects or configuration, delete the wrong
      data, or execute unintended input; any such issue blocks release.
- [ ] Confirm that interrupted or failed saves leave the previous project
      recoverable and that closing Azalea during active work cannot corrupt
      persistent state.

### Clean installation and upgrade

- [ ] Test the packaged artifact on a clean machine or VM for every advertised
      target: Windows, macOS Apple Silicon, and at least one supported Linux
      distribution.
- [ ] On each target, verify installation, first launch, VOICEVOX Core setup,
      filesystem permissions, non-ASCII user and project paths, and complete
      uninstallation without relying on developer tools or pre-existing caches.
- [ ] Install a previous release, create realistic settings and projects, then
      upgrade in place and verify that settings, projects, Core paths, and model
      identities survive and obsolete or malformed configuration cannot crash
      startup.

### Failures, recovery, and diagnostics

- [ ] Exercise missing and incompatible Core assets, a failed Core process,
      invalid or unsupported projects, corrupted configuration, inaccessible
      and read-only output directories, low disk space, interrupted operations,
      a second application launch, and closing while work is running.
- [ ] Present actionable user-facing errors for those cases, including the
      failing path or component and a recovery or retry action where possible;
      do not expose a panic or require console inspection for ordinary failure.
- [ ] Document how to locate and reset configuration and caches, select or
      reinstall Core assets, find logs, and reinstall Azalea without deleting
      unrelated user data or projects.
- [ ] Add a copyable diagnostic report containing the Azalea version, OS and
      architecture, Tauri and WebView/WebKitGTK versions where available,
      VOICEVOX Core version, relevant paths, and useful recent errors or logs.

### Stability, responsiveness, and resources

- [ ] Complete a one-to-two-hour release-build soak test covering repeated
      synthesis, rapid edits and selection changes, cancellation, project and
      window reopening, sleep and wake, and Core termination and recovery.
- [ ] Verify that ordinary interaction remains responsive enough not to appear
      hung; document known platform-specific limitations such as slower Linux
      rendering when they are acceptable for an early release.
- [ ] Measure memory, model and waveform caches, GPU memory where practical,
      temporary files, and child processes during the soak test, and resolve
      unbounded growth or resources that remain leaked after work completes.

### Release provenance

- [ ] Build and test the final artifacts from a clean checkout after all
      required frontend and Rust checks pass.
- [ ] Synchronize release and license metadata, create a versioned Git tag, and
      verify that every published artifact corresponds exactly to that tag.
- [ ] Smoke-test the actual downloadable artifacts on every advertised target
      before publishing the release or announcing it publicly.

## Recommended Implementation Order

1. Empty-project invariants, project recovery, and visible errors.
2. Preset/synthesis correctness and cancellable synthesis jobs.
3. Undo/redo and shared block actions.
4. Multi-block selection.
5. Silent and batch export.
6. Script import, dictionary support, and keyboard workflow.
7. Ordinary polish and optional differentiators.

## Roadmap Maintenance

- [ ] Enforce a measured Rust coverage baseline, publish frontend and Rust
      coverage artifacts in CI, and only ratchet the gates upward.
- [ ] Reconcile README Core/config instructions with the current implementation.
- [ ] Synchronize application version and license metadata across Tauri, Cargo,
      package metadata, and documentation.
- [ ] Run frontend checks and Rust tests in the release workflow before
      packaging.
