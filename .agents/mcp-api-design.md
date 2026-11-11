# MCP API Design: Stateless Speech Synthesis (Draft 2)

Status: step 1 of the implementation order is done; the rest is design.
"Exists" and "new" in the headings describe the server before that work.
Start with the Handoff below.

## Handoff

Written at the end of the session that produced this design and step 1, for
the session that continues on a local machine.

### State

- Branch `claude/mcp-server-improvement`, pushed, working tree clean. No pull
  request is open; none was asked for.
- The old branch name `claude/compassionate-galileo-rzffn3` may still exist
  on the remote (the session could not delete it). It holds only the first
  draft of this file and can be removed:
  `git push origin --delete claude/compassionate-galileo-rzffn3`.
- The user reviewed and agreed to this whole design, including every item
  under "Assumptions to confirm" (decided, despite the heading). Do not
  reopen them without a reason.

### What step 1 delivered

In `src-tauri/src/mcp.rs`, `src-tauri/src/mcp/presets.rs` and the new
`src-tauri/src/mcp/ids.rs`:

- Tools `get_status`, `list_speakers`, `list_presets`, `create_preset`,
  `update_preset`, `delete_preset`, `synthesize`.
- Presets required by `synthesize`; agent presets as templates filled in by
  `update_preset`, kept in `mcp_presets.toml` until deleted; system presets
  listed read-only; word-pair IDs recorded in `mcp_ids.toml`.
- `synthesize` takes `text` or `kana`, returns `kana` and `credit`, and has
  `apply_dictionary` and the `english*` arguments. The user dictionary is
  re-applied when its file changes.
- Error codes (`fail(code, message)`), `deny_unknown_fields` on requests,
  `MAX_TEXT_CHARS`.

The MCP section of `AGENTS.md` describes the code as it is and is the
reference for what exists; the README lists the tools.

### How it was verified

In a cloud container, with CI's VOICEVOX test assets (ONNX Runtime 1.17.3,
voicevox_vvm 0.16.4 `0.vvm`) through `AZALEA_TEST_CORE_DIR`:

- `cargo test --locked --lib`: 248 passed, 26 of them the MCP server's.
- `--test voicevox_core`: 21 passed, including
  `real_core_mcp_lists_speakers_synthesizes_and_uses_presets` and
  `real_core_mcp_reads_text_with_the_user_dictionary_only_when_asked`.
- `--test downloaded_setup`: passed.
- The debug binary driven over stdio through the whole flow and its errors.

Not run, so run them locally first:

- `--test voice_import` (needs the snfa model; nothing it covers changed).
- The frontend suite and `pnpm check` (no frontend file changed).
- Anything with the English models installed: `english: true` was only
  checked to fail with `unsupported_feature` without them. A successful
  English reading through the server is untested.
- A real MCP client (Claude Code or Desktop), and listening to the audio.
- A config that has system presets. The container's fresh config had none,
  so the `user` list was exercised only in unit tests.

```sh
cd src-tauri && cargo test --locked -- --test-threads=1
```

### Where the code differs from this document

