# Pitch completion handoff

## User request and agreed behavior

Implement an autoregressive pitch-completion API in the user's fork at
`vendor/voicevox_core_specta`, push it to the fork, and use it in Azalea.

- Editing a mora preserves **all pitches through that mora**, inclusive, and
  regenerates the suffix. It does not preserve later manual edits as fixed points.
- Use the block's existing seed and configured sigma when noise is enabled.
  Completion also works with noise disabled, using sigma zero.
- Completion has its **own switch**, separate from Generative Noise.
- Put the switch in the config dialog and a synchronized copy in the bottom
  panel for quick access. Implemented as a default-off global UI setting.
- User explicitly authorized pushing the core fork. Core changes are saved in local WIP commit `edf1bfa`; no push has happened.
  Azalea changes and this handoff are also being saved in a WIP commit at the
  user’s explicit request.
- User stopped work because of usage limits and requested this handoff.

Tracking issue: <https://github.com/Patchethium/Azalea/issues/11>, opened under
the repository's requirement to open an issue before substantial work.

## Repository constraints

Read root `AGENTS.md`. Do not use subagents. Keep implementations small
(Ponytail full was active). Ask before ambiguous product decisions.
Do not hand-edit `src/binding.ts`; regenerate through the dedicated Rust test.
Keep English, Japanese, and Simplified Chinese translations synchronized.
Do not commit vendor references/assets into Azalea.

Actual config UI location is now `src/dialogs/config/index.tsx`, and tuning UI
is `src/layout/bottomPanel/tuning/`; some AGENTS.md paths are outdated.
`pnpm check` currently runs oxlint, oxfmt, and TypeScript checks.

## Core fork implementation (WIP committed, tested)

Clone: `vendor/voicevox_core_specta` (a separate Git repository, ignored by
Azalea). Current branch: `generative-noise`. Origin:
`https://github.com/Patchethium/voicevox_core.git`.
Base HEAD: `5c47d2fc3db8f0e31bd37c88547e75fc2f314c1a`.
Current local WIP commit: `edf1bfa` (`feat: WIP autoregressive pitch completion`).
Remote heads were verified before work: generative-noise at that SHA;
specta at `afe952abafba039e6897d582d41fe8180b1bd2a9`.
Existing Specta features/types remain intact; no new public shared type added.

Both blocking and nonblocking synthesizers now expose:

```rust
complete_mora_pitch(
    &accent_phrases,
    style_id,
    &pitch_prefix,
    PitchNoiseOptions { sigma, seed },
) -> Result<Vec<AccentPhrase>>
```

Nonblocking uses `.await`. Accent phrases supply the complete phoneme sequence
and necessary accent features, reusing the existing predictor input flow.
The prefix uses natural-log pitch values in flattened mora order, **including
pause moras, excluding boundary silence**. Values must be finite/nonnegative;
unvoiced/pause values must be zero; oversized prefixes are rejected.

Implementation:

- `crates/voicevox_core/src/synthesizer.rs`: common internal completion method,
  public blocking/nonblocking wrappers, and extra predictor inputs. Existing
  `replace_mora_pitch_with_noise` delegates with an empty prefix.
- `src/pitch_noise.rs`: `prefix_inputs` validates/pads the prefix and creates
  its mask.
- `src/core/infer/runtimes/pitch_graph.rs`: transformation version bumped
  from 1 to 2. New float32 `[length]` `azalea_pitch_prefix` and int64
  `[length]` `azalea_pitch_prefix_mask` inputs. Gather + Cast + Where select
  fixed pitches after the noise addition. Both output and recurrent pitch
  feedback consume the selected value.
- `src/core/infer/domains/{talk,experimental_talk}.rs`: new inference inputs.
- `src/core/infer/runtimes/pitch_tests.rs`: updated raw test inputs and extended
  public API checks for empty/full/every partial prefix, exact preservation,
  suffix propagation, seeded repeatability, seed variation, zero sigma,
  blocking/nonblocking parity, invalid input, and non-pitch preservation.
- `docs/guide/dev/pitch-noise.md`: API contract and graph changes documented.

