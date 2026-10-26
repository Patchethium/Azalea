# Repository Guidelines

## Project Structure & Module Organization

Azalea is a Tauri 2 desktop application. The SolidJS/TypeScript frontend lives in `src/`: reusable UI belongs in `components/`, pages in `layout/`, shared state in `contexts/`, and translations in `i18n/`. Styles use colocated CSS modules; UnoCSS is configured in `uno.config.ts`.

Reuse existing UI components whenever possible. When new components are necessary,
make them reusable with Kobalte primitives and UnoCSS styling. Avoid native browser
controls and vanilla CSS for new UI. Preserve accessible labels, keyboard navigation,
and focus handling.

Downloaded VOICEVOX components belong under `config_dev/voicevox` in development
builds and `dirs::data_local_dir()/{bundle_identifier}/voicevox` in release builds,
outside the clearable asset cache. Keep development and release downloads isolated.
Existing-installation and downloaded setups keep separate models and system
dictionaries. Seamless switching reuses the first compatible ONNX Runtime loaded
in the process; the shared runtime determines the available execution providers.
Their custom user dictionary is shared.

## Optional Downloads

To keep the bundle small, the Noto Sans CJK fonts (`UIConfig.embedded_font`)
and the e2k English reading models are not bundled. `src-tauri/src/commands/extras.rs`
downloads them as `ExtraPack`s (`Fonts`, `EnglishModels`) from pinned URLs with
fixed sizes and SHA-256 hashes, staging each file and moving it into place only
after it verifies. They live next to the VOICEVOX downloads:
`config_dev/{fonts,e2k}` in development and
`dirs::data_local_dir()/{bundle_identifier}/{fonts,e2k}` in release. Unlike the
VOICEVOX components, clearing the asset cache (`clear_assets`) also deletes
them and `get_assets_size` counts them. When the e2k tag in `Cargo.toml`
changes, update `ENGLISH_MODEL_FILES` to that tag's models.

Until a pack is installed, `ExtraDownloadButton` (`src/components/extraDownload/`)
replaces the setting's control (the font toggle group, the "Transform English
words" switch) with a Download button that shows progress and a cancel button;
the control appears once the download verifies. Stored settings are preserved
either way. The frontend reads pack status through `createExtras`
(`src/contexts/extras.ts`, exposed as `useConfigStore().extras`). Downloaded
fonts are served to the webview by the `azalea-font` URI scheme, which only
serves the listed font files, and registered as `FontFace`s by
`src/embeddedFonts.ts`; the `embedded-font` class applies only while the fonts
are installed.

The Rust backend is under `src-tauri/`. Tauri commands are grouped in `src-tauri/src/commands/`, configuration handling in `config/`, and audio code in `audio/`. Rust integration tests and fixtures live in `src-tauri/tests/`. Application icons are in `src-tauri/icons/`; project artwork is in `icon/`. Treat `src/binding.ts` as generated bindings and avoid hand-editing it.

## VOICEVOX Core Generative Noise

