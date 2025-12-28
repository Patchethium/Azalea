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
- Guided Synthesis(experimental): A forced-aligner is bundled to provide word-level timing information from any audio input, which can be directly used in the GUI for synthesis, creating a Voice Conversion-like experience.

More to come...

## Installation

We don't provide a pre-built binary yet, as the project is still in heavy development. You can build it yourself by following the instructions below. Follow the instructions in the [Development](#development) section below.

> [!IMPORTANT]
> According to [here](https://github.com/oven-sh/bun/issues/13076), `bun` has a bug on non-Linux platforms. The issue is with `css-tree` which `UnoCSS` depends on. Before it gets fixed, we will be using `pnpm` instead.

## Development

### Prerequisites

- [Rust](https://rustup.rs)
- [pnpm](https://pnpm.io)
- [mold](https://github.com/rui314/mold) and clang, if you're on Linux
- [tauri prerequisites](https://tauri.app/start/prerequisites/)

### Setting up the core

Azalea only works with VOICEVOX version older than `0.14.0`, where they started to use `*vvm` models.

#### Using VOICEVOX

If you have VOICEVOX installed, you already have a core. You can find it in the `vv-engine` directory under the VOICEVOX installation directory, just pick it in the file dialog popped from GUI.

#### Using the official downloader

You can refer to the [official VOICEVOX documentation](https://github.com/VOICEVOX/voicevox_core?tab=readme-ov-file#%E7%92%B0%E5%A2%83%E6%A7%8B%E7%AF%89) (Japanese), download their script and execute it. The downloaded artifacts will be located in the `voicevox_core` directory.

#### Manually download

 - Download the core from the [VOICEVOX releases](https://github.com/VOICEVOX/voicevox_core/releases) and extract it to a directory.
 - Download the OpenJTalk dictionary from the [OpenJTalk releases](https://jaist.dl.sourceforge.net/project/open-jtalk/Dictionary/open_jtalk_dic-1.11/open_jtalk_dic_utf_8-1.11.tar.gz) and extract it to the same directory.

The directory should contain the following files:

- `libonnxruntime.so`(or .dylib/.dll), the ONNX Runtime library
- `*.vvm`, the voice model files
- `open_jtalk_dic_utf_8-1.11/`, the OpenJTalk dictionary directory

As long as these files share the same parent directory, Azalea should be able to find them recursively.

> [!NOTE]
> Azalea recursively searches for 8 layers by default, deeper nesting will not be detected.

### Setting the dev config

The config file used in development is located in `config_dev/config.toml`. You can set the core path in the GUI launched by `pnpm tauri dev` and this file will be created automatically.

In release builds, the config file is located in the `{config_dir}/azalea/config.toml` directory according to the OS. See [here](https://codeberg.org/dirs/dirs-rs#features) for where the config directory is on each OS.

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
# You may also want to clean the artifacts after building, it's 10 GB or so
cd src-tauri
cargo clean
# Frontend lint&format, dev only
pnpm check
```

### Pitch Range

`Azalea` comes with a pre-computed pitch range for every speakers in VOICEVOX, for a higher utilization of the tuning panel space.
The pitch range is computed by a sliding window algorithm on the generated pitchs which gets the minimum range covering 97% of the pitchs.

Every time the core gets updated, we need to recompute the pitch range, by

```sh
cd src-tauri
# using `--release` is not necessary, as most time is spent on neural net inference.
cargo run --example range
```

The range data will be stored in `src-tauri/src/assets/range.toml` and bundled into the binary automatically.

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