Important model semantics: existing prediction masks unvoiced/pause outputs
to zero **after** inference, while retaining the model's raw feedback at those
steps. The completion mask therefore fixes only voiced prefix steps; it keeps
unvoiced feedback unchanged. This preserves the existing trajectory when an
unchanged generated prefix is supplied. Noise draws still consume all voiced
positions, including pinned prefix steps, so suffix RNG positions remain stable.

Validation already passed:

```sh
cd vendor/voicevox_core_specta
VVCORE_BUILD_DOWNLOAD_AND_COPY_ORT=0 cargo test -p voicevox_core \
  --features load-onnxruntime,specta --lib --locked -- --test-threads=1
```

Result: **158 passed, 1 existing opt-in diagnostic ignored** (159 total), about
96 seconds. That ignored diagnostic existed before this work; no new ignored
tests were added. Sample-model graph tests cover nested model selection and
sequence-collection variants, plus legacy parity and rejection cases.

Core build normally tries to download ONNX Runtime because its `.cargo/config`
sets `VVCORE_BUILD_DOWNLOAD_AND_COPY_ORT=1`. Disable that for offline testing;
the downloaded runtime already exists at
`target/voicevox_core/downloads/onnxruntime/libonnxruntime.so.1.17.3`.

Core formatting uses four spaces. Running `cargo fmt --all` from the nested
clone inherited Azalea's two-space config and briefly reformatted unrelated
files; all unrelated changes were restored. The seven changed files listed
above are the intended WIP commit contents. Format touched Rust files with
`rustfmt --edition 2024 --config tab_spaces=4 ...` to avoid this problem.
There is a tiny formatting-only cfg_attr hunk in synthesizer.rs.

## Azalea implementation (saved as WIP)

- `src-tauri/src/config/types.rs`: `pitch_completion_enabled: bool`, serde
  default and application default false; default test extended.
- `src-tauri/src/config/manager.rs`: config round-trip test extended.
- `src-tauri/src/core.rs`: blocking core wrapper `complete_mora_pitch`.
- `src-tauri/src/commands/core.rs`: registered completion command receives
  phrases, style ID, pitch prefix, and seed; reads current noise settings,
  uses default options when noise is off, and runs through `run_core_task`.
- `src-tauri/src/lib.rs`: command registration.
- `src/binding.ts`: **generated correctly** by the dedicated test; exposes
  `commands.completeMoraPitch` and the UI setting.
- `src/dialogs/config/index.tsx`: experimental Pitch Completion switch and
  explanatory text in Synthesis section.
- `src/layout/bottomPanel/ControlBar.tsx`: compact switch before seed controls,
  shown on Tuning tab; same config field as the dialog.
- `src/i18n/{en,ja,zh-CN}.json`: synchronized label/description.
- `src/layout/bottomPanel/tuning/usePanel.ts`: direct pitch edit still happens
  immediately and marks the query modified. Completion is debounced 100 ms.
  Prefix includes earlier phrases/pauses and current phrase through edited mora.
  Revision invalidation covers later pitch edits, block/style/seed/settings
  changes and unmount. Results are also compared against the current phrases
  and modified state to avoid overwriting intervening duration/accent edits or
  resets. Errors preserve the direct edit. Queued timers are cleared on cleanup.
- `src/layout/bottomPanel/index.test.ts`: new Pitch Completion describe block
  at end, with debounce/prefix, stale response, error, cleanup, and switch tests.
- `src/dialogs/config/index.test.tsx`: settings switch test and experimental
  icon count updates.
- `src-tauri/tests/voicevox_core.rs`: real-core completion + waveform test.

## Temporary dependency patch — must finish before delivery

Azalea still declares the Git generative-noise dependency in Cargo.toml.
To test the unpublished fork changes, I created a **temporary external** file:

`/tmp/azalea-pitch-completion-cargo.toml`

```toml
[patch."https://github.com/Patchethium/voicevox_core"]
voicevox_core = { path = "/home/patchethium/repo/Azalea/vendor/voicevox_core_specta/crates/voicevox_core" }
```

