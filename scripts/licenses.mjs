import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export const cargoAboutVersion = "0.9.2";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.error?.message ?? result.stderr}`,
    );
  }
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout;
}

export function rustLicenses(report) {
  if (!Array.isArray(report.licenses) || !report.licenses.length) {
    throw new Error("cargo-about returned no license texts");
  }
  return report.licenses.map((license) => ({
    id: license.id,
    name: license.name,
    text: license.text,
    packages: license.used_by.map(({ crate: pkg }) => ({
      name: pkg.name,
      version: pkg.version,
    })),
  }));
}

export function frontendLicenses(
  inventory,
  read = readFileSync,
  list = readdirSync,
  rust = [],
) {
  const entries = [];
  const inputs = new Set();
  for (const [id, packages] of Object.entries(inventory)) {
    if (!id.trim() || /unknown|unlicensed/i.test(id))
      throw new Error(`Unresolved frontend license: ${id}`);
    for (const pkg of packages) {
      if (!pkg.paths?.length)
        throw new Error(
          `No installed path for ${pkg.name}; run pnpm install --frozen-lockfile`,
        );
      for (const path of pkg.paths) {
        const manifest = join(path, "package.json");
        const metadata = JSON.parse(read(manifest, "utf8"));
        inputs.add(manifest);
        const files = list(path)
          .filter((name) =>
            /^(licen[cs]e|copying|notice|copyright)([.-]|$)/i.test(name),
          )
          .sort(compare);
        if (
          !files.some(
            (name) =>
              /^(licen[cs]e|copying)([.-]|$)/i.test(name) &&
              !name.endsWith(".spdx"),
          )
        ) {
          // These npm packages publish SPDX metadata only. Their matching Rust
          // packages ship the same project's full notices. Require the exact
          // version so a future package update cannot silently reuse old terms.
          const counterpart = {
            "@tauri-apps/plugin-dialog": "tauri-plugin-dialog",
            "@tauri-apps/plugin-shell": "tauri-plugin-shell",
          }[metadata.name];
          const clarified =
            counterpart &&
            rust.filter((entry) =>
              entry.packages.some(
                (item) =>
                  item.name === counterpart &&
                  item.version === metadata.version,
              ),
            );
          if (!clarified?.length) {
            throw new Error(
              `No license text for ${pkg.name}@${metadata.version}; add a reviewed license clarification`,
            );
          }
          entries.push(
            ...clarified.map((entry) => ({
              ...entry,
              packages: [{ name: metadata.name, version: metadata.version }],
            })),
          );
        }
        for (const file of files) {
          const filename = join(path, file);
          inputs.add(filename);
          entries.push({
            id,
            name: id,
            text: read(filename, "utf8"),
            packages: [{ name: metadata.name, version: metadata.version }],
          });
        }
      }
    }
  }
  if (!entries.length)
    throw new Error(
      "No production frontend licenses found; run pnpm install --frozen-lockfile",
    );
  return { entries, inputs: [...inputs] };
}

export function mergeLicenses(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (
      ![entry.id, entry.name, entry.text].every(
        (value) => typeof value === "string" && value.trim(),
      ) ||
      !entry.packages?.length
    ) {
      throw new Error("Incomplete dependency license entry");
    }
    for (const pkg of entry.packages) {
      if (!pkg.name || !pkg.version)
        throw new Error("Incomplete dependency package metadata");
    }
    // Keep copyright variants separate; only line endings are normalized.
    const text = entry.text.replace(/\r\n/g, "\n");
    const key = `${entry.id}\0${text}`;
    const group = groups.get(key) ?? { ...entry, text, packages: [] };
    group.packages.push(...entry.packages);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((entry) => ({
      ...entry,
      packages: [
        ...new Map(
          entry.packages.map((pkg) => [`${pkg.name}\0${pkg.version}`, pkg]),
        ).values(),
      ].sort(
        (a, b) => compare(a.name, b.name) || compare(a.version, b.version),
      ),
    }))
    .sort((a, b) => compare(a.id, b.id) || compare(a.text, b.text));
}

export function fingerprint(inputs) {
  const digest = createHash("sha256");
  for (const path of [...new Set(inputs)].sort(compare)) {
    digest.update(path).update("\0").update(readFileSync(path)).update("\0");
  }
  return digest.digest("hex");
}

function atomicWrite(path, content) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, path);
}

export function cachedReport(reportPath, cachePath, baseInputs) {
  try {
    const cache = JSON.parse(readFileSync(cachePath, "utf8"));
    const inputs = [...baseInputs, ...cache.inputs];
    if (
      cache.fingerprint === fingerprint(inputs) &&
      cache.reportHash === hash(readFileSync(reportPath))
    )
      return inputs;
  } catch {
    /* A missing, invalid, or outdated report is regenerated. */
  }
  return null;
}

export function collectLicenses(outDir) {
  const reportPath = join(outDir, "dependency-licenses.json");
  const cachePath = join(outDir, "dependency-licenses-cache.json");
  const baseInputs = [
    "scripts/licenses.mjs",
    "src-tauri/build.rs",
    "src-tauri/about.toml",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "package.json",
    "pnpm-lock.yaml",
    "src-tauri/third_party/world/LICENSE.txt",
  ].map((path) => join(root, path));
  let inputs = cachedReport(reportPath, cachePath, baseInputs);
  if (!inputs) {
    const cargo = process.env.CARGO ?? "cargo";
    const command = process.env.CARGO_ABOUT ?? cargo;
    const prefix = process.env.CARGO_ABOUT ? [] : ["about"];
    let version;
    try {
      version = run(command, [...prefix, "--version"]);
    } catch (error) {
      throw new Error(
        `Install cargo-about first: cargo install cargo-about --locked --version ${cargoAboutVersion} --features cli\n${error.message}`,
      );
    }
    if (version.trim() !== `cargo-about ${cargoAboutVersion}`)
      throw new Error(
        `Expected cargo-about ${cargoAboutVersion}, found ${version.trim()}`,
      );
    const args = [
      ...prefix,
      "generate",
      "--locked",
      "--format",
      "json",
      "--fail",
      "--manifest-path",
      join(root, "src-tauri/Cargo.toml"),
    ];
    if (["true", "1"].includes(process.env.CARGO_NET_OFFLINE))
      args.push("--offline");
    const rust = rustLicenses(JSON.parse(run(command, args)));
    // cmd.exe is required to launch pnpm.cmd on Windows; the arguments are fixed.
    const npm =
      process.platform === "win32"
        ? run("cmd.exe", ["/d", "/s", "/c", "pnpm licenses list --prod --json"])
        : run("pnpm", ["licenses", "list", "--prod", "--json"]);
    const frontend = frontendLicenses(
      JSON.parse(npm),
      readFileSync,
      readdirSync,
      rust,
    );
    const world = {
      id: "BSD-3-Clause",
      name: "WORLD license",
      packages: [{ name: "WORLD", version: "vendored" }],
      text: readFileSync(
        join(root, "src-tauri/third_party/world/LICENSE.txt"),
        "utf8",
      ),
    };
    const licenses = mergeLicenses([...rust, ...frontend.entries, world]);
    inputs = [...baseInputs, ...frontend.inputs];
    const report = JSON.stringify(licenses);
    mkdirSync(outDir, { recursive: true });
    atomicWrite(reportPath, report);
    atomicWrite(
      cachePath,
      JSON.stringify({
        fingerprint: fingerprint(inputs),
        reportHash: hash(report),
        inputs: frontend.inputs,
      }),
    );
    process.stderr.write(
      `Collected ${licenses.length} license texts (${Buffer.byteLength(report)} bytes)\n`,
    );
  }
  for (const path of [...new Set([...inputs, reportPath, cachePath])])
    console.log(`cargo:rerun-if-changed=${path}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (!process.argv[2])
      throw new Error("Usage: node scripts/licenses.mjs <output-directory>");
    collectLicenses(resolve(process.argv[2]));
  } catch (error) {
    console.error(`License collection failed: ${error.message}`);
    process.exitCode = 1;
  }
}
