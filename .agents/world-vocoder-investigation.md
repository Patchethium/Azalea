# WORLD vocoder post-processing: investigation

Status: research only, written 26 October 2026 against `master` at `6606ebc`.
No app code was changed. The throwaway prototype and listening samples are in
the ignored `vendor/world-proto/` directory, with reference clones in
`vendor/World`, `vendor/world-rs`, `vendor/weralt` and `vendor/world-rust`.

## Goal

After VOICEVOX synthesis, estimate the waveform's f0 contour with WORLD, let
the user edit that contour frame by frame, then resynthesize with WORLD using
the edited f0 plus the original spectral envelope (CheapTrick) and
aperiodicity (D4C).

## Summary

- **Recommended library: vendor upstream WORLD C++ (`mmorise/World`) behind a
  small in-repo `-sys`-style module built with `cc`, using a hand-written FFI
  (about 12 functions and 4 `#[repr(C)]` option structs; `bindgen` isn't
  needed).** It's the reference implementation, it's maintained (thread-safe
  `randn` since October 2024), it has a BSD-3 licence, and it builds with
  only a C++ compiler on all three desktop targets. The pure-Rust
  `world-rs` is a credible second choice and is worth watching: its DIO path
  matched C++ to about 1e-11 in my tests, and it's 20–30% faster in D4C and
  synthesis. But it's a one-person crate, a few weeks old, with zero stars.
  Its Harvest port also diverges from C++ on some inputs (frames up to 170 Hz
  off), and it has no codec functions. Both options sit behind the same
  internal trait, so we can switch later.
