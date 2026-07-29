#!/usr/bin/env python3
"""Generate latest.json for Tauri auto-updater from built artifacts."""
import glob
import json
import os
import sys
from datetime import datetime, timezone

tag = os.environ.get("GITHUB_REF_NAME", "")
if not tag.startswith("v"):
    print(f"ERROR: GITHUB_REF_NAME={tag!r} must start with 'v'", file=sys.stderr)
    sys.exit(1)

version = tag.lstrip("v")
repo = os.environ["GITHUB_REPOSITORY"]
base_url = f"https://github.com/{repo}/releases/download/{tag}"

def find_artifact(pattern):
    matches = glob.glob(f"artifacts/**/{pattern}", recursive=True)
    return matches[0] if matches else None

def read_sig(path):
    sig_path = path + ".sig"
    if os.path.exists(sig_path):
        return open(sig_path).read().strip()
    return ""

platforms = {}

linux_app = find_artifact("*.AppImage")
if linux_app:
    platforms["linux-x86_64"] = {
        "signature": read_sig(linux_app),
        "url": f"{base_url}/{os.path.basename(linux_app)}",
    }

macos_x64 = find_artifact("*_x64.dmg")
if macos_x64:
    platforms["darwin-x86_64"] = {
        "signature": read_sig(macos_x64),
        "url": f"{base_url}/{os.path.basename(macos_x64)}",
    }

macos_arm = find_artifact("*_aarch64.dmg")
if macos_arm:
    platforms["darwin-aarch64"] = {
        "signature": read_sig(macos_arm),
        "url": f"{base_url}/{os.path.basename(macos_arm)}",
    }

win_exe = find_artifact("*-setup.exe")
if win_exe:
    platforms["windows-x86_64"] = {
        "signature": read_sig(win_exe),
        "url": f"{base_url}/{os.path.basename(win_exe)}",
    }

if not platforms:
    print("ERROR: no artifacts found in ./artifacts/", file=sys.stderr)
    sys.exit(1)

manifest = {
    "version": version,
    "notes": f"https://github.com/{repo}/releases/tag/{tag}",
    "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": platforms,
}

print(json.dumps(manifest, indent=2))