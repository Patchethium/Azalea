# Fine-grained duration control: investigation

Status: research only, written 27 October 2026 against `master` at `9582b7f`.
No app code was changed. The scratch scripts, test clips and listening WAVs are
in the ignored `vendor/world-proto/dur/` (the generator is
`vendor/world-proto/vvgen`).

## What Azalea can do today

The tuning panel edits each mora's consonant and vowel length as a continuous
number of seconds. VOICEVOX does not render it continuously:

- **Every phoneme is rounded to whole decoder frames.** The decoder runs at
  93.75 frames/s, so one frame is 10.67 ms (256 samples at 24 kHz).
  `to_frame_length` in the fork's `engine/talk/interpret_query.rs` computes
  `round_ties_even(round_ties_even(secs × 93.75) / speed_scale)` per
  phoneme. Each phoneme can therefore be up to ±5.3 ms off what the slider
  says, and the speed scale is applied after the first rounding.
- **Verified on the real core** (Shikoku Metan, "ある日の暮方の事である。",
  the vowel of タ, 65.3 ms, which renders as 6 frames = 64 ms): lengthening it
  by 2 ms or 4 ms gives a byte-identical waveform; 5, 6 or 8 ms all jump by
  exactly one frame (+256 samples).
- **Nothing inside a phoneme is controllable.** The decoder's input for every
  frame of a phoneme is identical: the same one-hot phoneme and the same mora
  f0. How the sound evolves inside the phoneme (attack, steady part,
  transition) is decided by the model, so "stretch only the start of this
  vowel" cannot be expressed to it.

So VOICEVOX natively gives duration control at whole-phoneme granularity in
10.67 ms steps, and Azalea's UI suggests more precision than it delivers.

## Options

