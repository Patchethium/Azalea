import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(root, "public/fonts");
const base =
  "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans";
const files = [
  [
    "NotoSansJP-VF.otf",
    `${base}/Variable/OTF/Subset/NotoSansJP-VF.otf`,
    "85e5ef353081175fb9f764f037c550dd4b5ad913cb030c0de98a5d4d4018014b",
  ],
  [
    "NotoSansSC-VF.otf",
    `${base}/Variable/OTF/Subset/NotoSansSC-VF.otf`,
    "d13ed01ec8aa45d6178999b648e96fb92150683e9f8e2a581f2acf208dcbe44b",
  ],
  [
    "LICENSE",
    "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/LICENSE",
    "6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2",
  ],
];
const hash = (data) => createHash("sha256").update(data).digest("hex");

await mkdir(outputDir, { recursive: true });
await Promise.all(
  files.map(async ([name, url, expectedHash]) => {
    const output = resolve(outputDir, name);
    if (
      await readFile(output)
        .then((data) => hash(data) === expectedHash)
        .catch(() => false)
    ) {
      return;
    }

    console.log(`Downloading ${name}...`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${name}: ${response.status}`);
    }

    const data = new Uint8Array(await response.arrayBuffer());
    if (hash(data) !== expectedHash) {
      throw new Error(`Checksum mismatch for ${name}`);
    }

    const temporary = `${output}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, data);
      await rename(temporary, output);
    } finally {
      await rm(temporary, { force: true });
    }
  }),
);
