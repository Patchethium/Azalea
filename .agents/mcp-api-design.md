# MCP API Design: Stateless Speech Synthesis (Draft)

Status: draft for discussion. Nothing here is implemented beyond the four
tools marked "exists".

## Where the server is today

`src-tauri/src/mcp.rs` exposes four tools over stdio:

| Tool | What it does |
| --- | --- |
| `list_speakers` | Talk speakers and styles |
| `synthesize` | `text` + (`speaker`, `style`) or `preset` → WAV path |
| `list_presets` / `create_preset` | Server-owned presets in `mcp_presets.toml` |

Gaps a client hits quickly:

1. **Reading and accent are a black box.** A client cannot see how the text was
   read, so it cannot notice or fix a misreading. `Core::audio_query_from_kana`
   and `analyze_text` exist but are not reachable.
2. **Delivery needs a stored preset.** Speed, pitch, intonation, volume and
   silences can only be set by first writing a preset to disk, which is the
   opposite of stateless. Presets cannot be updated or deleted.
3. **No prosody control.** Pitch noise (seed, sigma), mora pitch and duration
   edits, and pitch completion are unavailable.
4. **One utterance, one file, one place.** No multi-line or multi-speaker
   script, no combined file, no choice of output path, sample rate or channels,
   no `.lab` labels or timing, and files pile up in the temp directory.
5. **No discovery.** A client cannot ask what the installation supports
   (pitch control, English readings, limits) or which core version it has.
6. **Long calls are opaque.** No progress and no cancellation.

## Principles

- **Stateless.** A call's result depends only on its arguments and the
  installation (models, user dictionary, app config). The server keeps no
  session, handle or job between calls. Anything a client wants to carry from
  one call to the next travels as a value: text, kana, or a query document.
- **Three levels of input, one pipeline.** `text` (let Azalea read it), `kana`
  (the client fixes reading and accent), `query` (the client fixes everything).
  Each tool that takes an utterance accepts exactly one of them.
- **Deterministic.** Same arguments on the same installation give the same
  audio, including with pitch noise, because the seed is an argument.
- **Additive.** Existing tool names and fields keep their meaning.
- **Read-only towards the app.** The server never changes app config, the user
  dictionary or projects. Presets are the single piece of durable state and are
  optional: everything a preset holds can be passed inline.

## Shared argument groups

These field groups are flattened into each tool's arguments rather than
nested, which is easier for a model to fill in.

### Utterance (exactly one)

| Field | Type | Meaning |
| --- | --- | --- |
| `text` | string | Japanese text, read with the user dictionary and the app's English-word settings |
| `kana` | string | AquesTalk-style kana as VOICEVOX defines it (`コンニチワ'`, `/` and `、` phrase breaks, `_` devoicing, `？` interrogative) |
| `query` | object | A full query document (below) |

### Voice

| Field | Type | Meaning |
| --- | --- | --- |
| `speaker` | string | Name or UUID (exists) |
| `style` | string | Name or numeric ID (exists) |
| `preset` | string | Preset name or ID; replaces `speaker` and `style` (exists) |

### Delivery (all optional)

| Field | Range | Default |
| --- | --- | --- |
| `speed` | 50–200 (%) | 100 |
| `pitch` | -0.5–0.5 | 0 |
| `intonation` | 0–2 | 1 |
| `volume` | 0–2 | 1 |
| `start_silence_ms`, `end_silence_ms` | 0–1500 | 100 |

Same names, units and ranges as `create_preset`. Precedence: explicit argument,
then preset, then the value in a passed `query`, then the default. This makes
presets shorthand rather than a prerequisite.

### Pitch noise (optional)

| Field | Type | Meaning |
| --- | --- | --- |
| `pitch_noise_seed` | u32 | Seed |
| `pitch_noise_sigma` | number ≥ 0 | Strength in natural-log pitch units; 0 or omitted is off |

Rejected with a clear message when `get_status` reports
`features.pitch_control = false` (rather than silently ignored). The app's own
`pitch_noise_enabled` setting is not consulted: the request is self-contained.

### Query document

The `AudioQuery` serialization Azalea already writes as `query` in `.azp`
schema 2, so documents move between the server and project files unchanged.
Roughly 150 bytes per mora. Tools return it only when asked
(`include_query`), since most clients need just the kana.

## Tools

### `get_status` (new)