| Option | Resolution | Where it applies | Quality | Cost |
|---|---|---|---|---|
| **A. Snap the tuning UI to the frame grid** | 10.67 ms per phoneme (unchanged) | Tuning tab | Native | Small: frontend only |
| **B. Per-frame decoder input in the fork** | 10.67 ms; any frame sequence | New fork API (like upstream's singing `FrameAudioQuery`) | Native, but untested outside the training distribution | Fork + Rust + UI; the model still sees identical frames inside a phoneme |
| **C. Time-warp the waveform in post-processing** | Sample-accurate, anywhere, continuous | Post tab, after f0 analysis | Resynthesized region only; spliced bit-exact elsewhere | Rust TSM + time-map UI + schema |

- **A** makes the existing control honest: the duration handles snap to
  frames and show frame counts, so a drag never silently does nothing. It
  adds no new precision.
- **B** would let Azalea hand the decoder an explicit frame sequence. That
  allows odd things like soft phoneme mixtures at boundaries (an experiment;
  the decoder was trained on one-hot input), and it would also be the native
  route to frame-level f0. For duration alone it adds little over today's
  query, because frames inside a phoneme are still identical.
- **C** is the only route to sub-frame lengths and to shaping time *inside*
  a phoneme. It extends the existing Post tab: the user draws a time map
  (move a boundary, stretch or squeeze any span), and the base waveform is
  time-scaled there and spliced into the untouched audio, the way f0 edits
  already are.

## Prototype: stretching a vowel, compared with native lengthening

Native lengthening (changing the vowel length in the query) is the
reference. The tested methods only touch the vowel and a 20 ms margin,
crossfaded over 15 ms, with the original audio before and (shifted) after.

| Stretch of タ's vowel (64 ms) | Native: change to audio *before* the vowel | WORLD vs native, in the vowel | WSOLA vs native, in the vowel |
|---|---|---|---|
| ×1.5 (96 ms) | 2.04 dB | 8.41 dB | 7.23 dB |
| ×2 (128 ms) | 2.94 dB | 9.08 dB | 7.22 dB |
| ×3 (192 ms) | 3.10 dB | 10.37 dB | 9.28 dB |

Numbers are log-spectral distance (lower is closer). Context:

- **Native lengthening is not local.** Making one vowel longer changes the
  decoder's output before it by 2–3 dB: the model re-plans coarticulation
  around the longer vowel. Post-processing keeps the surrounding audio
  bit-identical instead, so it can never match native exactly; the in-vowel
  distance mixes "worse quality" with "different but valid realization".
  For calibration, WORLD resynthesis of unedited VOICEVOX audio scored about
  6–7 dB against the original in the earlier WORLD investigation.
- **WSOLA was closer than WORLD at every factor** and about 8× faster in this
  numpy prototype (about 41 ms vs 323 ms per 1.8 s clip; in the app WORLD's
  analysis would be cached, leaving mostly synthesis). WSOLA also keeps the
  original phase and timbre, while WORLD re-vocodes the region.
- **Large stretches degrade both.** At ×3 the steady vowel starts to sound
  looped (WSOLA) or buzzy (WORLD); the tuning panel's native durations stay
  the better tool for large changes.
- **Sub-frame lengths work:** the WORLD path rendered a vowel 2 ms (48
  samples) longer, which VOICEVOX cannot.

My WSOLA is a naive textbook version (20 ms frames, 10 ms hop, ±5 ms
search), so it is a lower bound; a mature library should do better.
Listen to `vendor/world-proto/dur/dur_base.wav` against
`dur_native_x*.wav`, `dur_wsola_x*.wav` and `dur_world_x*.wav`; the
numbers cannot judge this.

## Time-scale libraries for Rust

| Crate | Algorithm | License | Notes |
|---|---|---|---|
| `signalsmith-stretch` 0.1.3 | Signalsmith Stretch (C++, header-only, bundled) | MIT | Most used (141k downloads), maintained 2025; high quality for speech and music |
| `ssstretch` 0.1.0 | Signalsmith Stretch bindings | MIT | Smaller, older alternative binding |
| `bungee-rs` 0.1.1 | Bungee (C++) | MPL-2.0 | New (2026), little use |
| `rubberband` 0.1.5 | Rubber Band (C++) | GPL-2.0-or-later | Reference quality; GPL is compatible with Azalea's GPL-3.0-or-later; tiny binding |
| `wsola` 0.3.0, `timestretch` 0.15.0 | WSOLA / phase vocoder, pure Rust | MIT | Simple; `timestretch` targets music |
| `tdpsola` 0.1.0 | TD-PSOLA | AGPL-3.0 | Avoid: AGPL, unmaintained since 2020 |

A time map with different rates per span needs either a library that
accepts a varying rate (Signalsmith and Rubber Band both do, through their
time-ratio APIs) or rendering each stretched span separately with context
and splicing.

## Recommendation

1. **Do A now.** It is cheap, keeps everything native, and stops the tuning
   panel from implying precision it does not have.
2. **Treat C as the fine-grained feature, as a time layer in the Post tab.**
   Evaluate `signalsmith-stretch` (MIT, bundled C++, built by `cc` like
   WORLD) against my WSOLA by listening, before committing to a library. Use
   WORLD only for f0, not for time.
3. **Skip B for duration.** Revisit it only if native frame-level f0 becomes
   a goal; it does not help duration much.

## How C would fit the Post tab

- **Order inside Post:** time warp first, then f0. The f0 analysis and f0
  edits are defined on the warped timeline, so under the tab-chain rule a
  time-map change clears the f0 edits (the same way tuning changes clear
  all post edits today).
- **Data:** a `time_map` of anchor pairs (source ms → output ms,
  piecewise-linear, monotonic) next to `post_f0` in the block's post edit,
  sharing the existing `base` fingerprint. Schema 2 is not released yet, so
  it can grow in place.
- **Rendering:** base waveform → time warp (spliced, untouched audio
  bit-exact, later audio shifted) → WORLD analysis of the warped waveform →
  f0 edits spliced as now. Cache the warped waveform per (base, time map).
- **UI:** a time mode in the Post tab with draggable anchors at mora and
  phoneme boundaries (and anywhere else on click), drawn on the same
  spectrogram; Alt-drag or a modifier for continuous moves.
- **Knock-on effects:** the block's real duration changes, so the playback
  timeline, the `.lab` export (phoneme times must go through the time map),
  combined-export offsets and the mora strip must all follow the map.

## Open decisions

1. What does "fine-grained" need to mean: sub-10 ms phoneme lengths, shaping
   time inside a phoneme, or both? This decides whether A is enough.
2. Is a post-processing time layer worth it given that it cannot reproduce
   VOICEVOX's coarticulation around a changed duration?
3. Library: Signalsmith (MIT) or Rubber Band (GPL, the reference), after a
   listening test?
4. Should a time-map change clear f0 edits (strict chain), or should f0
   edits be carried through the map?
5. Should `.lab` export follow the time map?