The [Patchethium/voicevox_core fork](https://github.com/Patchethium/voicevox_core)
has a [`generative-noise` branch](https://github.com/Patchethium/voicevox_core/tree/generative-noise)
for seeded Gaussian noise in autoregressive talk pitch prediction. Keep its
Specta support synchronized with the fork's `specta` branch when updating it.

- `voicevox_core::PitchNoiseOptions { sigma: f32, seed: u32 }` controls noise.
  `sigma` is a finite, nonnegative standard deviation in natural-log pitch
  units; defaults are `sigma = 0.0` and `seed = 0`. The same model, inputs,
  seed and implementation version reproduce the same noise.
- `blocking::Synthesizer::replace_mora_pitch_with_noise(&accent_phrases,
  style_id, options)` returns `Result<Vec<AccentPhrase>>` with new pitches,
  preserving text, durations and all other fields.
- `nonblocking::Synthesizer::replace_mora_pitch_with_noise` takes the same
  arguments and returns the same result asynchronously; call it with `.await`.
  Assign the returned phrases to `AudioQuery.accent_phrases` before synthesis.
- `complete_mora_pitch(&accent_phrases, style_id, &pitch_prefix, options)`
  exists on both synthesizers (nonblocking uses `.await`) and returns
  `Result<Vec<AccentPhrase>>`. It preserves the fixed prefix exactly and
  regenerates the remaining pitches. The prefix contains natural-log pitch
  values in flattened mora order, including pause moras but excluding boundary
  silence; values must be finite and nonnegative, zero for unvoiced and pause
  moras, and no longer than the mora sequence. An empty prefix is equivalent to
  `replace_mora_pitch_with_noise`. Prefixes are exposed to the predictor through
  the `azalea_pitch_prefix` / `azalea_pitch_prefix_mask` graph inputs and fix
  only voiced prefix steps. Azalea surfaces completion through the
  `complete_mora_pitch` command, gated by the default-off
  `UIConfig.pitch_completion_enabled` setting with a config-dialog switch. The
  tuning-toolbar lock appears only when the feature is enabled and independently
  controls the persisted `UIConfig.pitch_completion_locked` state, defaulting to
  unlocked. Ctrl/Cmd+L toggles this lock through the configurable
  `toggle_pitch_completion` shortcut. Pitch edits debounce completion only while
  the feature is enabled and unlocked, preserving every pitch through the edited
  mora. Lock changes cancel queued completion and invalidate in-flight responses
  without regenerating pitches.

The transformation exports each predictor, which VOICEVOX ONNX Runtime 1.23
refuses. The fork probes exports once per process
(`Onnxruntime::supports_pitch_control`) and, without them, loads predictors
untransformed and leaves 0.16.x decoders unsplit (whole synthesis). Do not work
around the refusal; it is part of the runtime's terms. `Core` records the probe,
ignores noise without it, and the `supports_pitch_control` command lets the
frontend gate both features (`pitchNoiseActive`, `pitchCompletionAvailable`):
the config switches are disabled with a tooltip suggesting Azalea-managed
models and a restart, and stored settings are preserved. The downloader stays
on ONNX Runtime 1.17.3 and voicevox_vvm 0.16.4 for this reason.

Noise is injected only at voiced mora steps and feeds subsequent predictions;
unvoiced moras and pauses remain zero after prediction. Existing
`replace_mora_pitch`, query creation and TTS APIs use zero noise. Ordinary VVM
loading automatically transforms talk predictors and fails for unsupported
graphs. Noise options are exposed only through the Rust pitch-replacement
APIs, not waveform synthesis or other language bindings. See the fork's
[pitch-noise documentation](https://github.com/Patchethium/voicevox_core/blob/generative-noise/docs/guide/dev/pitch-noise.md)
for loading requirements, diagnostics and a WAV example.

Every `Core` method that reads a style's model (queries, mora replacement,
pitch noise, pitch completion and synthesis) loads it on demand through
`ensure_speaker_loaded`. Loaded projects keep edited queries without
recreating them, so no earlier call is guaranteed to have loaded the model.
Real-core tests cover on-demand loading and that a baseline predicted after a
project reload matches the saved pitches bit for bit.

## Streaming Synthesis

The fork's `generative-noise` branch tracks upstream 0.17.x, whose
voicevox_vvm 0.17.x models ship a split streaming-talk decoder natively. It
also splits monolithic talk decoders (voicevox_vvm 0.16.x) at the mel
bottleneck while loading, so both model generations stream, and exposes
segmented rendering on both synthesizers: `supports_streaming(style_id)`,
`prepare_streaming(&query, style_id, StreamingOptions)` returning a
`StreamingAudio`, and `render_streaming(&audio, frame_range)` returning 16-bit
PCM. `Core` wraps them (`supports_streaming`, `prepare_streaming`,
`render_streaming` and their `_nonblocking` variants); a `StreamingAudio` must
be rendered by the synthesizer that prepared it.

`UIConfig.streaming_synthesis` (default on, an experimental config-dialog
switch) makes every `synthesize_cached` cache miss on a supporting model render
in chunks, taking the core task gate per chunk and checking the core generation
each time; unsupported models fall back to whole synthesis. Each chunk is
vocoded with 14 frames of context on both sides, so `DEFAULT_CHUNK_SCHEDULE`
starts with a `DEFAULT_STREAMING_CHUNK_FRAMES` (50-frame) chunk for latency and
doubles later chunks up to 400 frames to limit repeated work; remainders shorter
than the first chunk join the chunk before them. Streamed waveforms match whole synthesis to within one sample
quantization step and share the waveform cache. Playback (`play_audio`,
`play_audio_sequence`) feeds an `AudioPlayer` through a `PlaybackFeed` from a
producer task owned by the player, so stopping playback stops rendering. The
command returns once the first audio is queued; later rendering errors emit
`audio-playback-failed` with the message, which the frontend shows as a toast.
Playback queues audio through a `PlaybackCursor` (in
`src-tauri/src/streaming.rs`) in frame order from the play position, each frame
once, from whatever is available: while another caller (such as a background
buffering job) is rendering the same waveform, playback follows that render's
published chunks instead of waiting for it to finish; if it takes over a
cancelled render, it renders from the first frame not queued yet; whatever is
still missing is queued from the finished WAV, which also covers cache hits
and models that cannot stream. Its own renders start at the cursor's frame and
render the skipped head last in maximum-size chunks, only to complete the
cached waveform (`StreamPlan`). With streaming enabled, sequence items render
while earlier items play; with it disabled, every item is synthesized before
playback starts, as before.

`src-tauri/examples/streaming_bench.rs` compares latency to first audio and
total RTF of whole and streamed synthesis on the real core, one utterance per
line of a text file (default `tests/rashoumon.txt`), optionally writing a CSV,
and simulates playback stalls. `BENCH_FIRST_CHUNK_FRAMES` and
`BENCH_MAX_CHUNK_FRAMES` override the schedule. A full run synthesizes the text
twice and takes several minutes.
Release builds do not read `config_dev`, so set `AZALEA_TEST_CORE_DIR`:
`cargo run --release --example streaming_bench -- tests/rashoumon.txt out.csv`.

## English Word Readings

`src-tauri/src/english/` reads English words OpenJTalk does not know through
[e2k](https://github.com/Patchethium/e2k), a git dependency pinned by tag
whose models are downloaded on demand (see Optional Downloads) and each loaded
once per process on first use; failed loads are not cached, so models downloaded
later are picked up. The query commands apply the English options only while
`english::models_available()` finds the files, so without them readings are
OpenJTalk's and the query cache key changes when the models arrive. The
frontend bumps `englishReadingRevision` when the installed state changes. Tests
call `english::provide_models` with e2k's embedded copies instead of
downloading; only test binaries embed them. Text analysis needs NJD features VOICEVOX Core does not expose, so
`EnglishReader` works around OpenJTalk's public `TextAnalyzer`: a run of
ASCII or fullwidth letters is unknown when OpenJTalk reads it exactly as its
letter names (`LETTER_NAMES`, OpenJTalk's table), so user dictionary entries
always win. Unknown words are replaced with e2k's katakana before analysis,
spaces next to a replaced word are dropped (as VOICEVOX ENGINE does) and the
whole text is analyzed once. The replaced katakana is then found in the
analyzed moras; moras OpenJTalk misread, such as a leading ヘ read as the
particle エ, are restored from the katakana (`kana.rs`, from the core's mora
table) while matching devoicing is kept. Readings are cached per word and
options and cleared whenever the user dictionary is applied.

`UIConfig.english_transform` (default on, the "Transform English words"
switch) enables it; its nested switches, shown only while it is on, are
`english_accent_prediction` and `english_ngram_filter` (both default on) and
`english_turbo_model` (default off), which transliterates with e2k's distilled
turbo C2K model instead of the base one; the model not selected is never
loaded. The switch and its nested switches appear only once the models are
downloaded.
Accent prediction makes each replaced word start an accent phrase carrying
e2k's nucleus (heiban spans the phrase), merging a word OpenJTalk split and
splitting consecutive replaced words, but leaves a word inside a Japanese
compound to OpenJTalk. With the n-gram filter, words its model rejects keep
OpenJTalk's spelling whatever their case; without it, VOICEVOX ENGINE's rules
apply: split at capitals, spell single letters and all-capital pieces, and
transliterate the rest. Single letters are always spelled.
`Core::audio_query_with_english` and `accent_phrases_with_english` take the options;
the plain methods keep OpenJTalk's reading. The query cache key includes the
options, and the frontend regenerates pristine queries after a save that
changes the effective options (`englishReadingRevision`).

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
preserve manually edited queries as `query_override`. Track manual edits per
block with `accent_is_modified`, `duration_is_modified`, and
`pitch_is_modified`; `query_override` is persisted whenever any of them is set.

Evolve schema version `1` in place until the first release containing
versioned project files; do not add compatibility or migrations for unreleased
formats. Add Rust tests for the current-version round trip, malformed and
unversioned files, and rejection of unsupported versions. A disk-wrapper-only
change does not require regenerating `src/binding.ts`; changes to registered
command signatures or shared Rust command types do.

## Query Reset Semantics

The accent and tuning panels of the bottom panel are orthogonal; keep their
edit tracking and controls independent (the post panel is described under
Post-Processing):

- The accent panel tracks `accent_is_modified`. Its reset
  (`bottom.reset_accent_edits`) is enabled only by that flag and rebuilds the
  query from the block text, discarding phoneme, accent, pitch, and duration
  edits. It clears all three flags.
- The tuning panel tracks `duration_is_modified` and `pitch_is_modified`. Its
  reset (`bottom.reset_tuning_edits`) is enabled only by those flags and
  regenerates pitch and duration through `replace_mora_data`, preserving
  phoneme and accent edits. It clears the two tuning flags and leaves
  `accent_is_modified` untouched.

Enforce the orthogonality in control state: the tuning panel must never read
`accent_is_modified` and the accent panel must never read the tuning flags.
Specifically, the pitch-noise seed controls are disabled only by
`duration_is_modified` or `pitch_is_modified`, never by accent or phoneme
edits, and a tuning reset must not enable, disable, or clear the accent reset
(or vice versa).

Accent and phoneme edits call `markQueryAccentModified`, pitch edits call
`markQueryPitchModified`, and duration edits call `markQueryDurationModified`;
the flags are persisted per block and optional in the generated bindings.
`isQueryModified` derives the aggregate modified state and gates query
persistence and regeneration. Rust validation rejects modified flags without a
query override.

## Relative Pitch Tuning

`UIConfig.pitch_tuning_mode` (`Absolute` by default, or `Relative`) only
changes how tuning-panel pitch sliders map values; both modes edit the same
`mora.pitch` through the existing `setPitch` path, so modified flags, resets,
completion and persistence are unchanged. In relative mode each voiced slider
is centered on the predicted pitch and spans ±`UIConfig.pitch_drift_range`
semitones (default 12, valid 1–24; one semitone is `ln 2 / 12` in log pitch).
Switch modes from the config dialog, where the drift-range row is shown only
in relative mode, or from the tuning-options menu (`TuningMenu`, an
`ellipsis-vertical` button at the right end of the bottom-panel toolbar, shown
only on the tuning panel). That menu also holds the absolute pitch scale
(hidden in relative mode) and the pitch-ruler toggle, so it stays reachable
when the ruler is hidden; the ruler itself has no context menu.
Right-clicking a slider resets that mora to its baseline through `setPitch` (a
no-op when already there) in both absolute and relative modes;
secondary-button pointerdowns are stopped in the capture phase when a reset is
available so Kobalte does not move the value first. Without a baseline, the
native context-menu behavior remains. Relative mode also draws a faint per-mora
ghost line at the current absolute pitch mapped through the shared pitch scale,
so the absolute contour stays readable behind the
drift-based sliders; it follows pitch edits, ignores prediction-only changes,
stays pinned to the nearest edge with a small top/bottom arrow when the pitch
lies beyond the scale, and is absent while the absolute fallback or a spanless
scale is active. Absolute mode instead draws the predicted baseline as a
dashed ghost at its position on the absolute scale.

The baseline is never persisted. Cache it in `PitchBaselineProvider`
(`src/contexts/pitchBaseline.ts`) so it survives tuning-panel remounts, keyed
by block, style, seed, noise settings, core revision and a phoneme/accent
signature that excludes pitch and duration so tuning edits never refetch.
When `pitch_is_modified` is unset, the current pitches are the seeded
prediction: snapshot them synchronously as the baseline so relative sliders
start centered and absolute mode shows the baseline ghost without a request.
Cache that snapshot only after any pending generated query for the key settles,
so changing the noise seed cannot store the previous seed's pitches as the new
baseline. Only pitch-edited blocks without a cached baseline request one with
`replace_mora_pitch` using the block's noise seed and current noise settings;
until it arrives or if it fails, relative sliders fall back to the absolute
mapping.
Mapping changes (baseline arrival, mode switch, drift range) reposition sliders
without the pitch transition. Pitch completion does not rebase the baseline:
completed moras show their drift from the seeded prediction.

## Audio File Export

The default export directory controls the initial directory shown by the
native save dialog. `UIConfig.silent_save` is effective only when that default
directory is enabled and set; silent exports skip the dialog and write the
audio there using the generated default `.wav` filename.

`UIConfig.prevent_overwrite` is independent of the default export directory.
For dialog-based exports, resolve the next available default path through the
Rust `resolve_audio_save_path` command before opening the dialog so the user
sees a suffix such as `(2)` in the suggested filename. Once the native dialog
returns a path, treat that path as authoritative and do not apply overwrite
prevention again during the write: the user may have confirmed an overwrite in
the native dialog.

For silent exports, where no native confirmation is possible, keep overwrite
prevention in Rust. Create the output file exclusively and retry with `(n)`
before the extension, beginning with `(2)`, until an available path is found.
Return the actual saved path to the frontend and use it when remembering the
export directory. Show the success toast only after the write succeeds. Cover
the dialog default-path behavior in frontend tests and the exclusive numbered
write behavior with Rust temporary-directory tests.

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

While a streamed render is in progress, the waveform cache cell publishes the
chunks rendered so far, each with its render time, through a
`tokio::sync::watch` channel (`WaveformCell.progress`, a `RenderProgress` reset
when the render ends for any reason), so the preview worker follows a render
it did not start, including one started by playback. The nonblocking model is
loaded only when a caller renders itself, so a follower subscribes without
waiting for the core gate. `SlidingSpectrogram` keeps the received audio and
computes only the columns whose whole FFT window a new chunk completes
(`MelSpec::column`, identical to the whole-signal path), then reveals them
`SLIDING_STEP_COLUMNS` (2) at a time, spread over that chunk's render time so
the preview trails the render by about one chunk; chunks rendered before
following started are revealed at once. Steps due within one `SLIDING_TICK`
(16 ms) go out together as one `SpectrogramColumnsEvent` carrying raw decibels
for just those columns. After the render finishes, the worker reveals the
remaining columns at their pace before emitting `Completed`. The frontend
accumulates columns per request (`partialSpectrogram.ts`), normalizes them to
the loudest revealed value with the backend's 80 dB range, redraws at most
every 16 ms, never caches them, and restores the last cached preview if the
request fails. A partial `DisplayedSpectrogram` carries its revealed columns
and the previous preview as `underlay`; the canvas draws revealed columns in
full color and, in the same canvas, the underlay grayed out at the stale
opacity under columns not revealed yet, sampled at the same timeline
position, so the old preview stays visible until replaced. Read `spectrogram()`
untracked inside the panel's request effect so drawing columns does not rerun
it.

`UIConfig.spectrogram_preview` controls the feature and defaults to enabled. Disabling it must cancel pending refreshes, clear the canvas, and avoid spectrogram extraction. Keep its switch in `src/layout/ConfigPage.tsx`, synchronize its English, Japanese, and Simplified Chinese labels, and regenerate `src/binding.ts` after changing related Rust commands or types.

## Post-Processing (WORLD)

The bottom panel's third tab, Post (`src/layout/bottomPanel/post/`), edits
the f0 of the synthesized waveform frame by frame with the WORLD vocoder.
Tabs depend on each other in order: post edits are made on the waveform the
accent and tuning content produce, so they are dropped as soon as that
content changes. `TextBlockProps.post_f0` (`PostF0Edit`) stores the edited
frames as sparse `segments` of absolute f0 in Hz with a `base` fingerprint
(`postEditBase` in `src/utils.ts`: the query with the preset applied, plus
its style). A text-store effect clears the edit whenever a block's current
fingerprint differs; it reads the query and preset through the store
proxies so nested edits are tracked, and it waits while a query regenerates
or a preset cannot be resolved. A core revision (voice setup change) clears
every post edit. Accent and tuning keep their existing semantics; only the
post tab is cleared by changes before it. Post edits are persisted in `.azp`
schema 1 (empty edits are omitted, malformed ones rejected).

WORLD is the `src-tauri/third_party/world` git submodule (upstream
[mmorise/World](https://github.com/mmorise/World), pinned by commit and
cloned shallow); `build.rs` compiles its Harvest, CheapTrick, D4C and
Synthesis sources with `cc` and fails with a hint when the submodule is not
checked out. Run `git submodule update --init` after cloning; CI and release
checkouts fetch submodules. Update WORLD by checking out a newer commit in
the submodule and committing the new pointer; do not copy its sources into
the repository.
`src-tauri/src/audio/world.rs` binds it by hand and validates every input
before crossing the FFI boundary, because WORLD itself does not. The frame
period is fixed at 5 ms. Harvest searches the style's built-in pitch range
(`config::range::style_range`) widened by half an octave, with WORLD's
71–800 Hz default for styles without one.

`src-tauri/src/post.rs` analyzes a base waveform once
(`PostAnalysisData`, cached per waveform-cache key in `PostCache`) and
renders edits by splicing: WORLD's resynthesis is used only around edited
frames (20 ms margin, 15 ms raised-cosine crossfade), so untouched audio keeps
VOICEVOX's samples bit for bit; stereo and 48 kHz output are handled.
`synthesize_post_processed` wraps `synthesize_cached` for playback, buffered
synthesis (`SynthesisJobRequest.post`), single and combined export
(`AudioSequenceItem.post`) whenever a block has an active edit; edited items
render whole and are queued from the finished waveform rather than streamed.
The tuning spectrogram keeps showing the base waveform. The frontend passes
an edit only when `activePostEdit` confirms its base still matches the query
being synthesized. `analyze_post_f0` returns the analyzed contour and a
compact log-frequency spectrogram for the editor; `PostAnalysisProvider`
caches it per fingerprint.

The editor draws with the pencil or line tool (left button), restores the
analyzed f0 with a right-button drag, and only voices frames WORLD found
unvoiced while "Draw on unvoiced frames" is on. Strokes update a local draft
and commit one `setPostEdit` on release. The tab's reset clears `post_f0`.
WORLD's modified BSD license must be reproduced with binary distributions.

## Build, Test, and Development Commands

- `pnpm install` installs frontend and Tauri CLI dependencies.
- `pnpm tauri dev` runs the complete desktop app with hot reload.
- `pnpm dev` starts only the Vite frontend server.
- `pnpm build` creates the frontend bundle with Vite.
- `pnpm tauri build` creates a production desktop package.
- `pnpm check` runs Biome linting and formatting checks on `src/`.
- `pnpm test:run` runs the deterministic Vitest frontend suite once.
- `pnpm test:coverage` runs the frontend suite with a V8 coverage report and
  enforces at least 90% statements, functions, and lines and 80% branches.
- `pnpm test:all` runs frontend checks, the frontend build, coverage-gated
  frontend tests, and every Rust test, including the real VOICEVOX pipeline.
- `cd src-tauri && cargo test --locked -- --test-threads=1` runs
  every Rust unit and integration test in one command, including the real
  VOICEVOX pipeline.
- `cd src-tauri && cargo test --lib regenerate_typescript_bindings` regenerates `src/binding.ts` without launching the desktop application.
- `cd src-tauri && cargo fmt --check` verifies Rust formatting.

Linux development also requires the Tauri prerequisites, `clang`, and `mold`. The development core path is stored in `config_dev/config.toml`.

## Driving the Running App

Agents cannot see the Tauri webview from a browser, so `e2e/driver.ts` drives
the real window through `tauri-driver` (`cargo install tauri-driver --locked`)
and WebKitGTK's `WebKitWebDriver` with WebdriverIO. This works on Linux and
Windows only.

- `pnpm e2e:build` builds the debug app with the frontend embedded; rebuild
  after frontend or Rust changes.
- `pnpm e2e start` launches the app and waits for the main page; the session
  persists in `logs/e2e-session.json` until `pnpm e2e stop`.
- `pnpm e2e exec '<js>'` runs async JS with `browser`, `$` and `$$` in scope
  and prints any returned value as JSON. Prefer accessible selectors such as
  `$("aria/Play selected cell")`.
- `pnpm e2e shot [path]` saves a screenshot (default `logs/e2e-shot.png`).
- `pnpm e2e smoke` starts, screenshots and stops in one command.

The debug build uses the real core and the shared `config_dev` configuration,
so UI changes made through the driver persist there. A running `pnpm tauri dev`
instance shares the single-instance identifier and must be closed first.

`src/binding.ts` is generated from the registered Tauri commands, events, and their Rust types by `tauri-specta`. After changing any of them, agents and other automation should run the dedicated `regenerate_typescript_bindings` test and commit the resulting binding changes. Do not edit the generated file by hand.

## Coding Style & Naming Conventions

Use two-space indentation in both TypeScript and Rust, as configured by Biome and `rustfmt.toml`. Keep TypeScript strict and prefer focused Solid components. Name components and pages in `PascalCase.tsx`, context and utility modules in `camelCase.ts`, and CSS modules `*.module.css`. Rust modules, functions, and test files use `snake_case`; types use `PascalCase`. Run `pnpm check` and `cargo fmt` before submitting changes. Keep English, Japanese, and Simplified Chinese translation keys synchronized.

Hide nested configuration items when their parent feature is disabled, using
conditional rendering for the entire row rather than disabling only its input.
In particular, show Noise strength (sigma), including its reset control, only
when `UIConfig.pitch_noise_enabled` is enabled. Preserve stored child settings
when hiding them so re-enabling the feature restores their values.

Always ask user for clarification before making decisions on ambiguous instructions.

Avoid using sub agents.

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

Keep frontend statement, function, and line coverage at or above 90%, and
branch coverage at or above 80%. `pnpm test:coverage` enforces these thresholds.
Rust coverage is informational; `pnpm test:coverage:rust` does not enforce a
threshold. Future Rust coverage enforcement is tracked in
`.agents/TODO.md`.

## Commit & Pull Request Guidelines

Recent commits use short imperative, Conventional Commit-style prefixes such as `feat:`, `fix:`, and `chores:`. Keep each commit scoped to one concern. Open an issue before substantial work, as requested in the README. Pull requests should explain the problem and solution, link the issue, list validation commands, and include screenshots or recordings for visible UI changes. Avoid committing local core assets, generated build output, or machine-specific configuration.

## Git Guidelines

Prefer using `git add .` than `git add file1 file2 ...` to make review easier for the user.

When source code from another repository is useful as a reference, agents may
clone it under the ignored `vendor/` directory. Always use a shallow clone such
as `git clone --depth 1 <repository-url> vendor/<repository-name>` so the
repository history does not consume unnecessary disk space. Do not commit
these reference clones.
