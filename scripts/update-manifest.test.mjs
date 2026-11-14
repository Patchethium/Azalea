import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { manifestProblems, REQUIRED_PLATFORMS } from "./update-manifest.mjs";

// A throwaway key pair and a package it signed for version 9.9.9.
const fixture = (name) =>
  readFileSync(
    new URL(`../src-tauri/src/commands/update_fixtures/${name}`, import.meta.url),
    "utf8",
  ).trim();
const publicKey = fixture("test.key.pub");
const signature = fixture("package.bin.sig");
const releaseKey = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url)),
).plugins.updater.pubkey;

const manifest = (version = "9.9.9") => ({
  version,
  platforms: Object.fromEntries(
    REQUIRED_PLATFORMS.map((platform) => [
      platform,
      {
        signature,
        url: `https://github.com/Patchethium/Azalea/releases/download/app-v${version}/${platform}`,
      },
    ]),
  ),
});

test("accepts a manifest with every platform signed for its version", () => {
  assert.deepEqual(manifestProblems(manifest(), "9.9.9", publicKey), []);
});

test("reports a wrong version and signatures bound to another one", () => {
  const problems = manifestProblems(manifest("9.9.9"), "10.0.0", publicKey);
  assert.ok(problems.includes("version is 9.9.9, expected 10.0.0"));
  assert.ok(
    problems.includes(
      "linux-x86_64-deb: the signature is not bound to version 10.0.0",
    ),
  );
  assert.ok(problems.some((problem) => problem.includes("is not a download")));
});

test("reports missing platforms, such as a build that lost an upload race", () => {
  const incomplete = manifest();
  delete incomplete.platforms["windows-x86_64-nsis"];
  incomplete.platforms["darwin-aarch64"] = { url: 1 };
  assert.deepEqual(manifestProblems(incomplete, "9.9.9", publicKey), [
    "darwin-aarch64: missing",
    "windows-x86_64-nsis: missing",
  ]);
  assert.equal(
    manifestProblems(null, "9.9.9", publicKey).length,
    REQUIRED_PLATFORMS.length + 1,
  );
});

test("reports packages signed with a key other than the configured one", () => {
  const problems = manifestProblems(manifest(), "9.9.9", releaseKey);
  assert.equal(problems.length, REQUIRED_PLATFORMS.length);
  assert.ok(
    problems.every((problem) =>
      problem.endsWith("not signed by the key of tauri.conf.json"),
    ),
  );
  assert.equal(
    manifestProblems(manifest(), "9.9.9", "bm90IGEga2V5").length,
    REQUIRED_PLATFORMS.length,
  );
});

test("reports release downloads that are not this release's", () => {
  const elsewhere = manifest();
  elsewhere.platforms["linux-x86_64"].url =
    "https://github.com/Patchethium/Azalea/releases/download/app-v9.9.8/azalea.AppImage";
  assert.deepEqual(manifestProblems(elsewhere, "9.9.9", publicKey), [
    "linux-x86_64: https://github.com/Patchethium/Azalea/releases/download/app-v9.9.8/azalea.AppImage is not a download of this release",
  ]);
});
