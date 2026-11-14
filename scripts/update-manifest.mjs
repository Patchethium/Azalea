// Checks the updater manifest (`latest.json`) of a release before it is
// published: installed copies of Azalea trust it to find their update.
//
//   node scripts/update-manifest.mjs <latest.json> <version>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Every installation the publish workflow builds, by updater target. */
export const REQUIRED_PLATFORMS = [
  "darwin-aarch64",
  "darwin-aarch64-app",
  "linux-x86_64",
  "linux-x86_64-appimage",
  "linux-x86_64-deb",
  "linux-x86_64-rpm",
  "windows-x86_64",
  "windows-x86_64-msi",
  "windows-x86_64-nsis",
];

const decode = (text) => Buffer.from(text, "base64");

/** The ID of the key pair a minisign public key or signature line belongs to. */
const keyId = (line) => decode(line).subarray(2, 10).toString("hex");

/**
 * Returns what is wrong with `manifest` as the update to `version`, signed
 * by the key pair of `publicKey` (the `pubkey` of `tauri.conf.json`).
 */
export function manifestProblems(manifest, version, publicKey) {
  const problems = [];
  if (manifest?.version !== version)
    problems.push(`version is ${manifest?.version}, expected ${version}`);
  const expectedKey = keyId(decode(publicKey).toString().split("\n")[1] ?? "");
  const downloads = `https://github.com/Patchethium/Azalea/releases/download/app-v${version}/`;
  for (const platform of REQUIRED_PLATFORMS) {
    const entry = manifest?.platforms?.[platform];
    if (typeof entry?.url !== "string" || typeof entry?.signature !== "string") {
      problems.push(`${platform}: missing`);
      continue;
    }
    if (!entry.url.startsWith(downloads))
      problems.push(`${platform}: ${entry.url} is not a download of this release`);
    const [, signature = "", comment = ""] = decode(entry.signature)
      .toString()
      .split("\n");
    if (keyId(signature) !== expectedKey)
      problems.push(`${platform}: not signed by the key of tauri.conf.json`);
    // `requireSignedVersion` makes Azalea reject a signature without it.
    if (!comment.split("\t").includes(`version:${version}`))
      problems.push(`${platform}: the signature is not bound to version ${version}`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [path, version] = process.argv.slice(2);
  if (!path || !version) {
    console.error("Usage: node scripts/update-manifest.mjs <latest.json> <version>");
    process.exit(2);
  }
  const config = JSON.parse(
    readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url)),
  );
  const problems = manifestProblems(
    JSON.parse(readFileSync(path)),
    version,
    config.plugins.updater.pubkey,
  );
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log(`The update manifest of ${version} is complete.`);
}
