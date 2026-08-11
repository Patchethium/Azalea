# Comprehensive frontend and backend testing

The goal is to cover Azalea's behavior at the cheapest reliable layer: pure
logic and state at unit level, UI workflows with a mocked Tauri boundary,
backend commands with deterministic fixtures, and a small packaged-app smoke
test. The complete Rust suite also validates the real VOICEVOX pipeline.

## Test infrastructure

- [x] Add Vitest, jsdom, Solid Testing Library, user-event, jest-dom, and V8
      coverage.
- [x] Add shared DOM, canvas, Tauri IPC/event, provider, and VOICEVOX fixture
      helpers.
- [x] Add `test`, `test:run`, `test:coverage`, `test:coverage:rust`, `test:e2e`,
      and `test:all` package scripts.
- [x] Add temporary-file support and Tauri's mock runtime to Rust tests.
- [x] Keep frontend and Rust unit tests independent of `config_dev`, model
      assets, network access, GUI interaction, and audio hardware.

## Frontend coverage

- [x] Test query/preset transformations, synthesis fingerprints, shortcuts,
      text-block creation/index clamping, metadata merging, and translations.
- [x] Test the provider graph: project lifecycle and selection invariants,
      configuration persistence/defaults, metadata behavior, and spectrogram
      cache revisions.
- [x] Test application initialization, failure states, core selection, theme
      changes, primary-color validation, and listener cleanup.
- [x] Test text-block query throttling and stale responses, structural actions,
      buffered synthesis scheduling/cancellation/events, and audio export.
- [x] Test playback and tuning, including pitch/duration/accent edits and
      sequence playback.
- [x] Test spectrogram enable/disable, buffering-dependent refreshes, timeline
      cropping/alignment, stale-response rejection, pending gray state, and
      preservation of the previous preview.
- [x] Test project save/load/autosave, preset lifecycle, settings,
      translations, shortcut conflicts, dialogs, and accessible interaction.

## Backend coverage

- [x] Run the complete Rust suite under `cargo-llvm-cov` in CI without a
      coverage threshold.
- [x] Test configuration defaults, partial/invalid input, validation repair,
      and file round trips.
- [x] Test project serialization, extension/create policy, malformed input,
      Unicode, missing paths, and I/O errors.
- [x] Test path helpers, core-asset discovery depth and matching, and built-in
      pitch-range parsing.
- [x] Test mel filter/spectrogram behavior for empty, short, silent, tonal, and
      malformed inputs, including compact preview normalization.
- [x] Complete synthesis queue/cache coverage for replacement, duplicates,
      stale generations, cancellation, capacity eviction, ownership, and
      concurrency.
- [x] Exercise IPC validation, managed-state errors, cache states, emitted
      events, and serialization with Tauri's mock runtime where practical.
- [x] Keep real audio-device checks out of the default suite; test orchestration
      with mocks.
- [x] Include the real VOICEVOX pipeline in the ordinary Rust integration suite.
      Accept `AZALEA_TEST_CORE_DIR`, fall back to `config_dev/config.json`, fail
      when neither is configured, and serialize the suite with
      `--test-threads=1`.
- [x] Move pitch-range generation out of the test harness into the dedicated
      `cargo run --example range` maintenance command.

## Packaged smoke test and CI

- [x] Add a small WebdriverIO Tauri smoke test for startup, deterministic core
      selection, query generation, synthesis completion, and playback.
- [x] Add pull-request/push CI jobs for frontend checks/build/tests, Rust
      formatting/tests, and the Linux smoke test.
- [x] Run real VOICEVOX compatibility as part of the documented one-line Rust
      test command, without an ignore marker, feature, or separate target
      selector.

  ```sh
  cd src-tauri
  cargo test --locked -- --test-threads=1
  ```

## Acceptance criteria

- [x] Frontend and Rust unit suites are deterministic and clean up timers,
      listeners, IPC mocks, temporary files, and tasks.
- [x] Critical error and stale-async paths are covered, especially synthesis
      cancellation and spectrogram replacement.
- [x] Tests consume generated command/event shapes from `src/binding.ts`; the
      generated file is never edited manually.
- [x] `pnpm check`, `pnpm build`, `pnpm test:coverage`, `cargo fmt --check`, the
      complete one-line `cargo test`, and the packaged smoke test pass locally
      and are configured in CI.
