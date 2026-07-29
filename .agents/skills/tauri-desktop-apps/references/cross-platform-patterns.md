# Cross-Platform Build Patterns — Tauri 2 (Mac / Windows / Linux)

## Architecture Decision: Single Codebase, Platform-Specific Bundles

Tauri 2 compiles the SAME Rust + React codebase to all 3 platforms. Platform differences are ONLY in:
1. Bundle format (dmg vs exe vs AppImage/deb)
2. Code signing / notarization
3. System dependencies (WebView2 on Windows, webkit2gtk on Linux)
4. CI/CD runner configuration

## Platform Requirements

### Windows
- **Runner**: `windows-latest`
- **Bundle**: NSIS (.exe installer) + MSI
- **WebView**: Edge WebView2 (pre-installed on Windows 10/11)
- **Dependencies**: MSVC build tools (comes with runner), Rust MSVC target
- **Code signing**: Optional (SmartScreen warning without it)

### macOS
- **Runner**: `macos-latest` (Intel) or `macos-latest` (Apple Silicon)
- **Bundle**: .dmg
- **WebView**: WebKit (native, always available)
- **Universal binary**: Build x86_64 + aarch64 separately, combine with `lipo`
- **Code signing**: Required for distribution (Apple Developer account)
- **Notarization**: Required for macOS 10.15+ (Apple notary service)

### Linux
- **Runner**: `ubuntu-latest`
- **Bundle**: AppImage (portable) + .deb (Debian/Ubuntu) + .rpm (Fedora)
- **WebView**: webkit2gtk-4.1 (must be installed)
- **Dependencies**: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libappindicator3-dev`, `librsvg2-dev`

## GitHub Actions Matrix (All 3 Platforms)

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ['v*']
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            bundle_args: '--bundles nsis,msi'
          - os: macos-latest
            target: x86_64-apple-darwin
            bundle_args: '--bundles dmg'
          - os: ubuntu-22.04
            target: x86_64-unknown-linux-gnu
            bundle_args: '--bundles appimage,deb'

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'

      # ── Platform-specific dependencies ──

      - name: Install system deps (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libappindicator3-dev \
            librsvg2-dev \
            patchelf

      - name: Install FFmpeg (Windows)
        if: runner.os == 'Windows'
        run: choco install ffmpeg -y

      # macOS: no extra deps needed (WebKit is native)

      # ── Build ──

      - run: npm ci
      - run: npm run build

      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # macOS code signing (optional):
          # APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          # APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          # APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          # macOS notarization (optional):
          # APPLE_ID: ${{ secrets.APPLE_ID }}
          # APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          # APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'Release ${{ github.ref_name }}'
          releaseDraft: false
          prerelease: false
          args: ${{ matrix.bundle_args }}
```

## macOS — Universal Binary (Intel + Apple Silicon)

```yaml
# Separate jobs for each architecture
jobs:
  build-macos:
    strategy:
      matrix:
        include:
          - os: macos-latest  # Apple Silicon (M-series)
            target: aarch64-apple-darwin
          - os: macos-13      # Intel
            target: x86_64-apple-darwin
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: dtolnay/rust-toolchain@stable
        with: { targets: ${{ matrix.target }} }
      - uses: Swatinem/rust-cache@v2
      - run: npm ci && npm run build
      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          args: '--target ${{ matrix.target }} --bundles dmg'
      - uses: actions/upload-artifact@v4
        with:
          name: macos-${{ matrix.target }}
          path: src-tauri/target/release/bundle/dmg/*.dmg

  # Combine into universal binary
  universal:
    needs: build-macos
    runs-on: macos-latest
    steps:
      - uses: actions/download-artifact@v4
      - name: Create universal DMG
        run: |
          hdiutil attach macos-aarch64-apple-darwin/*.dmg -mountpoint /arm64
          hdiutil attach macos-x86_64-apple-darwin/*.dmg -mountpoint /x64
          # ... merge logic
```

## macOS — Code Signing + Notarization

### Prerequisites
1. Apple Developer account ($99/year)
2. Create "Application" certificate in Keychain Access
3. Create App ID in Apple Developer portal
4. Generate notarization password

### Required Secrets
```yaml
APPLE_CERTIFICATE: <base64-encoded .p12 certificate>
APPLE_CERTIFICATE_PASSWORD: <certificate password>
APPLE_SIGNING_IDENTITY: "Developer ID Application: Your Name (TEAMID)"
APPLE_ID: <your Apple ID email>
APPLE_PASSWORD: <app-specific password for notarization>
APPLE_TEAM_ID: <your 10-char team ID>
```

### tauri.conf.json for macOS
```json
{
  "bundle": {
    "macOS": {
      "minimumSystemVersion": "10.15",
      "signingIdentity": null,
      "entitlements": null
    }
  }
}
```

