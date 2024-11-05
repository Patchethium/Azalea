# Azalea

`Azalea`(アザレア) is a simple and (relatively) lightweight unofficial GUI for VOICEVOX. [I](https://github.com/Patchethium) aim to provide a simple and easy-to-use interface for VOICEVOX, with my own personal touch.

I also put Developer Experience as a priority, by making the codebase as clean and readable as possible and providing a simple structure.

:construction: **This project is still in development and is not ready for use.** :construction:

## Installation

Download from the releases page and execute the installer.

Only Linux amd64 binaries are bundled for now, but you can build it yourself for other platforms.

## Development

### Prerequisites

- [Rust](https://rustup.rs)
- [bun](https://bun.sh)
- [mold](https://github.com/rui314/mold), if you're on Linux

By default Azalea downloads the core from official VOICEVOX servers, but you can also use your own core by setting the `VOICEVOX_CORE` environment variable.

### Setting up the core
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

If the `.so` files are not there, you may be on MacOS(`dylib`) or Windows(`dll`). As long as the extension name matches your platform, it should be fine.

### Setting the environment variables

> [!NOTE]
> The environment variables are only needed in development. In production, users set the core directory in the GUI.

You need to set the `VOICEVOX_CORE_DIR` environment variable to the path of the core directory.

```sh
export VOICEVOX_CORE_DIR=/path/to/your_dir/voicevox_core/
```

#### Using VOICEVOX

If you have VOICEVOX installed, you can use the existing instance. The core should be located at `VOICEVOX/vv-engine/`.

```sh
export VOICEVOX_CORE_DIR=/path/to/VOICEVOX/vv-engine/
```

or add them into your shell profile so that you don't have to set them every time. The path should be **absolute**. You can use `(pwd -P)` to get the current directory.

```sh
# bash
echo "export VOICEVOX_CORE_DIR=/path/to/core" >> ~/.bashrc
# zsh
echo "export VOICEVOX_CORE_DIR=/path/to/core" >> ~/.zshrc
# fish
echo "set -x VOICEVOX_CORE_DIR /path/to/core" >> ~/.config/fish/config.fish
```

As the VOICEVOX core also needs OpenJTalk's dictionary, the crate will search for it under the `VOICEVOX_CORE_DIR`. You can also manually set the `OPENJTALK_DIR` environment variable, just the same as `VOICEVOX_CORE_DIR`.

### Setup

```sh
git clone https://github.com/Patchethium/Azalea.git
cd Azalea

bun i
# it takes a few minutes to compile the first time, half a minute or so after that
bun tauri dev
# this is even slower, 10 minutes or so
bun tauri build
# You may also want to clean the artifacts after building, it's 10 GB or so
cd src-tauri
cargo clean
```

## Contributing

We welcome PRs, please open an issue before making a PR.

I can read and write directly in Japanese and English, feel free to reach out to in any of these languages.

## License

GPLv3 or later. See [LICENSE](LICENSE) for more information.

## Credits

A great thank for these projects, which Azalea is based on:

- [VOICEVOX](https://github.com/VOICEVOX/voicevox)
- [tauri](https://github.com/tauri-apps/tauri)

## About the name

Azalea is a flower that blooms in spring, and is also the name of a character in the game "Azur Lane". I usually use flower names for my projects.

<p><a href="https://commons.wikimedia.org/wiki/File:Azalea,_a_member_of_the_genus_Rhododendron.jpg#/media/File:Azalea,_a_member_of_the_genus_Rhododendron.jpg"><img src="https://upload.wikimedia.org/wikipedia/commons/1/17/Azalea%2C_a_member_of_the_genus_Rhododendron.jpg" alt="Flowers"></a><br>By <a href="//commons.wikimedia.org/wiki/User:Jim_Evans" title="User:Jim Evans">Jim Evans</a> - <span class="int-own-work" lang="en">Own work</span>, <a href="https://creativecommons.org/licenses/by-sa/4.0" title="Creative Commons Attribution-Share Alike 4.0">CC BY-SA 4.0</a>, <a href="https://commons.wikimedia.org/w/index.php?curid=56492422">Link</a></p>