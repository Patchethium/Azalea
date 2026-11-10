# Azalea

**Azalea**（アザレア）is an unofficial desktop GUI for
[VOICEVOX](https://github.com/VOICEVOX/voicevox), focused on Japanese
text-to-speech and voice presets. It uses the Rust VOICEVOX Core directly,
without running `voicevox_engine`.

[English](#features) · [日本語](#日本語)

> [!WARNING]
> This project is in heavy development; breaking changes are expected.
> 
> このプロジェクトは開発中です。大きく変動する可能性があります。

## Features

- **Partial model selection.** Reuse an existing VOICEVOX installation, or
  download only the voice packages you need from inside Azalea.
- **Preset-focused workflow.** Text blocks are organized around presets, a
  different approach from VOICEVOX.
- **Pitch variations.** Discover alternative intonations with seeded noise in
  pitch prediction.
- **Post tuning.** Extra fine-grained control over pitch and duration (may
  reduce audio quality).
- **MCP server.** Use your voices from LLM clients. See
  [Using Azalea from MCP clients](#using-azalea-from-mcp-clients).

## Quickstart

1. Install a build for Windows, macOS (Apple Silicon) or Linux from
   [Releases](https://github.com/Patchethium/Azalea/releases). On Windows,
   install the
   [Microsoft Visual C++ Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe)
   first if Azalea reports that `MSVCP140.dll` or `VCRUNTIME140.dll` is missing.
2. Launch Azalea, select **Open config**, and in **Voice → Voice setup** choose
   one of:
   - **Azalea-managed models:** review the model terms, pick voice packages
     under **Manage models**, download them, then select **Apply models**. The
     runtime and dictionary are downloaded automatically.
   - **VOICEVOX:** select **Choose...** and pick the `vv-engine` directory of
     your VOICEVOX installation.
3. Close config and start typing.

Azalea looks for a newer release when it starts and offers to download and
install it; **Interface → Updates** in config turns the check off or runs it
on demand. Installations from the `.deb` or `.rpm` package are pointed to the
release page instead of updating themselves.

## Using Azalea from MCP clients

Azalea can run as a local [MCP](https://modelcontextprotocol.io) server over
stdio. It is experimental, incomplete and off by default.

1. Set up voices in Azalea as described above.
2. In config's **Synthesis** section, turn on **MCP Server** and copy the
   **Launch command** shown below it.
3. Add the command to your client, for example Claude Code:

   ```sh
   claude mcp add azalea -- /path/to/azalea --mcp
   ```

   or Claude Desktop's `claude_desktop_config.json`:

   ```json
   {
     "mcpServers": {
       "azalea": { "command": "/path/to/azalea", "args": ["--mcp"] }
     }
   }
   ```

The client starts its own windowless Azalea process with your config. Tools:

- `list_speakers`: installed speakers and their styles.
- `synthesize`: reads text with a speaker and style, or a preset, and returns
  the path of a WAV file.
- `create_preset` / `list_presets`: MCP-only presets, separate from the app's.

## 日本語

Azalea（アザレア）は、VOICEVOX向けの非公式デスクトップGUIです。
`voicevox_engine`を起動せず、Rust版VOICEVOX Coreを直接利用します。

### 主な機能

- **必要なモデルだけ導入：** インストール済みのVOICEVOXを使うか、必要な音声モデルだけを
  アプリ内でダウンロードできます。
- **プリセット中心の操作：** テキストブロックをプリセット単位で管理します。
- **音高のバリエーション：** シード付きノイズで音高予測に変化を加え、別の抑揚を探せます。
- **ポスト調整：** 音高と長さをさらに細かく調整できます（音質が低下する場合があります）。
- **MCPサーバー：** ClaudeなどのLLMクライアントから音声を合成できます。

### はじめ方

1. [Releases](https://github.com/Patchethium/Azalea/releases)から、お使いの環境
   （Windows・macOS Apple Silicon・Linux）向けのビルドをインストールします。
   Windowsで`MSVCP140.dll`や`VCRUNTIME140.dll`が見つからないと表示される場合は、
   [Microsoft Visual C++ 再頒布可能パッケージ](https://aka.ms/vs/17/release/vc_redist.x64.exe)
   をインストールしてください。
2. 起動時の画面で**設定を開く**を押し、**音声 → 音声環境**で次のいずれかを選びます。
   - **Azalea管理のモデル：** 利用規約を確認し、**モデル管理**で必要なモデルを
     ダウンロードして**モデルを適用**を押します。ランタイムと辞書は自動で取得されます。
   - **VOICEVOX：** **選択**...から、VOICEVOXの`vv-engine`フォルダーを選びます。
3. 設定を閉じれば準備完了です。

起動時に新しいリリースを確認し、ダウンロードとインストールを案内します。設定の
**インターフェース → アップデート**で確認を無効にしたり、手動で確認したりできます。`.deb`・
`.rpm`パッケージからインストールした場合は、自動更新の代わりにリリースページを
案内します。

MCPサーバーは設定の「合成」で「MCPサーバー」を有効にし、表示される起動コマンドを
クライアントに追加してください（[英語の手順](#using-azalea-from-mcp-clients)）。

## Development

### Prerequisites

- [Rust](https://rustup.rs), [pnpm](https://pnpm.io) and Node.js 22+
- [cargo-about](https://github.com/EmbarkStudios/cargo-about) 0.9.2:
  `cargo install cargo-about --locked --version 0.9.2 --features cli`
- [Tauri prerequisites](https://tauri.app/start/prerequisites/); on Linux also
  [mold](https://github.com/rui314/mold) and clang

### Setup

```sh
git clone --recurse-submodules --shallow-submodules https://github.com/Patchethium/Azalea.git
cd Azalea              # in an existing clone: git submodule update --init
pnpm install --frozen-lockfile
pnpm tauri dev         # development build
pnpm tauri build       # production build
```

Run `pnpm install` before building Rust: `build.rs` collects the license texts
shown in the app's **Licenses** dialog.

Development builds keep their config and downloads in `config_dev/`; set the
core there from the app. Release builds use
`{config_dir}/com.azalea.app/config.toml`.

### Setting up a core manually

Besides the in-app download or a VOICEVOX installation, you can use the
[official downloader](https://github.com/VOICEVOX/voicevox_core?tab=readme-ov-file#%E7%92%B0%E5%A2%83%E6%A7%8B%E7%AF%89),
or extract a [VOICEVOX Core release](https://github.com/VOICEVOX/voicevox_core/releases)
and the [OpenJTalk dictionary](https://jaist.dl.sourceforge.net/project/open-jtalk/Dictionary/open_jtalk_dic-1.11/open_jtalk_dic_utf_8-1.11.tar.gz)
into one directory. Azalea searches it up to 8 levels deep for the ONNX Runtime
library, the `*.vvm` models and `open_jtalk_dic_utf_8-1.11/`.

### Testing

```sh
pnpm check             # Biome lint and format
pnpm test:all          # frontend checks, build, coverage and all Rust tests
cd src-tauri
cargo fmt --check
cargo test --locked -- --test-threads=1
```

The Rust suite runs the real VOICEVOX Core from `config_dev/config.toml`, or
from `AZALEA_TEST_CORE_DIR` if set, and fails without one.

### Maintenance

- **Pitch ranges:** after updating the core, regenerate
  `src-tauri/src/assets/range.json` with `cargo run --example range` in
  `src-tauri`.
- **WORLD:** the vocoder is the `src-tauri/third_party/world` submodule. Check
  out a newer commit there and commit the pointer.
- **Release builds:** the GitHub Actions workflows in `.github/workflows/` are
  triggered manually; run them from the Actions tab of your fork.

### Releasing

Installed copies update themselves from the latest published GitHub release,
so a release needs signed updater packages:

1. Bump `version` in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and
   `package.json`.
2. Run the **publish** workflow. It builds every platform with
   `src-tauri/tauri.release.conf.json`, signs the updater packages, uploads
   them with their manifest (`latest.json`) to a draft release, and fails if
   the manifest is incomplete or signed with the wrong key.
3. Edit the draft's notes and publish it. Installed copies find it from then
   on; prereleases and drafts are never offered.

The workflow signs with the `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets; the matching public
key is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. Keep the
private key and its password backed up: without them, installed copies cannot
be updated in place. To release a fork, generate your own pair with
`pnpm tauri signer generate`, set both secrets, and replace the public key and
the `endpoints` URL in `tauri.conf.json`.

Local `pnpm tauri build` needs no key and creates no updater packages.
Development builds do not look for updates unless
`AZALEA_DEV_UPDATE_ENDPOINT` points at a test manifest, and never install one.

## Contributing

PRs are welcome, but please open an issue first: in this early stage I often
force-push.

I read and write Mandarin Chinese, Japanese and English; feel free to reach out
in any of them.

## License

[GPLv3](LICENSE) or later.

## Credits

Azalea relies on:

- [VOICEVOX](https://github.com/VOICEVOX/voicevox)
- [Tauri](https://github.com/tauri-apps/tauri)
- [SolidJS](https://github.com/solidjs/solid)
- [UnoCSS](https://unocss.dev/)
- [Kobalte](https://kobalte.dev/)
- [WORLD](https://github.com/mmorise/World)
- [e2k](https://github.com/Patchethium/e2k)

And so on. Check `third party licence` in app for more detailed license information.

## About the name

I use flower names for my side projects.

Azalea<sup>[Wikipedia](https://en.wikipedia.org/wiki/Azalea)</sup> is a flower that blooms in spring, the flowers often last several weeks. Shade tolerant, they prefer living near or under trees.

<p><a href="https://commons.wikimedia.org/wiki/File:Azalea,_a_member_of_the_genus_Rhododendron.jpg#/media/File:Azalea,_a_member_of_the_genus_Rhododendron.jpg"><img src="https://upload.wikimedia.org/wikipedia/commons/1/17/Azalea%2C_a_member_of_the_genus_Rhododendron.jpg" alt="Flowers"></a><br>By <a href="//commons.wikimedia.org/wiki/User:Jim_Evans" title="User:Jim Evans">Jim Evans</a> - <span class="int-own-work" lang="en">Own work</span>, <a href="https://creativecommons.org/licenses/by-sa/4.0" title="Creative Commons Attribution-Share Alike 4.0">CC BY-SA 4.0</a>, <a href="https://commons.wikimedia.org/w/index.php?curid=56492422">Link</a></p>
