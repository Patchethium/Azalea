import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  cachedReport,
  fingerprint,
  frontendLicenses,
  mergeLicenses,
  rustLicenses,
} from "./licenses.mjs";

const license = (overrides = {}) => ({
  id: "MIT",
  name: "MIT License",
  text: "Copyright A\r\nPermission…",
  packages: [{ name: "a", version: "1" }],
  ...overrides,
});

test("preserves full texts and copyright variants, deduplicates and sorts deterministically", () => {
  const entries = [
    license(),
    license({ packages: [{ name: "b", version: "2" }] }),
    license(),
    license({ text: "Copyright B\nPermission…" }),
  ];
  const report = mergeLicenses(entries);
  assert.deepEqual(report, mergeLicenses([...entries].reverse()));
  assert.equal(report.length, 2);
  assert.equal(report[0].text, "Copyright A\nPermission…");
  assert.deepEqual(report[0].packages, [
    { name: "a", version: "1" },
    { name: "b", version: "2" },
  ]);
  assert.throws(() => mergeLicenses([license({ text: " " })]), /Incomplete/);
  assert.throws(
    () => mergeLicenses([license({ packages: [{ name: "a" }] })]),
    /metadata/,
  );
  assert.throws(() => mergeLicenses([license({ packages: [] })]), /Incomplete/);
});

test("normalizes cargo-about without leaking source paths", () => {
  const entries = rustLicenses({
    licenses: [
      {
        id: "MIT",
        name: "MIT License",
        text: "full text",
        source_path: "/private/path",
        used_by: [
          {
            crate: {
              name: "crate",
              version: "1",
              manifest_path: "/private/path",
            },
          },
        ],
      },
    ],
  });
  assert.deepEqual(entries, [
    license({ text: "full text", packages: [{ name: "crate", version: "1" }] }),
  ]);
  assert.throws(() => rustLicenses({ licenses: [] }), /no license texts/);
  assert.throws(() => rustLicenses({}), /no license texts/);
});

test("collects frontend license and notice files using the installed package's version", () => {
  const files = {
    [join("pkg", "package.json")]: JSON.stringify({
      name: "frontend",
      version: "2",
    }),
    [join("pkg", "LICENSE")]: "Copyright frontend\nFull license",
    [join("pkg", "NOTICE.txt")]: "Full notice",
  };
  const result = frontendLicenses(
    { MIT: [{ name: "frontend", versions: ["1", "2"], paths: ["pkg"] }] },
    (path) => files[path],
    () => ["README.md", "NOTICE.txt", "LICENSE"],
  );
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].text, files[join("pkg", "LICENSE")]);
  assert.equal(result.entries[1].text, "Full notice");
  assert.deepEqual(result.entries[0].packages, [
    { name: "frontend", version: "2" },
  ]);
  assert.equal(result.inputs.length, 3);
  assert.throws(() => frontendLicenses({ UNKNOWN: [] }), /Unresolved/);
  assert.throws(
    () => frontendLicenses({ MIT: [{ name: "missing" }] }),
    /No installed path/,
  );
  assert.throws(
    () =>
      frontendLicenses(
        { MIT: [{ name: "frontend", paths: ["pkg"] }] },
        (path) => files[path],
        () => ["NOTICE"],
      ),
    /No license text/,
  );
  assert.throws(() => frontendLicenses({}), /No production frontend licenses/);
});

test("SPDX-only Tauri packages use the exact Rust counterpart's full notice", () => {
  const inventory = {
    "MIT OR Apache-2.0": [
      { name: "@tauri-apps/plugin-dialog", paths: ["plugin"] },
    ],
  };
  const read = (path) =>
    path.endsWith("package.json")
      ? JSON.stringify({ name: "@tauri-apps/plugin-dialog", version: "2.8.3" })
      : "PackageCopyrightText: 2019-2022 Tauri";
  const list = () => ["LICENSE.spdx"];
  const rust = [
    license({ packages: [{ name: "tauri-plugin-dialog", version: "2.8.3" }] }),
  ];
  const result = frontendLicenses(inventory, read, list, rust);
  assert.equal(result.entries[0].text, rust[0].text);
  assert.deepEqual(result.entries[0].packages, [
    { name: "@tauri-apps/plugin-dialog", version: "2.8.3" },
  ]);
  assert.equal(result.entries[1].text, "PackageCopyrightText: 2019-2022 Tauri");
  assert.throws(
    () =>
      frontendLicenses(inventory, read, list, [
        license({
          packages: [{ name: "tauri-plugin-dialog", version: "2.0.0" }],
        }),
      ]),
    /No license text/,
  );
});

test("cache detects changed inputs, missing files, malformed metadata, and report corruption", () => {
  const dir = mkdtempSync(join(tmpdir(), "azalea-licenses-"));
  try {
    const input = join(dir, "input");
    const extra = join(dir, "LICENSE");
    const report = join(dir, "report.json");
    const cache = join(dir, "cache.json");
    writeFileSync(input, "manifest");
    writeFileSync(extra, "copyright");
    writeFileSync(report, "[]");
    const saveCache = () =>
      writeFileSync(
        cache,
        JSON.stringify({
          inputs: [extra],
          fingerprint: fingerprint([input, extra]),
          reportHash: createHash("sha256")
            .update(readFileSync(report))
            .digest("hex"),
        }),
      );
    assert.equal(cachedReport(report, cache, [input]), null);
    saveCache();
    assert.deepEqual(cachedReport(report, cache, [input]), [input, extra]);
    writeFileSync(extra, "new copyright");
    assert.equal(cachedReport(report, cache, [input]), null);
    saveCache();
    writeFileSync(report, "broken");
    assert.equal(cachedReport(report, cache, [input]), null);
    saveCache();
    writeFileSync(input, "changed lockfile");
    assert.equal(cachedReport(report, cache, [input]), null);
    writeFileSync(cache, "bad json");
    assert.equal(cachedReport(report, cache, [input]), null);
    rmSync(extra);
    assert.equal(cachedReport(report, cache, [input]), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing cargo-about fails with installation instructions and writes no report", () => {
  const dir = mkdtempSync(join(tmpdir(), "azalea-licenses-"));
  try {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./licenses.mjs", import.meta.url)), dir],
      {
        encoding: "utf8",
        env: { ...process.env, CARGO_ABOUT: join(dir, "absent-cargo-about") },
      },
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /cargo install cargo-about --locked --version 0.9.2/,
    );
    assert.throws(
      () => readFileSync(join(dir, "dependency-licenses.json")),
      /ENOENT/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