- **Use Harvest for analysis** (its voicing is far more stable on VOICEVOX
  output than DIO's), **at a 5 ms frame period**. Analysis runs once per
  waveform at about 0.2–0.27× real time on one core. Resynthesis after an
  edit runs at about 0.02× real time, so a 10 s block re-renders in about
  0.25 s.
- **Quality cost is real and global.** Even with an unedited f0, WORLD
  resynthesis changes the whole block (about 5–7 dB log-spectral distance
  from the VOICEVOX waveform on normal voices, 8 dB on whisper). Phase isn't
  preserved, and the usual WORLD "buzz" is audible. Splicing only the edited
  regions back into the original waveform is the main mitigation (see the
  integration sketch).
- **A strong alternative needs a decision first.** The VOICEVOX talk
  decoder already takes a per-frame log-f0 input (93.75 frames/s), built by
  `decoder_feature` as a step function of mora pitches. A frame-level f0
  override in our `voicevox_core` fork would avoid WORLD entirely: native
  quality, streaming, cache and spectrogram all unchanged. The catch is that
  the decoder doesn't follow its f0 input literally (see Quality), and
  out-of-distribution contours such as vibrato are untested. A one-day
  experiment in the fork would settle this. See open decision 1.

## Rust options

| Option | What it is | Status | Licence | Build | Pieces exposed | Notes |
|---|---|---|---|---|---|---|
| **Vendored WORLD C++ + hand FFI** (recommended) | Upstream `mmorise/World` source (about 7.3k lines of C++) compiled by `cc` in `build.rs` | Upstream last code change October 2024 (PRs #148/#149: CMake fix, non-global `randn`); README edits in 2025–2026 | Modified BSD (BSD-3) | `cc` only. g++/clang on Linux and macOS, MSVC on Windows (upstream ships VS2015/2019/2022 projects). Static, no system dependencies. The prototype built in about 40 s. | Everything: DIO, Harvest, StoneMask, CheapTrick, D4C, Synthesis, codec, real-time synthesis | The FFI is small and stable. We own the `unsafe` and must size output buffers via `GetSamplesFor*`/`GetFFTSizeForCheapTrick`. |
| `world-rs` 0.1.0 (crates.io) / 0.2.0 (GitHub) | Pure-Rust port, `unsafe_code = "forbid"`, typed errors instead of C++ UB | First published 11 September 2026; v0.2.0 tagged 29 September 2026 but not yet on crates.io; single author, 0 stars, no dependents | BSD-3-Clause (plus WORLD NOTICE) | Pure Cargo; depends on `rustfft` (already an Azalea dependency), `realfft`, `num-complex`. MSRV 1.88. | DIO, Harvest, StoneMask, CheapTrick, D4C, Synthesis, resampler. **No** CodeSpectralEnvelope/aperiodicity codec, no real-time synthesis. | Parity vs C++ (5 ms, 15 VOICEVOX clips): DIO+StoneMask, CheapTrick, D4C and Synthesis within 1e-9; **Harvest diverged on 5 of 15 clips** (max |Δf0| up to 170 Hz, which looks like different candidate picks), within 0.2 Hz on the rest. 20–30% faster D4C and synthesis, same Harvest speed. |
| `rsworld` / `rsworld-sys` / `Rust-WORLD` 0.1.x | Old bindings by BiggieBoo18 with WORLD source bundled | Single release, 28 December 2019; abandoned | Wrapper says MIT; bundled WORLD is BSD-3 | `cc`, but hard-codes `-O1` and builds 11 separate static libraries | All main functions, `&Vec<Vec<f64>>` API | **Bundles a pre-2020 WORLD whose `randn` uses global statics**, a data race if two syntheses run concurrently. Not suitable. |
| `weralt` | Pure-Rust port | One push, January 2025; README says "early, incomplete", FFT "messed up" | BSD-3 | Pure Cargo | DIO, Harvest, CheapTrick, D4C, Synthesis | Not on crates.io. Too immature. |
| `world-rust` (qwqAutomaton), `world-sys` (echelon) | Small ports or bindings | 2025 / 2019 | **No licence** | — | Partial | Can't be used. |
| `reim-rs` | Port of a real-time "WORLD-like" vocoder | Active (October 2026) | No licence file | — | Different algorithm | Out of scope. |

Licence fit: Azalea is GPL-3.0-or-later, and BSD-3 is compatible. Either
recommended option needs the WORLD copyright notice in the shipped
third-party licences.

Build caveat for both: the release profile uses `opt-level = "z"`, and `cc`
passes the matching `-Os`. With `z` and LTO, C++ WORLD totals stayed
about the same (10 s clip, Harvest: 2.44 s at `opt-level = 3` vs 2.63 s at
`z`), but `world-rs` slowed by about 40% (2.57 s → 3.56 s; D4C 0.28 → 0.49 s).
If we pick `world-rs`, add `[profile.release.package.world-rs] opt-level = 3`.
A package override helps the C++ crate too.

## Quality and performance

Setup: 15 fresh VOICEVOX clips at 24 kHz (styles 2 Metan, 3 Zundamon,
11 Kurono Takehiro, 13 Aoyama Ryusei, 22 Zundamon whisper × 3 sentences:
neutral, long narrative, exclamation/question; 2.3–6.7 s), plus one existing
export. f0 range 71–800 Hz, default CheapTrick (fft 1024 at 24 kHz) and D4C
(threshold 0.85). Single thread on a Ryzen 7 5800H. Raw output is in
`vendor/world-proto/quality.txt`; WAVs for listening are in
`vendor/world-proto/out/` (`*_{harvest,dio}_{1,2.5,5}ms.wav`,
`*_shift+3.wav`, `*_shift-5.wav`).

### Speed (C++ WORLD, best of 3; real-time factor = compute / audio)

| Stage | 1 s | 3 s | 10 s | 30 s |
|---|---|---|---|---|
| Harvest | 0.19 s | 0.46 s | 1.71 s | 6.03 s |
| DIO + StoneMask | 0.007 s | 0.033 s | 0.087 s | 0.38 s |
| CheapTrick | 0.009 s | 0.026 s | 0.085 s | 0.26 s |
| D4C | 0.042 s | 0.12 s | 0.41 s | 1.21 s |
| Synthesis | 0.026 s | 0.071 s | 0.24 s | 0.71 s |
| **Total, Harvest** | RTF 0.27 | 0.23 | 0.24 | 0.27 |
| **Total, DIO** | RTF 0.08 | 0.08 | 0.08 | 0.08 |
| **Resynthesis only** | RTF 0.026 | 0.024 | 0.024 | 0.024 |

`world-rs`: DIO total RTF about 0.06, Harvest about 0.25, synthesis about
0.018. Frame period affects the analysis stages (Harvest total RTF 0.29 at
5 ms, 0.33 at 2.5 ms, 0.50 at 1 ms) but not synthesis.

Takeaway: analysis (f0, envelope, aperiodicity) is the cost and runs once per
waveform. Every f0 edit needs only Synthesis, at about 1/40 real time, so
interactive re-rendering of a block is cheap if features are cached.

### Accuracy and quality

- **Harvest vs DIO.** On normal voices the two agree within about 16–44
  cents on frames both call voiced. But DIO's voicing disagrees with
  Harvest's on 10–25% of frames (DIO drops voicing at phrase edges and on
  low-energy vowels). Harvest's voicing on resynthesized output was also
  more consistent (3–13% voicing flips vs DIO's 7–24%). For an editor where
  users draw on voiced regions, Harvest's stability is worth its 3× cost.
- **Frame period.** Log-spectral distance barely moves with it (for example
  6.0 / 6.0 / 6.3 dB at 1 / 2.5 / 5 ms on the Metan sample). 5 ms (200
  frames/s, about twice VOICEVOX's 93.75) is fine for drawing; 2.5 ms adds
  cost without audible gain.
- **Resynthesis loss** (unedited f0, log-spectral distance in dB over
  frames above −40 dB, bins within 60 dB of the frame peak): Metan 6.3–6.8,
  Zundamon 6.8–7.4, Takehiro 5.5–5.7, Ryusei 5.2–5.8, Zundamon whisper
  8.0. For calibration, this metric isn't phase-invariant, so even
  perceptually good vocoding scores several dB here. What it does show is
  that the whole block changes, not just edited regions. Please listen to
  `out/*_harvest_5ms.wav` against `samples/*.wav`: that's the real test, and
  I can't judge it from numbers.
- **Edit fidelity.** After shifting f0 by +3 semitones, re-estimating
  Harvest on the output lands 27–110 cents (mean absolute) from the target,
  with 7–21% of voiced frames off by more than 50 cents. This includes
  estimator error; the unshifted round trip is already 20–110 cents.
  **Downward shifts on male voices fail**: −5 semitones on Ryusei (about
  100 Hz → 75 Hz) gives 180–400 cents error and 25% voicing flips, because
  the target falls near the 71 Hz floor. A lower `f0_floor` (for example
  40 Hz) is needed for male styles, at the cost of a larger CheapTrick FFT
  and slower analysis.
- **Whisper styles** have no meaningful f0. Harvest finds scattered "voiced"
  frames, and edits there produce artefacts. The editor should treat a
  mostly-unvoiced analysis as "not editable".
- **VOICEVOX output doesn't follow mora pitch.** Compared with the query's
  mora pitches held over each vowel, the realized f0 has a near-zero
  median offset (alignment is right), but a mean absolute deviation of
  about 80–130 cents, and 50–80% of vowel frames are more than 50 cents
  away. Exclamations and questions are worse (about 200–280 cents). The
  decoder adds its own glides and microprosody. Two consequences:
  frame-level analysis shows users what they actually hear, which is the
  point of this feature; and a native decoder override (decision 1) wouldn't
  reproduce a drawn contour exactly either.

## Integration sketch (Azalea)

The pieces below assume WORLD post-processing (option A). Option B, the
native decoder override, would instead pass a per-frame f0 array through
`AudioQuery`-adjacent APIs and touch only the fork plus the cache key.

### Backend

1. **`src-tauri/src/audio/world/`**: the vendored C++ under
   `src-tauri/vendor-c/world/` (or a workspace `world-sys` crate), plus a
   safe wrapper:
   `analyze(pcm: &[f64], fs, opts) -> WorldFeatures { frame_period, f0, sp, ap, fft_size }`
   and `synthesize(&WorldFeatures, f0: &[f64]) -> Vec<f64>`. Run both in
   `spawn_blocking`. A WORLD call can't be interrupted, so check
   cancellation and `core_generation` between stages: f0 → envelope →
   aperiodicity → synthesis.
2. **Feature cache.** A small LRU, keyed like the waveform cache
   (`generation_key(query_json, generation)`, style), holding
   `Arc<WorldFeatures>`. Size: at 5 ms and fft 1024 (513 bins), sp + ap are
   about 0.8 MB per second as `f64`, so 8 MB for a 10 s block. Store them as
   `f32` to halve that, and keep 4–8 entries. Features are computed from the
   VOICEVOX waveform in `WaveformCell.wav`, so they reuse
   `synthesize_cached` and can follow an in-flight streamed render.
3. **Final waveform.** Extend the waveform cache key with an edit hash
   (`None` for unedited blocks, so the current behaviour and keys are
   unchanged). `synthesize_cached` gains an optional `F0Edit`: on a miss it
   gets the base WAV (cached as today), gets or creates the features, builds
   the target f0 (analyzed f0 with the edit applied), synthesizes, and then
   either
   - **(a)** replaces the whole block, or
   - **(b)** splices: WORLD output only on edited frame ranges plus margins,
     crossfaded (about 10–20 ms, at low-energy or unvoiced points where
     possible) into the original VOICEVOX waveform, keeping native quality
     elsewhere. See decision 4.
4. **Streaming and playback.** WORLD analysis needs the whole base waveform
   (Harvest's post-processing is global), so edited blocks can't stream on
   first render. They go through the existing "model can't stream" path:
   `PlaybackCursor` queues from the finished WAV. Unedited blocks keep
   today's streaming path. Once features are cached, synthesis could
   produce chunks per frame range, but at 0.024 RTF it isn't worth it at
   first.
5. **Export.** `save_audio` and `save_combined_audio` already go through
   `synthesize_cached`, so they inherit the edit. `.lab` sidecars are
   unaffected because timing doesn't change.
6. **Spectrogram preview.** `request_spectrogram_preview` should request the
   post-processed waveform (same edit hash), so the preview shows what will
   play. Its `hash` matching must include the edit hash.
7. **New commands** (regenerate `src/binding.ts`):
   `analyze_f0(query, style_id) -> F0Contour { frame_period_ms, f0: Vec<f32>, voiced: Vec<bool> }`
   for the editor overlay. Play, save and spectrogram commands gain an
   optional `f0_edit` on `AudioSequenceItem` and the single-item commands.

### Frontend

- A frame-level f0 editor layered on the tuning panel's spectrogram canvas
  (`src/layout/bottomPanel/tuning/`). It draws the analyzed contour plus the
  edited curve and edits with pencil or line tools. It needs its own toggle,
  since the mora sliders already occupy that space; the tuning-options
  `TuningMenu` is the natural place. Gate it behind a default-off
  experimental `UIConfig` switch with a config-dialog row, hiding nested
  rows when off as `AGENTS.md` requires.
- A `F0ContourProvider` context in the style of `PitchBaselineProvider`
  caches the analyzed contour per block, keyed by query signature, style,
  core revision and noise settings, and survives panel remounts.
- **Relationship to mora tuning.** The frame layer sits after all query
  edits: mora pitch, duration, accent, pitch noise and completion change the
  query, and so the base waveform. `pitch_tuning_mode` and
  `PitchBaselineProvider` are untouched; they operate on the query. The
  frame layer reacts to a query change according to decision 2.
- **Reset semantics.** Add a third flag, `f0_is_modified`, in the tuning
  group or as its own panel. It must keep the orthogonality rules in
  `AGENTS.md` (decision 5).

### Persistence (`.azp`, schema 1 evolved in place)

- `ProjectBlock` gains `f0_edit: Option<F0EditDto>` (skip when `None`):
  `{ frame_period_ms, base_fingerprint, representation… }`.
- Recommended representation: **absolute target f0 on edited spans only**.
  For example `segments: [{ start_frame, f0_cents: [i16 or f32 …] }]` in
  cents relative to a fixed reference (such as 440 Hz), with unedited
  frames following the analysis. Storing deltas over the analysis would
  silently change if the base waveform changed (new model, ORT or core
  version).
- `base_fingerprint`: a hash of the serialized query (or the phoneme and
  duration signature) plus style UUID and name. On load, if it doesn't match
  the regenerated or overridden query, keep the edit but mark it stale
  instead of applying it to a different utterance.
- Pristine queries are omitted on save and regenerate after load. A
  frame-level edit on a pristine query depends on regeneration being
  deterministic (seeded noise makes it so, unless the core or model
  changes). The fingerprint covers that case.
- Rust tests: round trip with an edit, rejection of malformed segments
  (out of range, non-finite, overlapping), an edit without a matching block
  query, and stale-fingerprint handling. Unit tests use synthetic pulse
  trains, not VOICEVOX assets, as the testing guidelines require.

## Risks

- **Audible quality loss** on every edited block (option A), and possibly
  worse on breathy, whisper and high-pitched styles. Mitigated by splicing.
  Needs listening tests by you.
- **Low f0 targets** fail with the default 71 Hz floor (male voices,
  downward edits).
- **Voicing errors.** Harvest still flips 3–18% of frames; the user can't
  edit pitch where WORLD says "unvoiced" without also forcing voicing, which
  sounds buzzy.
- **Memory**: about 8 MB of features per 10 s block (`f64`); bounded by the
  LRU.
- **Latency.** First edit of a block costs one analysis (about 0.25× its
  duration with Harvest). Edited blocks lose first-chunk streaming.
- **Maintenance.** Vendoring C++ means owning `unsafe` FFI and a C++
  toolchain in CI (already needed for OpenJTalk/ORT). `world-rs` has
  bus-factor risk and a Harvest parity gap.
- **Invalidation complexity.** Duration edits shift frame alignment, so
  keeping edits across query changes needs mora-relative time warping.

## Open decisions (for you)

1. **WORLD post-process (A) or a native frame-f0 override in the fork
   (B)?** B keeps VOICEVOX quality, streaming and caching intact, but needs a
   new fork API (for example `synthesis_with_frame_f0` and a streaming
   counterpart taking `&[f32]` log-f0 at 93.75 Hz). It also needs an
   experiment to see how faithfully the decoder follows an arbitrary drawn
   contour. Suggestion: run that experiment before building A.
2. **What happens to a frame-level edit when the query changes?** Discard
   it (simplest), keep it stale until the user re-applies, or time-warp it
   per mora (preserves edits through duration changes; more work).
3. **Library: vendored C++ (recommended) or `world-rs`?**
4. **Whole-block resynthesis or splicing only edited regions?**
5. **Reset and flag model.** Is the f0 layer part of the tuning panel's
   reset (alongside `pitch_is_modified` and `duration_is_modified`) or its
   own reset? Should mora pitch sliders be locked while frame edits exist?
6. **Stored representation.** Absolute f0 on edited spans (recommended)
   or deltas over the analysis; cents or Hz; 5 ms or VOICEVOX's 10.67 ms
   frames.
7. **Analysis settings.** Harvest only, or a DIO "fast" option? A fixed
   `f0_floor` or one per style/speaker (male styles need about 40 Hz)?
8. **Whisper and unvoiced-heavy styles.** Disable the editor, or allow
   forcing voicing?
9. **Scope of export.** Should exports always include frame edits, or offer
   "export without post-processing"?

## Reproducing

All of this lives under the ignored `vendor/` directory and isn't committed:

```sh
cd vendor/world-proto/world && cargo build --release
cd .. && ./world/target/release/worldproto out quality samples/s*_t*.wav
./world/target/release/worldproto out rtf samples/metan.wav
```

`vendor/world-proto/vvgen` regenerates `samples/` from the development core
(`ConfigManager` reads `config_dev`). It's a debug build of `azalea_lib`;
build it with a memory cap and few jobs, because a full build on this 12 GB
machine with the target directory on tmpfs was OOM-killed:
`systemd-run --user --scope -p MemoryMax=6G cargo build -j 3`.