Tests use `cargo ... --config /tmp/azalea-pitch-completion-cargo.toml`.
Testing temporarily removed Git sources for voicevox_core,
voicevox_core_build_features, and voicevox_core_macros from Cargo.lock.
**That temporary lockfile change was restored before the WIP commit**; the
committed lockfile still pins the old Git commit. After pushing the fork,
regenerate the lockfile against its Git branch without the patch and verify
it pins the new commit. Do not add a permanent vendor/path dependency.

Bindings were regenerated with:

```sh
cd src-tauri
cargo test --config /tmp/azalea-pitch-completion-cargo.toml \
  --lib regenerate_typescript_bindings
```

## Latest validation and two known frontend failures

Passed:

- `pnpm format` and `pnpm check` (including TypeScript).
- `cargo fmt` for Azalea.
- Azalea full Rust suite with the temporary patch:
  `cargo test --config /tmp/azalea-pitch-completion-cargo.toml --locked -- --test-threads=1`
  — **75 unit tests + 12 real-core integration tests passed**.
- Core full library suite as detailed above.

Latest `pnpm test:coverage` run: **272 passed, 2 failed (274 total)**.
Both failures are in the newly added `Pitch completion` block:

1. `shares the toolbar switch with config without regenerating on toggles`:
   `getByRole("switch", { name: "Pitch completion" })` cannot find the switch,
   although it is present in the DOM. Likely Kobalte duplicates the accessible
   name because both `Switch.Input aria-label` and `Switch.Label` specify the
   same text. Inspect the actual accessible name; remove the redundant input
   aria-label and let the label name it if that is the cause. This is also an
   accessibility fix, not just a test adjustment. **Not fixed yet.**
2. `debounces edits, sends the prefix including pauses, and replaces the suffix`:
   final non-pitch preservation assertion compares against `query.accent_phrases`,
   but Solid's store aliases/mutates that fixture: its edited pitch is now 5.6,
   while the test restores the received snapshot to original 5.1. Clone the
   original phrases **before** setting the query into the store and compare to
   that immutable snapshot. Payload and resulting pitch assertions already pass.
   **Not fixed yet.**

Existing JSDOM window.scrollTo warnings are noisy but did not cause failures.
The command chained `pnpm build` after coverage, so **build did not run** because
coverage failed. Coverage thresholds must be rechecked after fixing both tests.
No running processes are known to remain: all last check/test sessions completed.

## Remaining work

1. Fix the two frontend failures above; rerun focused tests, then checks, full
   coverage and build. Maintain >=90% statement/function/line and >=80% branch.
2. Review changes in both repositories, especially completion races and switch
   accessibility. UI was not visually inspected; CUA was unavailable earlier.
3. Optional useful final core check: existing graph-variant tests exercise zero
   prefix masks; extend their raw prediction helper to test an actual fixed
   prefix under nested-selection and sequence-collection graphs. Public API
   teacher forcing is already tested on the standard sample graph. Check
   compilation without Specta/all targets if appropriate; only the full library
   suite with Specta has run for the current changes.
4. The core changes are already WIP committed as `edf1bfa`. Amend or add a
   finishing commit as needed, then push **normally, without force**, to origin's
   generative-noise branch, as explicitly authorized. Recheck remote head first
   in case it changed. Preserve Specta support; do not push other branches.
5. Update Azalea Cargo.lock to the pushed Git commit, remove dependence on the
   temporary patch, regenerate bindings if needed, and validate against the
   actual Git dependency. Use the normal locked full Rust suite.
6. Update root AGENTS.md's noise API notes with the new completion contract if
   helpful, without changing project schema. No new block persistence is needed:
   completed manual queries already persist as query_override.
7. Report fork commit/push and final test results. The user explicitly requested
   local WIP commits in both repositories; those are saved. Azalea push has not
   been requested.

`git add .` is preferred by the user. This handoff is included in Azalea’s WIP
commit; update or remove it when finishing the feature, as appropriate.
pnpm and network/Git operations may require sandbox escalation: pnpm needs its
local database outside the workspace, and Cargo/Git fetching needs network/cache
access. All necessary operations in the previous session were approved; no
automatic-approval rejection occurred.
