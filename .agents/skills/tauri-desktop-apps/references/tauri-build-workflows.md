# Tauri Build Workflow — Tested Patterns

## Working build.yml (Windows)

```yaml
name: Build
on: workflow_dispatch

jobs:
  build:
    runs-on: windows-latest
    steps:
      - name: Debug Startup
        run: |
          echo "Runner is alive"
          node -v

      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22.x

      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2

      - name: Install FFmpeg
        run: choco install ffmpeg -y

      - run: npm ci
      - run: npm run build

      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: app-v${{ github.run_number }}
          releaseName: 'App Build ${{ github.run_number }}'
          releaseBody: 'Automated build'
          releaseDraft: true
          prerelease: false
          args: '--bundles nsis,msi'
```

## Working release.yml (Tagged releases)

```yaml
name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: write

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - name: Install FFmpeg
        run: choco install ffmpeg -y
      - run: npm ci
      - run: npm run build
      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'App ${{ github.ref_name }}'
          releaseDraft: false
          prerelease: false
```

## Key decisions made

- **FFmpeg**: `choco install ffmpeg -y` (reliable) vs `FedericoCarboni/setup-ffmpeg@v3` (fails with "Cannot get latest release")
- **tauri-action version**: `@v1` (not `@v0` which doesn't exist, not `@latest`)
- **releaseDraft**: Always set explicitly; `true` = draft (not visible), `false` = published
- **tagName**: Use `${{ github.run_number }}` for build workflow, `${{ github.ref_name }}` for release workflow
- **Artifacts**: Let tauri-action handle them; don't try to find/move them manually
