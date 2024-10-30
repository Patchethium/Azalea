# Azalea

Azalea is a simple and (relatively) lightweight unofficial GUI for VOICEVOX. [I](https://github.com/Patchethium) aim to provide a simple and easy-to-use interface for VOICEVOX, with my own personal touch.

I also put Developer Experience as a priority, by making the codebase as clean and readable as possible and providing a simple structure.

## Development

### Prerequisites

- [Rust](https://rustup.rs)
- [bun](https://bun.sh)
- [mold](https://github.com/rui314/mold), if you're on Linux

By default Azalea downloads the core from official VOICEVOX servers, but you can also use your own core by setting the `VOICEVOX_CORE` environment variable.

```sh
export VOICEVOX_CORE_DIR=/path/to/core
# if you have VOICEVOX installed, the core should be located at VOICEVOX/vv-engine/
export VOICEVOX_CORE_DIR=/path/to/VOICEVOX/vv-engine/
```

or add them into your shell profile so that you don't have to set them every time. The path should be **absolute**.

```sh
# bash
echo "export VOICEVOX_CORE_DIR=/path/to/core" >> ~/.bashrc
# zsh
echo "export VOICEVOX_CORE_DIR=/path/to/core" >> ~/.zshrc
# fish
echo "set -x VOICEVOX_CORE_DIR /path/to/core" >> ~/.config/fish/config.fish
```

### Setup

```sh
git clone https://github.com/Patchethium/Azalea.git
cd Azalea

bun i

bun tauri dev

bun tauri build
```

## Contributing

Please open an issue before making a PR :pleading_face:

I can read and write directly in Japanese and English, feel free to reach out to in any of these languages.

## License

GPLv2 or later.

## Credits

A great thank for these projects, which Azalea is based on:

- [VOICEVOX](https://github.com/VOICEVOX/voicevox)
- [tauri](https://github.com/tauri-apps/tauri)

## About the name

Azalea is a flower that blooms in spring, and is also the name of a character in the game "Azur Lane". I usually use flower names for my projects.

<p><a href="https://commons.wikimedia.org/wiki/File:Azalea,_a_member_of_the_genus_Rhododendron.jpg#/media/File:Azalea,_a_member_of_the_genus_Rhododendron.jpg"><img src="https://upload.wikimedia.org/wikipedia/commons/1/17/Azalea%2C_a_member_of_the_genus_Rhododendron.jpg" alt="Flowers"></a><br>By <a href="//commons.wikimedia.org/wiki/User:Jim_Evans" title="User:Jim Evans">Jim Evans</a> - <span class="int-own-work" lang="en">Own work</span>, <a href="https://creativecommons.org/licenses/by-sa/4.0" title="Creative Commons Attribution-Share Alike 4.0">CC BY-SA 4.0</a>, <a href="https://commons.wikimedia.org/w/index.php?curid=56492422">Link</a></p>