No arguments. Answers even while the server is disabled and never loads the
core unless it is already loaded.

```json
{
  "enabled": true,
  "app_version": "0.4.0",
  "core": { "loaded": true, "version": "0.17.x", "setup": "downloaded" },
  "features": {
    "pitch_control": true,
    "english_readings": true,
    "streaming": true
  },
  "limits": { "max_text_chars": 2000, "max_items": 200, "max_inline_audio_seconds": 30 },
  "output_dir": "/tmp/azalea-mcp"
}
```

### `list_speakers` (exists, extended)

Adds an optional `speaker` filter (name or UUID) and, per style, `pitch_range`
(`{ min_hz, max_hz }` from `config::range::style_range`, absent when unknown)
and `streaming`. Adds `credit` per speaker (`"VOICEVOX:ずんだもん"`), so the
attribution the server instructions ask for is copyable.

### `analyze_text` (new)

`text` → reading, without a voice and without loading a model
(`Core::analyze_text` plus the English reader).

```json
{
  "kana": "コンニチワ'、/ア'ザレアデ_ス",
  "accent_phrases": [
    { "text": "コンニチワ", "moras": 5, "accent": 5, "pause_after": true },
    { "text": "アザレアデス", "moras": 6, "accent": 1, "pause_after": false }
  ]
}
```

The cheap loop for fixing a misreading is `analyze_text` → edit the kana →
`synthesize` with `kana`.

### `create_query` (new)

Utterance (`text` or `kana`) + Voice + Delivery + Pitch noise → query
document with predicted durations and pitches.

```json
{
  "query": { "...": "AudioQuery" },
  "kana": "コンニチワ'",
  "voice": { "speaker": "ずんだもん", "style": "ノーマル", "style_id": 3 },
  "duration_seconds": 1.42
}
```

### `predict_prosody` (new)

For a client that edited a query's phonemes or accents and wants the model's
prosody back, or wants to vary pitch. `query` + Voice + Pitch noise, plus:

| Field | Type | Meaning |
| --- | --- | --- |
| `scope` | `"all"` \| `"pitch"` \| `"duration"` | What to predict again (default `all`) |
| `keep_pitch_through_mora` | integer | Pitch completion: keep the query's pitches for the first *n* moras (flattened, pauses included) and predict the rest |

Maps to `replace_mora`, `replace_mora_pitch`, `replace_mora_duration`,
`apply_pitch_noise` and `complete_mora_pitch`. Returns the same shape as
`create_query`. Phonemes, accents and delivery values are preserved.

### `synthesize` (exists, extended)

Utterance (now `text`, `kana` or `query`) + Voice + Delivery + Pitch noise,
plus Output:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `output_path` | string | generated file in `output_dir` | Absolute path ending in `.wav` |
| `overwrite` | bool | false | Otherwise an existing file is an error |
| `sample_rate` | 24000 \| 44100 \| 48000 | 24000 | |
| `stereo` | bool | false | |
| `include_audio` | bool | false | Also return the WAV as an MCP audio content block, up to `max_inline_audio_seconds` |
| `include_labels` | bool | false | Also write a `.lab` file next to the WAV |
| `include_timing` | bool | false | Return per-mora timing |
| `include_query` | bool | false | Return the query that was synthesized |

