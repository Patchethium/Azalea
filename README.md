# Azalea

**Azalea**（アザレア）is an unofficial desktop GUI for
[VOICEVOX](https://github.com/VOICEVOX/voicevox), focused on Japanese
text-to-speech and voice presets. It uses the Rust VOICEVOX Core directly,
without running `voicevox_engine`.

[English quickstart](#quickstart) · [日本語](#日本語)

> [!WARNING]
> This project is still in development and is not ready for production use.
> プロジェクトは開発中です。本番用途での利用はまだ推奨していません。

## Features

- **Choose your voice setup.** Reuse an existing VOICEVOX installation or
  download selected voice packages, a CPU runtime, and the system dictionary
  from inside Azalea. Switch setups without restarting.
- **Organize dialogue with presets.** Assign speakers, styles, and synthesis
  settings to text blocks. Drag the grip handles to reorder blocks and presets.
  Import `.txt` or `.srt` files, or paste multiple lines as separate blocks.
- **Tune speech visually.** Edit readings, accents, pitch, and duration, with a
  mel spectrogram behind the tuning controls. Choose absolute pitch editing or
  relative editing in semitones around the predicted pitch; absolute mode also
  offers fitted and density-aware scales for each voice style.
- **Read English words naturally.** English words the dictionary doesn't know
  are read as katakana with a predicted accent instead of being spelled out
  letter by letter, while acronyms stay spelled out. Turn off the accent
  prediction or the acronym filter separately in the settings, or switch to a
  faster turbo model.
- **Explore pitch variation.** Optional seeded pitch noise gives repeatable
  variations. Optional pitch completion regenerates pitches after an edited
  mora while preserving the edited prefix; lock completion from the tuning
  toolbar when you want to keep the remaining pitches.
- **Preview and export.** Play the selected block or the sequence from it.
  Export one block, every non-empty block as separate WAV files, or all of them
  as one WAV with the presets' leading and trailing silences. Optional `.txt`
  and lip-sync `.lab` sidecars accompany audio exports.
- **Keep your work.** Save `.azp` projects with presets and manual tuning, use
  Save As, and reopen recent projects. The current schema is version `1`;
  unversioned projects and other schema versions are not supported.
- **Make the workspace yours.** Download character portraits, resize or
  collapse panels, customize shortcuts, and choose a light/dark theme and
  primary color. The interface supports English, Japanese, and Simplified
  Chinese; speech synthesis is Japanese only.

## Quickstart

1. Install the appropriate build from
   [Releases](https://github.com/Patchethium/Azalea/releases) for Windows,
   macOS Apple Silicon, or Linux. Older releases may not include every feature
   described here; this README follows the current source.
2. Launch Azalea and select **Open config** on the first-launch screen. In
   **Voice → Voice setup**, choose one of the following:
   - **Azalea-managed models:** review the linked model terms, select the voice
     packages you want under **Manage models**, and download them. The missing
     CPU runtime and system dictionary download automatically. Select
     **Apply models** when finished.
   - **VOICEVOX:** select **Choose...** and choose the `vv-engine` directory
     inside your existing VOICEVOX installation.
3. Close Config. Enter Japanese text in a text block and select a preset in
   the sidebar to assign its voice. Use the preset editor to change the speaker,
   style, or synthesis settings. Add more blocks as needed and drag their grip
   handles to change the order.
4. Select a block and use **Accent** or **Tuning** in the bottom panel to edit
   speech. Play the selected cell to listen. The spectrogram is enabled by
   default; with background buffering disabled, it updates after playback
   synthesis. Optional noise and completion are enabled in Config's **Voice**
   section. The tuning toolbar's three-dot menu switches pitch editing modes.
5. Open **Project actions** at the bottom of the sidebar and **Save project**
   as an `.azp` file. Use a block's export button for one WAV, **Export all**
   for separate files, or **Export all as one file…** for a combined WAV.
   Keep a saved copy of important work; autosave currently requires a project
   that has already been saved to a path.

Portraits are optional: choose **Download portraits** in the portrait panel and
review the linked usage terms. See [Setting up the core](#setting-up-the-core)
for download locations, runtime limitations, and manual setup.

## 日本語

Azalea（アザレア）は、VOICEVOX向けの非公式デスクトップGUIです。
日本語の読み上げとプリセット管理に重点を置き、`voicevox_engine`を起動せずに
Rust版VOICEVOX Coreを直接利用します。

### 主な機能

- **音声環境の選択：** インストール済みのVOICEVOXを利用するか、必要な音声モデルと
  CPUランタイム、システム辞書をアプリ内でダウンロードできます。
  再起動せずに環境を切り替えられます。
- **プリセットで台本を整理：** テキストブロックごとに話者、スタイル、合成設定を
  割り当てられます。ブロックとプリセットはハンドルをドラッグして並べ替えられます。
  `.txt`・`.srt`の読み込みや、複数行を別々のブロックとして貼り付ける操作にも対応します。
- **音声を見ながら調整：** 読み、アクセント、音高、長さを編集でき、調整パネルには
  メルスペクトログラムが表示されます。音高は絶対値のほか、予測値からの差を半音単位で
  調整できます。絶対値モードではスタイルごとに最適化したスケールも選べます。
- **英単語の読み：** 辞書にない英単語は、一文字ずつ読む代わりに、予測したアクセントの
  カタカナで読みます。略語は一文字ずつ読みます。アクセント予測と略語の判定は設定で
  個別に無効にでき、高速なターボモデルにも切り替えられます。
- **音高のバリエーション：** 任意で有効にするノイズ付き音高生成は、シードを指定して
  同じ変化を再現できます。音高補完を有効にすると、編集したモーラまでの音高を保ったまま
  後続を再生成します。調整ツールバーのロックで補完を一時的に止められます。
- **再生と書き出し：** 選択中のブロックや、そこから後のブロックを連続再生できます。
  WAVはブロック単位、全ブロックを個別ファイル、または1つに結合して書き出せます。
  結合時も各プリセットの前後の無音が含まれます。テキスト（`.txt`）と
  リップシンク用ラベル（`.lab`）の同時出力も設定できます。
- **プロジェクトの保存：** プリセットと手動調整を`.azp`に保存し、名前を付けて保存したり、
  最近使ったプロジェクトを開いたりできます。現在はスキーマバージョン`1`のみ対応し、
  バージョンなしのファイルや他のバージョンは読み込めません。
- **表示と操作のカスタマイズ：** キャラクターの立ち絵、パネルのサイズ変更・折りたたみ、
  ショートカット、ライト・ダークテーマとテーマ色を設定できます。
  UIは日本語・英語・簡体字中国語に対応し、音声合成は日本語専用です。

### はじめ方

1. [Releases](https://github.com/Patchethium/Azalea/releases)から、お使いの環境
   （Windows・macOS Apple Silicon・Linux）向けのビルドをインストールします。
   このREADMEは現在のソースコードに対応しているため、古いリリースには未搭載の機能があります。
2. 起動時の画面で**設定を開く**を押し、**音声 → 音声環境**で次のいずれかを選びます。
   - **Azalea管理のモデル：** **モデル管理**でリンク先の利用規約を確認し、必要なモデルを
     選んでダウンロードします。未取得のCPUランタイムとシステム辞書も自動で取得されます。
     完了したら**モデルを適用**を押します。
   - **VOICEVOX：** **選択...**から、インストール済みVOICEVOXの中にある
     `vv-engine`フォルダーを選びます。
3. 設定を閉じ、テキストブロックに日本語を入力します。サイドバーでプリセットを選ぶと、
   その声をブロックに割り当てられます。プリセットの編集欄で話者・スタイル・合成設定を
   変更できます。必要に応じてブロックを増やし、ハンドルのドラッグで順番を調整します。
4. ブロックを選択して、下部の**アクセント**または**調整**で編集し、
   **選択したセルを再生**で確認します。スペクトログラムは初期設定で有効です。
   音声のバックグラウンド生成が無効な場合は、再生用の合成後に更新されます。
   ノイズ付き音高生成と音高補完は、設定の**音声**から有効にできます。
   調整ツールバーの三点メニューで音高の編集モードを切り替えられます。
5. サイドバー下部の**プロジェクト操作 → プロジェクト保存**で`.azp`として保存します。
   各ブロックの書き出しボタンで1つのWAV、**すべて書き出し**で個別のWAV、
   **すべてを1つのファイルに書き出し…**で結合したWAVを出力できます。
   大切な作業は保存してください。現在の自動保存は、保存先を指定済みのプロジェクトが対象です。

立ち絵は任意です。立ち絵パネルの**立ち絵をダウンロード**から、リンク先の利用規約を確認して
取得できます。保存先やランタイムの制約、手動設定については、英語の
[Setting up the core](#setting-up-the-core)を参照してください。

## Development

### Prerequisites

- [Rust](https://rustup.rs)
- [pnpm](https://pnpm.io)
- Node.js 22 or later (also required for Rust builds to collect frontend licenses)
- [cargo-about](https://github.com/EmbarkStudios/cargo-about) 0.9.2:
  `cargo install cargo-about --locked --version 0.9.2 --features cli`
- [mold](https://github.com/rui314/mold) and clang, if you're on Linux
- [tauri prerequisites](https://tauri.app/start/prerequisites/)

Run `pnpm install --frozen-lockfile` before building Rust. `build.rs` collects
Rust and production frontend license texts, plus WORLD's license, into Cargo's
`OUT_DIR` and embeds them for the **Licenses** dialog above **About** in the app
menu. Reports are reused until their inputs change; generated files are not
committed. The first collection may need network access for Cargo metadata and
license retrieval. `CARGO_NET_OFFLINE=true` restricts cargo-about to local files;
`CARGO_ABOUT` can point to a standalone cargo-about executable. Missing tools or
unresolved licenses fail the build with diagnostics. Run `pnpm test:licenses`
to test the collector without network access or cargo-about.

### Setting up the core

Azalea uses VOICEVOX VVM models through the embedded Rust core. You can use an
existing VOICEVOX installation or download a standalone CPU setup inside Azalea.

#### Downloading only what you need

Choose **Azalea-managed models** in the grouped voice setup control in the
**Voice** section of Config, which the first-launch button opens directly. The
**Manage models** list below it shows the required CPU ONNX Runtime and Open JTalk system dictionary, then lists
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
`schema_version`. Projects are saved with schema version `2`; version `1`
files (Azalea 0.3.0) are migrated when they load.

Every text block and preset has a persistent ID, with text blocks referencing
presets independently of their display order. Each preset records its speaker
UUID and style name so changed numeric style IDs can be remapped safely.
Version `2` stores every block's `AudioQuery`, so a reopened project keeps the
readings it was saved with even if the user dictionary changed since; version
`1` stored only queries with manual accent, phoneme, pitch, or duration edits
(`query_override`) and regenerated the rest after loading. Version `2` also
stores post-processing edits.

Experimental pitch noise can be enabled in Config, with an adjustable sigma
(default `0.05`; `0` produces deterministic pitch). Each new text block gets
a random seed that is saved in the project and can be edited in the tuning
panel. Settings apply to future generation and pitch resets; manual edits
remain intact. This uses the fork's `generative-noise` core branch.

### Setup

```sh
git clone --recurse-submodules --shallow-submodules https://github.com/Patchethium/Azalea.git
cd Azalea
# for an existing clone: git submodule update --init
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

### Updating WORLD

The WORLD vocoder used by the Post tab is the `src-tauri/third_party/world`
git submodule, pinned to a commit of
[mmorise/World](https://github.com/mmorise/World). To move it to a newer
upstream commit:

```sh
# from the repository root; replace <commit> with the upstream commit hash
git -C src-tauri/third_party/world fetch --depth 1 origin <commit>
git -C src-tauri/third_party/world checkout <commit>
git add src-tauri/third_party/world
git commit -m "chore: update WORLD to <commit>"
```

Run the Rust tests afterwards, since `build.rs` compiles the new sources.

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
- [e2k](https://github.com/Patchethium/e2k), whose embedded models are trained on
  Wiktionary and JMdict/EDICT (CC BY-SA), UniDic (GPLv2/LGPLv2.1/BSD) and
  CMUdict (BSD-2-Clause)

## About the name

I use flower names for my side projects.

Azalea<sup>[Wikipedia](https://en.wikipedia.org/wiki/Azalea)</sup> is a flower that blooms in spring, the flowers often last several weeks. Shade tolerant, they prefer living near or under trees.

<p><a href="https://commons.wikimedia.org/wiki/File:Azalea,_a_member_of_the_genus_Rhododendron.jpg#/media/File:Azalea,_a_member_of_the_genus_Rhododendron.jpg"><img src="https://upload.wikimedia.org/wikipedia/commons/1/17/Azalea%2C_a_member_of_the_genus_Rhododendron.jpg" alt="Flowers"></a><br>By <a href="//commons.wikimedia.org/wiki/User:Jim_Evans" title="User:Jim Evans">Jim Evans</a> - <span class="int-own-work" lang="en">Own work</span>, <a href="https://creativecommons.org/licenses/by-sa/4.0" title="Creative Commons Attribution-Share Alike 4.0">CC BY-SA 4.0</a>, <a href="https://commons.wikimedia.org/w/index.php?curid=56492422">Link</a></p>