- `get_status` has no `core.version` or `core.setup`. The fork's crate
  version is `0.0.0`, so it was dropped rather than reported; add a real
  source (for example the models' metadata) before bringing it back.
- `get_status` returns `temp_dir` as the shared `{temp_dir}/azalea-mcp/`
  directory. The per-connection directory is step 2.
- `synthesize` results have no `temporary` or `labels_path` yet (step 2) and
  keep `style_id` in addition to the fields shown here.
- `update_preset` requires both `speaker` and `style` on every call.
- Unknown argument names are rejected by rmcp with its own message, as a
  tool error without one of this document's codes.
- `limits` holds only `max_text_chars`; `max_items` comes with
  `synthesize_sequence`.
- The app's presets are keyed in `mcp_ids.toml` by the app's preset ID, or
  by `name:<name>` while the app has given a preset no ID.

### What is left, in order

2. **Output and cleanup.** `output_path` (directory or `.wav` file) and
   `overwrite` on `synthesize`; a per-connection temporary directory removed
   when the client disconnects (after `server.waiting()` in `run_stdio`) and
   stale ones removed at startup; the `temporary` flag; `labels` writing a
   `.lab` with `audio::lab::lab_from_audio_query`. `McpEnvironment::output_dir`
   and `write_wav` are the places to change. Put the retention rule in the
   tool descriptions and the server instructions.
3. **Queries.** The model-facing query shape and its conversion both ways,
   `analyze_text` (`Core::analyze_text`; it must go through `sync_dictionary`
   and honor the English options), `create_query`, `predict_prosody`
   (`Core::replace_mora`, `replace_mora_pitch`, `replace_mora_duration`,
   `apply_pitch_noise`, `complete_mora_pitch`), the `query` and `raw_query`
   inputs, the pitch-noise arguments and `raw`.
4. **Agent dictionaries.** `create_dictionary`, `update_dictionary`,
   `delete_dictionary`, `list_dictionaries`, `dictionary_id`. Issue their IDs
   from the same `IdFile`. `applied_dictionary` currently holds only the user
   dictionary's revision; it must come to identify the combination applied.
   `commands/dictionary.rs` has the word building and the conflict check to
   reuse for `warnings`.
5. **Sequences and the rest.** `synthesize_sequence`, MCP progress and
   cancellation, the `list_speakers` filter and `credit`.

### Things that are easy to get wrong

- `checked_request` validates arguments before any state is read, and tests
  rely on that order (bad arguments never load the core).
- Tools that need the speaker list call `ready()`, which loads the core;
  `get_status` and `delete_preset` deliberately do not.
- The `*_with` methods exist so preset tools can be unit-tested with a fake
  speaker list. Follow the pattern for new tools that need speakers.
- Kana in results carries accent marks, so `テスト` appears as `テ'スト`;
  strip `'`, `_` and `/` before comparing readings in tests.
- Building needs `cargo-about` 0.9.2 and `pnpm install` (the build script
  collects licenses) and the WORLD submodule.
- `config_dev/mcp_presets.toml` and `config_dev/mcp_ids.toml` are ignored by
  git; delete them to start from no agent presets.

## Where the server is today

`src-tauri/src/mcp.rs` exposes four tools over stdio:

| Tool | What it does |
| --- | --- |
| `list_speakers` | Talk speakers and styles |
| `synthesize` | `text` + (`speaker`, `style`) or `preset` → WAV path |
| `list_presets` / `create_preset` | Server-owned presets in `mcp_presets.toml` |

Gaps a client hits quickly:

1. **Reading and accent are a black box.** A client cannot see how the text was
   read, so it cannot notice or fix a misreading.
2. **Presets are write-once.** They cannot be changed or removed, and the
   user's own presets are invisible.
3. **No prosody control.** Pitch noise, mora pitch and duration edits, and
   pitch completion are unavailable.
4. **One utterance, one file, one place.** No multi-speaker script, no choice
   of output location, no `.lab` labels or timing, and files pile up.
5. **No discovery, progress or cancellation.**
6. **App settings leak in.** The English-word settings in the app's config
   change what a call returns.

## Principles

- **Stateless synthesis.** A synthesis call's result depends only on its
  arguments, the preset it names and the installation (models, user
  dictionary). The server keeps no utterance, job or handle between calls;
  what a client carries from one call to the next travels as a value: text,
  kana or a query.
- **Presets and dictionaries are the only state.** Every call that needs a
  voice names a preset by ID. Agent presets and dictionaries are mutable and
  kept on disk until deleted; the user's are read-only.
- **IDs are short word pairs** such as `quick-fox`, so a model can carry them
  between calls without miscopying them.
- **Three levels of input, one pipeline.** `text` (Azalea reads it), `kana`
  (the client fixes reading and accent), `query` (the client fixes
  everything). Each tool that takes an utterance accepts exactly one.
- **The app's config does not reach the server**, except the `mcp_enabled`
  switch. Pitch noise and English-word reading are per-call arguments that
  default to off. The voice setup (which core and models) is still resolved
  from the config, because the server has no other source for it.
- **What still varies is visible.** The installation can change between calls
  (the user edits the dictionary, downloads the English models, switches the
  voice setup). `get_status` reports each of those read-only, so a client can
  tell why the same arguments gave a different result.
- **Deterministic.** Same arguments, preset values and installation give the
  same audio, including with pitch noise, because the seed is an argument.
- **Paths, not payloads.** Audio is returned as a file path, never inline.

## Presets

### Two kinds

| | Agent presets | User presets |
| --- | --- | --- |
| Source | Created by the client through this server | The app's system presets |
| Lifetime | Until deleted; stored in `mcp_presets.toml` in the config directory, never shown by the app | Read from the app on each call |
| Mutable by the server | Yes | Never |
| ID | A word pair issued by `create_preset` | A word pair the server assigns the first time it sees the preset |

An unknown ID is an `unknown_preset` error that lists the valid IDs with
their names.

### IDs

Preset and dictionary IDs are two lowercase English words joined by a hyphen
(`quick-fox`, `lazy-dog`), drawn at random from a built-in word list. An ID
is unique across presets and dictionaries together, so passing one in the
wrong field is caught, and is not reused after deletion. IDs match ignoring
case and surrounding whitespace.

User presets have long opaque IDs in the app, so the server gives each one a
word pair too and remembers the pairing in its own file
(`mcp_ids.toml`, which also records every ID issued), keeping the ID stable across sessions and renames. The
app's files are not touched. `"user"` is reserved for the user dictionary.

### Preset shape

```json
{
  "id": "quick-fox",
  "name": "",
  "speaker": null,
  "style": null,
  "speed": 100,
  "pitch": 0,
  "intonation": 1,
  "volume": 1,
  "start_silence_ms": 100,
  "end_silence_ms": 100
}
```

| Field | Accepts | Notes |
| --- | --- | --- |
| `name` | string | A label for the client's own use; need not be unique |
| `speaker` | name or UUID from `list_speakers` | Required before use |
| `style` | name or numeric ID | Required before use |
| `speed` | 50–200 (%) | |
| `pitch` | -0.5–0.5 | |
| `intonation`, `volume` | 0–2 | |
| `start_silence_ms`, `end_silence_ms` | 0–1500 | |

Listings add read-only `speaker_uuid`, `style_id`, `available` (the voice is
installed) and `complete` (speaker and style are set). User presets resolve
their voice as project presets do: by stored speaker UUID, then style name,
then style ID, never falling back to another speaker.

### `create_preset` (exists, changed)

Optional `copy_from` (any preset ID). Returns a new agent preset: the
template above with defaults, or a copy of the source, under a fresh ID. A
template is not usable until `update_preset` gives it a speaker and style.

### `update_preset` (new)

Takes the whole preset as returned by `create_preset`, filled in. The `id`
selects the agent preset; every other field replaces the stored value, and
omitted fields return to their defaults, so the call is a replace rather than
a merge. Validates ranges and resolves the voice, then returns the stored
preset. A user preset's ID is rejected with `read_only_preset`, suggesting
`create_preset` with `copy_from`.

### `delete_preset` (new)

Removes an agent preset by ID. Agent presets stay until deleted, so clients
should remove the ones they no longer need.

### `list_presets` (exists, changed)

```json
{
  "agent": [ { "id": "quick-fox", "name": "narrator", "speaker": "ずんだもん", "…": "…" } ],
  "user":  [ { "id": "calm-river", "name": "Default", "speaker": "四国めたん", "…": "…" } ]
}
```

### Typical flow

```
list_speakers                       → pick a speaker and style
create_preset                       → { id: "quick-fox", speaker: null, … }
update_preset { id, speaker, style, speed: 110, … }
synthesize { preset_id: "quick-fox", text: "こんにちは" }
```

Or, with a preset the user already made: `list_presets` → `synthesize` with
an ID from `user`.

## Shared argument groups

Flattened into each tool's arguments rather than nested.

### Utterance (exactly one)

| Field | Type | Meaning |
| --- | --- | --- |
| `text` | string | Japanese text, read with the user dictionary |
| `kana` | string | AquesTalk-style kana as VOICEVOX defines it (`コンニチワ'`, `/` and `、` phrase breaks, `_` devoicing, `？` interrogative) |
| `query` | object | A query in the model-facing shape (below) |
| `raw_query` | object | A raw `AudioQuery` |

### Preset (required wherever a voice is needed)

`preset_id`: an ID from `list_presets` or `create_preset`. Missing →
`missing_preset`; incomplete → `incomplete_preset`; voice not installed →
`voice_unavailable`. The preset's speed, pitch, intonation, volume and
silences always apply, replacing those values in a passed `raw_query`.

### Reading options (with `text` only, optional)

| Field | Default | Meaning |
| --- | --- | --- |
| `apply_dictionary` | `true` | Read the text with the user dictionary |
| `dictionary_id` | none | Also read it with this agent dictionary (see Dictionaries) |
| `english` | `false` | Read English words OpenJTalk does not know as katakana. `unsupported_feature` when the models are not downloaded |
| `english_accent` | `true` | Use the predicted accent for those words |
| `english_ngram_filter` | `true` | Keep acronyms spelled out |
| `english_model` | `"base"` | `"base"` or `"turbo"` (the smaller distilled model) |

These apply to `analyze_text`, `create_query`, `synthesize` and
`synthesize_sequence`. The app's own English-word switches are not consulted.
Without `english`, such words are spelled out letter by letter.

### Pitch noise (optional)

| Field | Type | Meaning |
| --- | --- | --- |
| `pitch_noise_sigma` | number ≥ 0 | Strength in natural-log pitch units; omitted or 0 is off |
| `pitch_noise_seed` | u32 | Seed, default 0 |

`unsupported_feature` when `get_status` reports `pitch_control: false`.

### Output (optional)

| Field | Meaning |
| --- | --- |
| `output_path` | Omitted: a generated name in the temporary directory. A directory: a generated name inside it (created if missing). A path ending in `.wav`: exactly that file |
| `overwrite` | Replace an existing file at an explicit `.wav` path (default `false` → `output_exists`) |

The server tries the write and reports `io_error` with the system's message
if it fails; nothing is written to the temporary directory as a fallback.

**Retention, stated in the tool descriptions and server instructions:** audio
written without an `output_path` is temporary. It lives in a directory of its
own for the connection (`temp_dir` in `get_status`, under
`{temp_dir}/azalea-mcp/`) and is deleted when the client disconnects. Audio
worth keeping must be written elsewhere with `output_path`; the server never
deletes files outside its temporary directory.

A server that is killed cannot clean up, so each server also removes, when it
starts, the directories of connections whose process no longer exists. Other
servers running at the same time are left alone.

## Query shapes

Tools return the model-facing shape by default. With `raw: true` they return
the raw `AudioQuery` instead, in the serialization Azalea writes as `query` in
`.azp` schema 2, as `raw_query`.

### Model-facing shape

```json
{
  "kana": "コンニチワ'、/ア'ザレアデ_ス",
  "accent_phrases": [
    {
      "accent": 5,
      "interrogative": false,
      "pause_ms": 320,
      "moras": [
        { "kana": "コ", "consonant_ms": 62, "vowel_ms": 88, "pitch_hz": 212.4 },
        { "kana": "ン", "vowel_ms": 71, "pitch_hz": 221.0 }
      ]
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `kana` | The whole reading; output only, ignored on input |
| `accent` | 1-based mora where the pitch falls; equal to the mora count for a flat (heiban) phrase |
| `pause_ms` | Pause after the phrase; absent for none |
| `moras[].kana` | Katakana of the mora; decides its phonemes |
| `consonant_ms` | Absent for moras without a consonant |
| `pitch_hz` | `0` for unvoiced (devoiced) moras |

Differences from the raw query: pitch is in Hz instead of natural-log Hz,
lengths in milliseconds instead of seconds, phonemes are implied by the kana,
and the delivery values (speed, pitch shift, intonation, volume, silences,
sample rate, stereo) are absent because the preset supplies them.

On input the server converts back and validates: kana must be a known mora,
`accent` within the phrase, values finite and non-negative. A devoiced vowel
is expressed by `pitch_hz: 0`.

## Tools

### `get_status` (new)

No arguments. Answers even while the server is disabled and never loads the
core.

```json
{
  "enabled": true,
  "app_version": "0.4.0",
  "core": { "loaded": true },
  "english": { "available": true },
  "pitch_control": { "available": true },
  "dictionary": { "entries": 42, "revision": "5d1f0c2a" },
  "app_settings": {
    "english": { "enabled": true, "accent_prediction": true, "ngram_filter": true, "model": "base" },
    "pitch_noise": { "enabled": false, "sigma": 0.1 },
    "pitch_completion": { "enabled": false }
  },
  "limits": { "max_text_chars": 2000, "max_items": 200 },
  "temp_dir": "/tmp/azalea-mcp/7c41"
}
```

Everything here is read-only; no tool changes it.

| Field | Meaning | What it gates or explains |
| --- | --- | --- |
| `english.available` | The English reading models are downloaded | The `english` argument; otherwise `unsupported_feature` |
| `pitch_control.available` | The loaded runtime supports pitch control; `null` until the core is loaded | `pitch_noise_sigma` and `keep_pitch_through_mora` |
| `dictionary.entries`, `dictionary.revision` | Size of the user dictionary and a short hash of its contents | A changed revision means `text` may be read differently than before |

`app_settings` shows how the user has these features set in the Azalea app,
as a reminder only. They have no effect on the server: a client that wants
the app's behavior passes the matching arguments itself (`english`,
`english_accent`, `english_ngram_filter`, `english_model`,
`pitch_noise_sigma`). The field's description says so, so a model does not
read `enabled: true` as "already applied". When a feature is unavailable, the `unsupported_feature` message says what the user must do
(download the English models; use Azalea-managed models and restart).

### `list_speakers` (exists, extended)

Adds an optional `speaker` filter (name or UUID) and a `credit` string per
speaker (`"VOICEVOX:ずんだもん"`).

### Dictionaries

Dictionaries follow the preset model: the user's is read-only, and the
client creates its own and names one per call.

| | Agent dictionaries | User dictionary |
| --- | --- | --- |
| Source | Created by the client through this server | The dictionary the app saved |
| Lifetime | Until deleted; stored in `mcp_dictionaries.toml` in the config directory, never visible to the app | Reloaded before a call when its file has changed |
| Mutable by the server | Yes | Never |
| Selected by | `dictionary_id` | `apply_dictionary` |

```json
{
  "id": "lazy-dog",
  "name": "",
  "entries": [
    { "surface": "Azalea", "pronunciation": "アザレア", "accent_type": 1,
      "word_type": "ProperNoun", "priority": 5 }
  ]
}
```

`accent_type` is the mora after which the pitch falls, `0` for flat.
`word_type` (default `ProperNoun`) and `priority` (0–10, default 5) are
optional. A dictionary holds one entry per surface.

#### `create_dictionary` (new)

Optional `copy_from`: another dictionary's ID, or `"user"` to start from the
user dictionary. Returns a new agent dictionary, empty or copied, under a
fresh ID. An empty dictionary is valid to use.

#### `update_dictionary` (new)

Takes the whole dictionary as returned by `create_dictionary`, with its
entries edited. The `id` selects it and the rest replaces what is stored, as
`update_preset` does. Returns the stored dictionary with a `revision`, plus a
`warnings` list naming entries whose reading OpenJTalk's own would still beat
in some context (alone or before a particle), as the app's dictionary dialog
warns, so the client can raise their priority.

#### `delete_dictionary` (new)

Removes an agent dictionary by ID.

#### `list_dictionaries` (new)

```json
{
  "agent": [ { "id": "lazy-dog", "name": "names", "revision": "9a02c4e1", "entries": [ … ] } ],
  "user": { "revision": "5d1f0c2a", "entries": [ … ] }
}
```

Optional `surface` filter (substring) on the entries returned.

#### Using them

Two Reading options decide what a `text` call is read with:

| `apply_dictionary` | `dictionary_id` | Read with |
| --- | --- | --- |
| `true` (default) | omitted | The user dictionary |
| `true` | set | Both; the agent entry is used where both hold a surface |
| `false` | omitted | OpenJTalk alone |
| `false` | set | The agent dictionary alone, so the reading depends on nothing the user can change in the app |

An unknown `dictionary_id` is an `unknown_dictionary` error. Unlike `preset_id`,
`dictionary_id` is optional.

### `analyze_text` (new)

`text` + Reading options → the reading, without a preset and without loading
a voice model. Returns the model-facing shape without `consonant_ms`,
`vowel_ms` and `pitch_hz` (those need a voice).

The cheap loop for fixing a misreading: `analyze_text` → edit the kana →
`synthesize` with `kana`.

### `create_query` (new)

Utterance (`text` or `kana`) + Preset + Reading options + Pitch noise +
`raw` → a query with predicted lengths and pitches.

```json
{
  "query": { "kana": "…", "accent_phrases": [ … ] },
  "preset_id": "quick-fox",
  "speaker": "ずんだもん",
  "style": "ノーマル",
  "duration_seconds": 1.42
}
```

`duration_seconds` includes the preset's speed and silences.

### `predict_prosody` (new)

For a client that changed a query's kana or accents and wants the model's
prosody back, or wants a different pitch contour. Utterance (`query` or
`raw_query`) + Preset + Pitch noise + `raw`, plus:

| Field | Type | Meaning |
| --- | --- | --- |
| `scope` | `"all"` \| `"pitch"` \| `"duration"` | What to predict again (default `all`) |
| `keep_pitch_through_mora` | integer | Keep the query's pitches for the first *n* moras (counted across phrases, pauses included) and predict the rest. Needs `pitch_control` |

Returns the same shape as `create_query`. Maps to `replace_mora`,
`replace_mora_pitch`, `replace_mora_duration`, `apply_pitch_noise` and
`complete_mora_pitch`.

### `synthesize` (exists, changed)

Utterance (any of the four) + Preset + Reading options + Pitch noise +
Output, plus:

| Field | Default | Meaning |
| --- | --- | --- |
| `labels` | `false` | Also write a `.lab` phoneme label file next to the WAV |
| `include_query` | `false` | Return the synthesized query (`raw` selects its shape) |

```json
{
  "path": "/tmp/azalea-mcp/7c41/azalea-9f2c….wav",
  "temporary": true,
  "duration_seconds": 1.42,
  "sample_rate": 24000,
  "preset_id": "quick-fox",
  "speaker": "ずんだもん",
  "style": "ノーマル",
  "credit": "VOICEVOX:ずんだもん",
  "kana": "コンニチワ'",
  "labels_path": null
}
```

`kana` is always returned, so the client can check the reading without a
second call. `temporary` tells it whether the file will be deleted when the
client disconnects.

### `synthesize_sequence` (new)

A script: several utterances, each with its own preset, as one file or many.

| Field | Type | Meaning |
| --- | --- | --- |
| `items` | array | Each: Utterance, and optionally `preset_id`, Reading options, Pitch noise, `gap_after_ms` |
| `preset_id`, Reading options, Pitch noise | | Defaults for items that omit them. An item with no preset of its own and no default fails the call |
| `gap_ms` | 0–5000 | Silence between items (default 0; each item already carries its preset's silences) |
| `combine` | bool | `true` (default): one WAV. `false`: one per item |
| `output_path` | string | As in Output when combined. When not combined, a directory |
| `overwrite`, `labels` | | As in `synthesize`; labels of a combined file are offset per item |

```json
{
  "path": "/tmp/azalea-mcp/7c41/azalea-seq-41ab….wav",
  "temporary": true,
  "duration_seconds": 12.8,
  "sample_rate": 24000,
  "credits": ["VOICEVOX:ずんだもん", "VOICEVOX:四国めたん"],
  "items": [
    { "index": 0, "start": 0.0, "end": 1.42, "preset_id": "quick-fox", "kana": "コンニチワ'", "path": null }
  ]
}
```

All items are validated before any synthesis; one bad item fails the call
with its index. Reports MCP progress per item when the client sent a progress
token, and stops at the next chunk boundary on cancellation.

## Cross-cutting behavior

- **Errors.** Tool results with `isError: true`. Messages start with a stable
  code: `disabled`, `no_voice_setup`, `invalid_argument`, `missing_preset`,
  `unknown_preset`, `incomplete_preset`, `read_only_preset`,
  `unknown_dictionary`,
  `unknown_speaker`, `unknown_style`, `voice_unavailable`,
  `unsupported_feature`, `limit_exceeded`, `output_exists`, `io_error`,
  `core_error`, `cancelled`. Unknown names keep listing the valid ones.
- **Unknown arguments are rejected**, so a misspelled field is not silently
  dropped.
- **Concurrency.** Calls that touch the core stay serialized behind the
  existing gate; status, listings and preset edits do not wait for it.
- **Annotations.** `get_status`, `list_*`, `analyze_text`, `create_query` and
  `predict_prosody` are `readOnlyHint`; `delete_preset` is `destructiveHint`.

## Migration from the current tools

- `synthesize` no longer takes `speaker` and `style`; it requires `preset_id`
  (renamed from `preset`), which takes an ID only, not a name.
- `create_preset` no longer takes a name, voice and values; it returns a
  template to fill and pass to `update_preset`.
- `list_presets` returns `{ agent, user }` instead of `{ presets }`.
- `mcp_presets.toml` keeps holding the agent presets. Presets already in it
  stay usable and get a word-pair ID on first load.
- English words are no longer read as katakana unless the call sets
  `english`.

## Deliberately left out

- **Inline audio** (base64): fills the client's context; paths only.
- **Post-processing edits** (WORLD f0 frames, time anchors): could later be an
  optional `post` object on `synthesize`.
- **Voice import** (`audio_path` + utterance → query): a natural later tool;
  needs the aligner pack.
- **User dictionary writes**: they change what the app reads, so they belong
  to the future app-hosted transport. Client-owned entries go in agent
  dictionaries instead.
- **Sample rate and stereo output**, singing styles, live playback, control of
  a running app.

## Suggested order of implementation

1. **Done.** Preset rework (`create_preset`, `update_preset`, `delete_preset`, two-field
   `list_presets`), `synthesize` requiring a preset, `kana` input and output,
   `get_status`, `apply_dictionary` with reload on change, the `english`
   arguments, error codes, config isolation.
2. Output location, temporary-audio cleanup on disconnect, labels.
3. Model-facing query shape, `analyze_text`, `create_query`,
   `predict_prosody`, pitch noise, `raw`.
4. Agent dictionaries (`create_dictionary`, `update_dictionary`,
   `delete_dictionary`, `list_dictionaries`, `dictionary_id`).
5. `synthesize_sequence`, progress and cancellation, `list_speakers`
   additions.

## Assumptions to confirm

1. **Agent presets and dictionaries are permanent.** They are a few hundred
   bytes each, so they stay on disk until the client deletes them, with no
   expiry. Synthesized audio without an `output_path` is deleted when the
   connection closes.
2. **User presets are the app's system presets** (`system_presets` in the
   config). Reading them is treated as data rather than a setting. Project
   presets stay out of reach because the server opens no project.
3. **Config isolation covers English-word reading**, which becomes the
   per-call `english` argument, default off. The user dictionary still
   applies, since it is not a config setting.
4. **`update_preset` replaces the whole preset** rather than merging the
   fields it is given.
5. **`preset_id` and `dictionary_id` accept IDs only**, and IDs are short
   word pairs (`quick-fox`, `lazy-dog`) that a model can repeat reliably.
   User presets get one too, through an alias file the server keeps.
6. **`query` and `raw_query` are separate input fields**, and `raw: true`
   switches the output to `raw_query`.
7. **The server reloads the dictionary when its file changes.** Today it is
   applied once, when the core loads.
8. **`apply_dictionary` defaults to `true`**, matching today's behavior. The
   core holds one dictionary at a time, so a call that differs from the
   previous one swaps it under the core gate first.
9. **Agent dictionaries are permanent**, like agent presets, and
   `update_dictionary` replaces the whole dictionary.
10. **With both dictionaries applied, the agent entry wins** for a surface
    both hold.
