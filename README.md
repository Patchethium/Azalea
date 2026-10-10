# Azalea

**Azalea**(アザレア) is a simple and (relatively) lightweight alternative GUI for [VOICEVOX](https://github.com/VOICEVOX/voicevox), a **Japanese only** TTS app. [The Author](https://github.com/Patchethium) aims to provide a simple and easy-to-use interface for VOICEVOX, with his own personal touch.

> [!WARNING]
> :construction: **This project is still in development and is not ready for production use.** :construction:

## Features

Azalea is a place for me to put ideas that can't be merged into VOICEVOX GUI itself for various reasons. Here's a list of these features:

- Small binary: The app size is less than **5MB** gzipped and requires less than **100MB** RAM usage (without the voice models loaded).
- Lightweight: No `voicevox_engine` bundled, users can reuse existing VOICEVOX installation, resulting in minimal disk usage.
- Alternative UI design: A different take on VOICEVOX's UI/UX, focusing on preset management.
- Pitch range optimization: The pitch range for every speaker is pre-computed for a better tuning experience.
- I18N: English and Japanese are supported, new languages can be added easily by a JSON file.
- Custom themes: Change the themes (primary color) in GUI.
- Talk-only: Although VOICEVOX supports singing synthesis, Azalea focuses on TTS only, excluding singing-related elements for a cleaner UI.

More to come...

## Installation

Pre-built binary is provided in [Releases](https://github.com/Patchethium/Azalea/releases) for MacOS Silicon, Windows and Linux.

## Development

### Prerequisites

- [Rust](https://rustup.rs)
- [pnpm](https://pnpm.io)
- [mold](https://github.com/rui314/mold) and clang, if you're on Linux
- [tauri prerequisites](https://tauri.app/start/prerequisites/)

### Setting up the core

Azalea uses VOICEVOX VVM models through the embedded Rust core. You can use an
existing VOICEVOX installation or download a standalone CPU setup inside Azalea.

#### Downloading only what you need

Choose **Azalea-managed models** in the grouped voice setup control on first
launch or in Config, then open **Manage models** from the same place. The dialog
shows the required CPU ONNX Runtime and Open JTalk system dictionary, then lists
downloaded models and available packages from the pinned 0.16.4 catalog, with a
refresh control to recheck their installation status. Each package has its own
Download or Delete button. Select packages individually or with each list's
select-all checkbox to download or delete them together; downloading selected
packages also repairs missing shared components. Azalea downloads the missing
runtime and dictionary along with the first voice package. Packages can contain
several characters or styles, and none is preselected.

**Apply models** is enabled only when the installed models differ from those the
running core has loaded, or when the managed setup is not loaded yet. Deleting
packages reloads the active managed voices immediately, and removing the last
package returns to the setup empty state. Deletion leaves the runtime, system
dictionary, and custom user dictionary in place.

The downloader pins VOICEVOX VVM 0.16.4, ONNX Runtime 1.17.3, and the Open JTalk
1.11 dictionary from release v1.11.1. A starter package plus runtime and dictionary
requires roughly 85 MB of downloads. GPU dependencies and voice samples are not
downloaded.

Files are verified with SHA-256. Verified hashes are cached in
`.verified.json` with each file's size and modification time, so later checks
rehash only new or changed files, in parallel. Development builds store downloads beneath
the repository's `config_dev/voicevox/`, separately from release data.
Release builds store downloads beneath
`dirs::data_local_dir()/com.azalea.app/voicevox/` (typically
`%LOCALAPPDATA%/com.azalea.app/voicevox` on Windows,
`~/Library/Application Support/com.azalea.app/voicevox` on macOS, and
`$XDG_DATA_HOME/com.azalea.app/voicevox` or
`~/.local/share/com.azalea.app/voicevox` on Linux). Clearing the asset cache does
not remove runtime, dictionary, or model files. Config hides the asset cache
setting while Azalea-managed models are selected, because their speaker icons
are downloaded with the models.

Downloads support progress, cancellation, and retry. Completed components are
kept, and icons are downloaded separately without blocking model installation.

#### Character portraits

The main workspace shows the portrait of the selected text block's character
beside the text blocks. When no portrait is saved, the panel offers a
**Download portraits** button that fetches the portraits of every available
speaker from the
[VOICEVOX resource repository](https://github.com/VOICEVOX/voicevox_resource).
A style-specific portrait is used when the character provides one, and the
character's default portrait otherwise. Portraits are kept in the asset cache.
Like the sidebar, the portrait panel can be resized or collapsed by dragging its
handle, or collapsed and restored by pressing Enter on the focused handle; its
size is remembered.
Review the linked usage terms before downloading; license files are preserved.

After downloading, choose **Apply models** to load the downloaded voices. Existing and downloaded
setups keep separate system dictionaries and models. Their custom
user dictionary is shared. Use the grouped voice setup control in Config to
switch back to **VOICEVOX**. Switching applies the new setup without restarting,
refreshes the voice list and caches, and keeps the current setup if loading fails.
Manual query edits and the open project are preserved.

VOICEVOX Core loads ONNX Runtime once per process. Both setups reuse that first
compatible library; managed models always use CPU. If the CPU-only runtime loads
first, VOICEVOX installation mode also uses CPU for that session.

#### Using VOICEVOX

If you have VOICEVOX installed, you already have a core. You can find it in the `vv-engine` directory under the VOICEVOX installation directory, just pick it in the file dialog popped from GUI.

#### Using the official downloader

You can refer to the [official VOICEVOX documentation](https://github.com/VOICEVOX/voicevox_core?tab=readme-ov-file#%E7%92%B0%E5%A2%83%E6%A7%8B%E7%AF%89) (Japanese), download their script and execute it. The downloaded artifacts will be located in the `voicevox_core` directory.

#### Manually download

 - Download the core from the [VOICEVOX releases](https://github.com/VOICEVOX/voicevox_core/releases) and extract it to a directory.
 - Download the OpenJTalk dictionary from the [OpenJTalk releases](https://jaist.dl.sourceforge.net/project/open-jtalk/Dictionary/open_jtalk_dic-1.11/open_jtalk_dic_utf_8-1.11.tar.gz) and extract it to the same directory.

The directory should contain the following files:

- `libvoicevox_onnxruntime.so.*` (or `.dylib`/`.dll`), the VOICEVOX ONNX Runtime library
- `*.vvm`, the voice model files
- `open_jtalk_dic_utf_8-1.11/`, the OpenJTalk dictionary directory

As long as these files share the same parent directory, Azalea should be able to find them recursively.

> [!NOTE]
> Azalea recursively searches for 8 layers by default, deeper nesting will not be detected.

### Setting the dev config

The config file used in development is located in `config_dev/config.toml`. You can set the core path in the GUI launched by `pnpm tauri dev` and this file will be created automatically.

In release builds, the config file is located at `{config_dir}/com.azalea.app/config.toml` according to the OS, using the bundle identifier from `tauri.conf.json`. See [here](https://codeberg.org/dirs/dirs-rs#features) for where the config directory is on each OS.

### Project files

Azalea project files use the `.azp` extension and contain a TOML
`schema_version`. Projects are currently saved with schema version `1`, and
only that current format is accepted while Azalea remains unreleased.

Schema version `1` gives every text block and preset a persistent ID, with text
blocks referencing presets independently of their display order. It also
records each preset's speaker UUID and style name so changed numeric style IDs
can be remapped safely. Pristine generated `AudioQuery` data is regenerated
after loading rather than stored in the project file; queries containing
manual accent, phoneme, pitch, or duration edits are retained as explicit
`query_override` data.

Experimental pitch noise can be enabled in Config, with an adjustable sigma
(default `0.05`; `0` produces deterministic pitch). Each new text block gets
a random seed that is saved in the project and can be edited in the tuning
panel. Settings apply to future generation and pitch resets; manual edits
remain intact. This uses the fork's `generative-noise` core branch.

### Setup

```sh
git clone https://github.com/Patchethium/Azalea.git
cd Azalea
# install the dependencies
pnpm i
# dev build
pnpm tauri dev
# production build
pnpm tauri build
# frontend lint and formatting
pnpm check
# You may also want to clean the artifacts after building, it's 10 GB or so
cd src-tauri
cargo clean
```

### Testing

The frontend suite and Rust unit tests are deterministic and do not require an
audio device or a graphical session. The Rust integration suite also exercises
the real VOICEVOX Core, so configure a development core in
`config_dev/config.toml` or set `AZALEA_TEST_CORE_DIR` to a directory containing
the runtime, OpenJTalk dictionary, and VVM assets.

```sh
# from the repository root
pnpm test:all

# Rust formatting, followed by all Rust tests
cd src-tauri
cargo fmt --check
cargo test --locked -- --test-threads=1
```

The single Rust test command above includes
`real_core_supports_the_complete_talk_pipeline`; it is not ignored or hidden
behind a Cargo feature. `AZALEA_TEST_CORE_DIR` overrides the development
configuration:

```sh
AZALEA_TEST_CORE_DIR=/path/to/voicevox \
  cargo test --locked -- --test-threads=1
```

A missing or invalid environment override and a missing development core fail
the suite instead of silently skipping the real-core test.

`pnpm test:coverage` produces a frontend coverage report and enforces at least
90% statement, function, and line coverage and 80% branch coverage.

Install [`cargo-llvm-cov`](https://github.com/taiki-e/cargo-llvm-cov), then run
`pnpm test:coverage:rust` for an informational Rust coverage report, including
branch coverage. The Rust coverage suite runs every Rust test but does not
enforce a threshold. `cargo-llvm-cov` currently marks branch coverage as
unstable.

### Pitch Range

`Azalea` comes with a pre-computed pitch range for every speakers in VOICEVOX, for a higher utilization of the tuning panel space.
The pitch range is the narrowest interval covering 97% of corpus pitches above
`0.1`, computed separately for each style. Each style also includes a 128-bin
histogram over the editing range (30% padding on each side, clamped to 0–6.5).
The editor blends the histogram's cumulative distribution with 20% linear
spacing, giving common pitches more vertical space and finer editing steps
while keeping sparse regions reachable. The mapping stays fixed while editing;
only the range and histogram are embedded, not the raw corpus samples. In Config,
use the **Pitch scale** button group to choose **Linear** (VOICEVOX's fixed
3–6.5 range), **Optimal** (the fitted range and default), or **Density-aware**.
This preference does not change stored pitches.

Every time the core gets updated, we need to recompute the pitch range, by

```sh
cd src-tauri
# using `--release` is not necessary, as most time is spent on neural net inference.
cargo run --example range
```

This maintenance command uses the same `AZALEA_TEST_CORE_DIR` override and
development-config fallback as the real-core test.

The range data will be stored in `src-tauri/src/assets/range.json` and bundled into the binary automatically.

### Building Notes

This repo uses `github actions` for cross-platform builds. The build scripts are located in `.github/workflows/`. It's set manually triggered, so that we don't waste resources. On your fork, you need to go to the `Actions` tab and trigger it yourself.

## Contributing

Azalea welcomes PRs, please open an issue before making one, as in the early stage, running `git push --force` is common for me.

I can read and write directly in Mandarin Chinese, Japanese and English, feel free to reach out to in any of these languages.

## License

[GPLv3](LICENSE) or later.

## Credits

A great thank for these projects, which Azalea heavily relies on:

- [VOICEVOX](https://github.com/VOICEVOX/voicevox)
- [tauri](https://github.com/tauri-apps/tauri)
- [Solid-js](https://github.com/solidjs/solid)
- [UnoCSS](https://unocss.dev/)
- [Kobalte](https://kobalte.dev/)

## About the name

I use flower names for my side projects.

Azalea<sup>[Wikipedia](https://en.wikipedia.org/wiki/Azalea)</sup> is a flower that blooms in spring, the flowers often last several weeks. Shade tolerant, they prefer living near or under trees.

<p><a href="https://commons.wikimedia.org/wiki/File:Azalea,_a_member_of_the_genus_Rhododendron.jpg#/media/File:Azalea,_a_member_of_the_genus_Rhododendron.jpg"><img src="https://upload.wikimedia.org/wikipedia/commons/1/17/Azalea%2C_a_member_of_the_genus_Rhododendron.jpg" alt="Flowers"></a><br>By <a href="//commons.wikimedia.org/wiki/User:Jim_Evans" title="User:Jim Evans">Jim Evans</a> - <span class="int-own-work" lang="en">Own work</span>, <a href="https://creativecommons.org/licenses/by-sa/4.0" title="Creative Commons Attribution-Share Alike 4.0">CC BY-SA 4.0</a>, <a href="https://commons.wikimedia.org/w/index.php?curid=56492422">Link</a></p>