### Entitlements (for hardened runtime)
```xml
<!-- src-tauri/Entitlements.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
</dict>
</plist>
```

## Windows — NSIS + MSI

### tauri.conf.json
```json
{
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi"],
    "windows": {
      "nsis": {
        "installMode": "both",
        "displayLanguageSelector": true,
        "installerIcon": "icons/icon.ico"
      },
      "msi": {}
    }
  }
}
```

### Icon Requirements
- `src-tauri/icons/icon.ico` — 256x256 or multi-resolution
- `src-tauri/icons/icon.png` — 512x512 (for NSIS installer)

### WebView2
WebView2 is pre-installed on Windows 10 (20H2+) and Windows 11. For older systems:
```json
{
  "bundle": {
    "windows": {
      "webviewInstallMode": {
        "type": "downloadBootstrapper",
        "silent": true
      }
    }
  }
}
```

## Linux — AppImage + deb + rpm

### System Dependencies (Ubuntu/Debian)
```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

### System Dependencies (Fedora)
```bash
sudo dnf install -y \
  webkit2gtk4.1-devel \
  gtk3-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel
```

### tauri.conf.json
```json
{
  "bundle": {
    "linux": {
      "deb": {
        "depends": ["libwebkit2gtk-4.1-0", "libgtk-3-0"],
        "section": "utils"
      },
      "appimage": {
        "bundleMediaFramework": true
      }
    }
  }
}
```

### Wayland Support
```toml
# Cargo.toml
[dependencies]
tauri = { version = "2", features = ["linux-libxdo"] }
```

## Platform-Specific Code

### Conditional Compilation in Rust

```rust
#[cfg(target_os = "macos")]
fn platform_specific() {
    // macOS: NSBundle info, drag-to-install
}

#[cfg(target_os = "windows")]
fn platform_specific() {
    // Windows: Start menu shortcut, registry
}

#[cfg(target_os = "linux")]
fn platform_specific() {
    // Linux: .desktop file, freedesktop integration
}
```

### Platform Detection in Frontend

```typescript
import { platform } from '@tauri-apps/plugin-os';

const os = await platform(); // 'windows', 'macos', 'linux'

// Conditional UI
if (os === 'macos') {
  // Show traffic light buttons
} else if (os === 'windows') {
  // Show Windows-style title bar
} else {
  // Linux: GTK decorations
}
```

## CI/CD Decision Matrix

| Feature | Windows | macOS | Linux |
|---------|---------|-------|-------|
| Bundle formats | NSIS, MSI | DMG | AppImage, deb, rpm |
| Code signing | Optional (EV cert for SmartScreen) | Required for distribution | Not required |
| Notarization | N/A | Required (Apple notary) | N/A |
| WebView | Edge WebView2 (auto-installed) | WebKit (native) | webkit2gtk (apt install) |
| Universal binary | N/A | Yes (lipo x64+arm64) | N/A |
| Auto-updater | ✅ | ✅ | ✅ |
| System tray | ✅ | ✅ | ✅ |
| Deep linking | ✅ | ✅ | ✅ |

## Build Commands (Local)

```bash
# Development (all platforms)
cargo tauri dev

# Production build (all platforms)
cargo tauri build

# Specific bundle
cargo tauri build --bundles nsis     # Windows only
cargo tauri build --bundles dmg      # macOS only
cargo tauri build --bundles appimage # Linux only

# Cross-compile (requires target + toolchain)
cargo tauri build --target x86_64-apple-darwin   # From macOS
cargo tauri build --target aarch64-apple-darwin   # From macOS
cargo tauri build --target x86_64-pc-windows-msvc # From Windows
```

## Output Paths

| Platform | Output Directory |
|----------|-----------------|
| Windows | `src-tauri/target/release/bundle/nsis/` + `msi/` |
| macOS | `src-tauri/target/release/bundle/dmg/` |
| Linux | `src-tauri/target/release/bundle/appimage/` + `deb/` |

## Common Cross-Platform Pitfalls

| Problem | Platform | Fix |
|---------|----------|-----|
| `libwebkit2gtk-4.1-dev` not found | Linux | `sudo apt install libwebkit2gtk-4.1-dev` |
| WebView2 not installed | Windows (old) | Add `webviewInstallMode` to tauri.conf.json |
| DMG signature invalid | macOS | Use `APPLE_SIGNING_IDENTITY` secret |
| AppImage won't run on older glibc | Linux | Build on older Ubuntu (22.04) |
| MSI requires admin | Windows | Expected — MSI is system-wide install |
| NSIS path too long | Windows | Use short project name |
| `cargo tauri build` fails on Linux | Linux | Check all system deps installed |
| Icon not found | All | Ensure `src-tauri/icons/icon.ico` + `icon.png` exist |
