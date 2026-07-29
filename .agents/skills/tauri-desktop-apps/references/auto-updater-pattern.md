# Auto-Updater Pattern for Tauri 2

## Complete Setup

### Step 1: Generate Signing Key

```bash
# Generate key pair
npx tauri signer generate -p my-password

# Output:
# - Private key saved to ~/.tauri/my-app.key
# - Public key: RWRGSiy... (use in tauri.conf.json)
```

### Step 2: tauri.conf.json

```json
{
  "plugins": {
    "updater": {
      "pubkey": "RWRGSiyCnCULFan9LJpL8w8i3DffC7x3OWg+Tblwst1ehHCK48SZ1AQt",
      "endpoints": [
        "https://github.com/OWNER/REPO/releases/latest/download/latest.json"
      ]
    }
  }
}
```

### Step 3: Cargo.toml

```toml
[dependencies]
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

### Step 4: Register Plugins

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .run(tauri::generate_context!())
        .expect("error");
}
```

### Step 5: npm Install

```bash
npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

### Step 6: Permissions

```json
// src-tauri/capabilities/default.json
{
  "permissions": [
    "updater:default",
    "process:default",
    "process:allow-restart"
  ]
}
```

## Frontend: Check & Install Updates

```typescript
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export async function checkForUpdates(onProgress?: (pct: number) => void) {
  try {
    const update = await check();
    if (!update) {
      return { available: false };
    }

    console.log(`Update available: ${update.version}`);
    console.log(`Release notes: ${update.body}`);

    let downloaded = 0;
    let contentLength = 0;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength ?? 0;
          console.log(`Downloading ${contentLength} bytes`);
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            const pct = Math.round((downloaded / contentLength) * 100);
            onProgress?.(pct);
          }
          break;
        case 'Finished':
          console.log('Download complete');
          break;
      }
    });

    // Relaunch app to apply update
    await relaunch();

    return { available: true, version: update.version };
  } catch (err) {
    console.error('Update check failed:', err);
    return { available: false, error: String(err) };
  }
}

// Auto-check on startup
export function autoCheckUpdates() {
  checkForUpdates().then((result) => {
    if (result.available) {
      // Will auto-relaunch
    }
  });
}
```

## Update Manifest (latest.json)

### Python Generator Script

```python
#!/usr/bin/env python3
"""Generate latest.json for Tauri auto-updater."""
import json
import sys
import subprocess
import hashlib
from pathlib import Path

def get_signature(filepath: str, key_path: str) -> str:
    """Get file signature using tauri signer."""
    result = subprocess.run(
        ["npx", "tauri", "signer", "sign", "-p", key_path, filepath],
        capture_output=True, text=True
    )
    return result.stdout.strip()

def generate_manifest(tag: str, key_path: str):
    manifest = {
        "version": tag.lstrip("v"),
        "notes": f"Release {tag}",
        "pub_date": subprocess.run(
            ["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"],
            capture_output=True, text=True
        ).stdout.strip(),
        "platforms": {}
    }

    for platform, (arch, target) in {
        "linux-x86_64": ("amd64", "x86_64-unknown-linux-gnu"),
        "darwin-x86_64": ("amd64", "x86_64-apple-darwin"),
        "darwin-aarch64": ("aarch64", "aarch64-apple-darwin"),
        "windows-x86_64": ("x64", "x86_64-pc-windows-msvc"),
    }.items():
        for ext in (".AppImage.tar.gz", ".dmg", ".exe", ".msi"):
            filename = f"my-app_{tag.lstrip('v')}_{arch}{ext}"
            filepath = f"src-tauri/target/release/bundle/{filename}"
            if Path(filepath).exists():
                sig = get_signature(filepath, key_path)
                manifest["platforms"][platform] = {
                    "signature": sig,
                    "url": f"https://github.com/OWNER/REPO/releases/download/{tag}/{filename}"
                }
                break

    print(json.dumps(manifest, indent=2))

if __name__ == "__main__":
    generate_manifest(sys.argv[1], sys.argv[2])
```

### CI: Generate Manifest in GitHub Actions

```yaml
# .github/workflows/release.yml
- name: Generate update manifest
  run: |
    python scripts/generate-update-manifest.py ${{ github.ref_name }} key-password
  env:
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}

- name: Upload manifest
  uses: softprops/action-gh-release@v1
  with:
    files: |
      src-tauri/target/release/bundle/**/*
      latest.json
```

## Version Bump Pattern

```bash
# Update version in Cargo.toml and tauri.conf.json
# Both must match!

# Cargo.toml
# [package]
# version = "0.2.1"

# tauri.conf.json
# "version": "0.2.1"

# Tag and push
git tag v0.2.1
git push origin v0.2.1
# Triggers release workflow → build → GitHub Release → latest.json
```

## Manual Update Check Button

```tsx
// src/components/UpdateBanner.tsx
import { useState } from 'react';
import { checkForUpdates } from '../lib/updater';

export function UpdateBanner() {
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(-1);
  const [message, setMessage] = useState('');

  const handleCheck = async () => {
    setChecking(true);
    setMessage('');
    setProgress(-1);

    const result = await checkForUpdates((pct) => setProgress(pct));

    if (result.available) {
      setMessage(`Updating to v${result.version}...`);
    } else if (result.error) {
      setMessage(`Update check failed: ${result.error}`);
    } else {
      setMessage('App is up to date!');
    }

    setChecking(false);
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-bg2 rounded-lg">
      <button
        className="btn-primary text-sm"
        onClick={handleCheck}
        disabled={checking}
      >
        {checking ? 'Checking...' : 'Check for Updates'}
      </button>
      {progress >= 0 && (
        <div className="flex-1">
          <div className="h-2 bg-bg3 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
      {message && <span className="text-ink-dim text-sm">{message}</span>}
    </div>
  );
}
```

## Pitfalls

| Problem | Fix |
|---------|-----|
| `latest.json` not uploaded | Ensure step uploads it in CI workflow |
| Signature mismatch | Same key used for signing and pubkey in config |
| Version mismatch | Both `Cargo.toml` and `tauri.conf.json` must have same version |
| Update downloads but doesn't install | Ensure `tauri-plugin-process` registered for `relaunch()` |
| macOS notarization fails | Add Apple Developer credentials to CI secrets |
| Downgrade not supported | Tauri only installs newer versions |
| Antivirus blocks update | Code signing required for Windows SmartScreen |