Result (new fields are additions to today's):

```json
{
  "path": "/tmp/azalea-mcp/azalea-3-9f2c….wav",
  "duration_seconds": 1.42,
  "sample_rate": 24000,
  "channels": 1,
  "speaker": "ずんだもん",
  "style": "ノーマル",
  "style_id": 3,
  "preset": null,
  "credit": "VOICEVOX:ずんだもん",
  "kana": "コンニチワ'",
  "labels_path": null,
  "timing": [{ "mora": "コ", "start": 0.10, "end": 0.21 }]
}
```

`kana` is always returned so the client can check the reading without a
second call. The result also carries a `resource_link` to the file for clients
that surface links.

### `synthesize_sequence` (new)

A script: several utterances, each with its own voice, as one file or many.

| Field | Type | Meaning |
| --- | --- | --- |
| `items` | array | Each: Utterance + optional Voice, Delivery, Pitch noise, `gap_after_ms` |
| *Voice, Delivery, Pitch noise* | | Defaults for items that omit them |
| `gap_ms` | 0–5000 | Default silence between items (default 0; each item already has its own edge silences) |
| `combine` | bool | `true` (default): one WAV. `false`: one per item |
| `output_path` | string | The WAV when combined; a directory when not |
| `overwrite`, `sample_rate`, `stereo`, `include_labels`, `include_timing` | | As in `synthesize`; labels of a combined file are offset per item, as the app's combined export does |

```json
{
  "path": "/tmp/azalea-mcp/azalea-seq-41ab….wav",
  "duration_seconds": 12.8,
  "sample_rate": 24000,
  "channels": 1,
  "credits": ["VOICEVOX:ずんだもん", "VOICEVOX:四国めたん"],
  "items": [
    { "index": 0, "start": 0.0, "end": 1.42, "speaker": "ずんだもん", "style": "ノーマル",
      "kana": "コンニチワ'", "path": null }
  ]
}
```

Validation is all-or-nothing and happens before any synthesis: one bad item
fails the call with its index. Reports MCP progress per item when the client
sent a progress token, and stops at the next chunk boundary on cancellation
(the streaming renderer already works chunk by chunk).

### Presets (exist, completed)

`list_presets` and `create_preset` stay. Add `update_preset` (name or ID plus
any `create_preset` field, including a new `name`) and `delete_preset`. These
four are the only tools that write durable state, and no other tool requires
them.

## Cross-cutting behavior

- **Errors.** Still tool results with `isError: true`. Messages start with a
  stable code so clients can branch without parsing prose: `disabled`,
  `no_voice_setup`, `invalid_argument`, `unknown_speaker`, `unknown_style`,
  `unknown_preset`, `voice_unavailable`, `unsupported_feature`,
  `limit_exceeded`, `output_exists`, `io_error`, `core_error`, `cancelled`.
  Unknown names keep listing the valid ones.
- **Unknown arguments are rejected** (`deny_unknown_fields`), so a misspelled
  `intonation` is not silently dropped.
- **Limits** are reported by `get_status` and enforced with `limit_exceeded`.
- **Concurrency.** Calls that touch the core stay serialized behind the
  existing gate; `get_status`, `list_speakers` and `list_presets` do not wait
  for it.
- **Output files.** Generated names stay unique per call. On startup the
  server deletes files in `output_dir` older than 24 hours; files written to a
  client-chosen `output_path` are never touched.
- **Annotations.** Mark `get_status`, `list_*`, `analyze_text`,
  `create_query` and `predict_prosody` as `readOnlyHint`; `delete_preset` as
  `destructiveHint`.

## Deliberately left out

- **Post-processing edits** (WORLD f0 frames, time anchors): frame-level Hz
  arrays are a poor fit for model-written arguments. Could later be accepted
  as an optional `post` object on `synthesize`, since `PostEdit` is already a
  self-contained value.
- **Voice import**: fits statelessly (`audio_path` + utterance → query) and
  would be a natural `import_voice` tool later; needs the aligner pack.
- **User dictionary writes**: changes what the app reads, so it belongs to the
  future app-hosted transport. A read-only `list_dictionary_entries` and a
  per-call `readings` override list are possible stateless additions.
- **Singing styles**, live playback, and control of a running app.

## Suggested order of implementation

1. Inline Delivery on `synthesize`, `kana` input, `kana` in the result,
   `get_status`, error codes.
2. `analyze_text`, `create_query`, `query` input, Pitch noise,
   `predict_prosody`.
3. Output options, labels and timing, `synthesize_sequence`, progress and
   cancellation.
4. `update_preset`, `delete_preset`, `list_speakers` additions, cleanup.

## Open questions

1. **Presets under "stateless".** Keep them as optional shorthand (proposed),
   or freeze them at today's two tools and steer clients to inline arguments?
2. **Client-chosen `output_path`.** Convenient, but lets a client write a WAV
   anywhere the user can. Allow any absolute `.wav` path (proposed), restrict
   to configured directories, or keep temp-only?
3. **Inline audio.** Is returning base64 audio in the result wanted at all, or
   are paths enough for the clients you target?
4. **Query format.** Expose the raw `AudioQuery` (proposed, matches `.azp`),
   or define a smaller model-facing shape and convert?
5. **Pitch noise default.** Off unless the call asks (proposed), or follow the
   app's `pitch_noise_enabled` and sigma when the call says nothing?
6. **Temp cleanup.** Is deleting day-old files in `azalea-mcp/` at startup
   acceptable?
