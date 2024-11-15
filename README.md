# Azalea

`Azalea`(アザレア) is a simple and (relatively) lightweight unofficial GUI for [VOICEVOX](https://github.com/VOICEVOX/voicevox), a **Japanese only** TTS app. [The Author](https://github.com/Patchethium) aims to provide a simple and easy-to-use interface for VOICEVOX, with his own personal touch.

> [!WARNING]
> :construction: **This project is still in development and is not ready for production use.** :construction:

## Installation

We don't provide a pre-built binary yet, as the project is still in heavy development. You can build it yourself by following the instructions below.

## Development

### Prerequisites

- [Rust](https://rustup.rs)
- [bun](https://bun.sh)
- [mold](https://github.com/rui314/mold), if you're on Linux

### Setting up the core

#### Using VOICEVOX

If you have VOICEVOX installed, you already have a core. You can find it in the `vv-engine` directory under the VOICEVOX installation directory.

#### Using the official downloader

You can refer to the [official VOICEVOX documentation](https://github.com/VOICEVOX/voicevox_core?tab=readme-ov-file#%E7%92%B0%E5%A2%83%E6%A7%8B%E7%AF%89) (Japanese), you just need to download their script and execute it.
#### Manually downloading the core

 - Download the core from the [VOICEVOX releases](https://github.com/VOICEVOX/voicevox_core/releases) and extract it to a directory.
 - Download the OpenJTalk dictionary from the [OpenJTalk releases](https://jaist.dl.sourceforge.net/project/open-jtalk/Dictionary/open_jtalk_dic-1.11/open_jtalk_dic_utf_8-1.11.tar.gz) and extract it to the same directory.

The directory should look like this:

```
your_dir/
- voicevox_core_*
    - libvoicevox_core.so
    - libonnxruntime.so
    - ...
    - open_jtalk_dic_utf_8/
        - *.def
        - ...
```
> [!NOTE]
> It would be `.dylib` for MacOS and `.dll` for Windows.

### Setting the environment variables

> [!WARNING]
> The environment variables are only needed in development. In production, users set the core directory in the GUI. This approach will be deprecated after the config system is implemented. Frankly, if you don't want to run `cargo test`, you can skip this step.

Copy the `.env.dev` and rename it to `.env`, set the variable like below:

```ini
VOICEVOX_CORE_DIR=your_dir/voicevox_core/
```

### Setup

```sh
git clone https://github.com/Patchethium/Azalea.git
cd Azalea
# install the dependencies
bun i
# dev build
bun tauri dev
# production build
bun tauri build
# You may also want to clean the artifacts after building, it's 10 GB or so
cd src-tauri
cargo clean
# Frontend lint&format, dev only
bun check
```

## Contributing

Azalea welcomes PRs, please open an issue before making one, as in the early stage, running `git push --force` is common for me.

I can read and write directly in Japanese and English, feel free to reach out to in any of these languages.

## License

GPLv3 or later. See [LICENSE](LICENSE) for more information.

> I'd just like to interject for a moment. What you're referring to as Azalea, is in fact, GNU/Azalea, or as I've recently taken to calling it, GNU plus Azalea. Azalea is not an operating system unto itself, but rather another free component of a fully functioning GNU system made useful by the GNU corelibs, shell utilities and vital system components comprising a full OS as defined by POSIX.

## Credits

A great thank for these projects, which Azalea is based on:

- [VOICEVOX](https://github.com/VOICEVOX/voicevox)
- [tauri](https://github.com/tauri-apps/tauri)
- [bindgen](https://github.com/rust-lang/rust-bindgen)

## About the name

I use flower names for my side projects.

Azalea<sup>[Wikipedia](https://en.wikipedia.org/wiki/Azalea)</sup> is a flower that blooms in spring, the flowers often last several weeks. Shade tolerant, they prefer living near or under trees.

<p><a href="https://commons.wikimedia.org/wiki/File:Azalea,_a_member_of_the_genus_Rhododendron.jpg#/media/File:Azalea,_a_member_of_the_genus_Rhododendron.jpg"><img src="https://upload.wikimedia.org/wikipedia/commons/1/17/Azalea%2C_a_member_of_the_genus_Rhododendron.jpg" alt="Flowers"></a><br>By <a href="//commons.wikimedia.org/wiki/User:Jim_Evans" title="User:Jim Evans">Jim Evans</a> - <span class="int-own-work" lang="en">Own work</span>, <a href="https://creativecommons.org/licenses/by-sa/4.0" title="Creative Commons Attribution-Share Alike 4.0">CC BY-SA 4.0</a>, <a href="https://commons.wikimedia.org/w/index.php?curid=56492422">Link</a></p>