import { convertFileSrc } from "@tauri-apps/api/core";

const FONTS = [
  ["Azalea Noto Sans JP", "NotoSansJP-VF.otf"],
  ["Azalea Noto Sans SC", "NotoSansSC-VF.otf"],
] as const;

let registered = false;

/**
 * Registers the downloaded Noto Sans CJK fonts, served by the backend's
 * `azalea-font` scheme. Browsers fetch a face only once text uses it.
 */
export function registerEmbeddedFonts() {
  if (registered || typeof FontFace === "undefined") return;
  registered = true;
  for (const [family, file] of FONTS) {
    const face = new FontFace(
      family,
      `url("${convertFileSrc(file, "azalea-font")}") format("opentype")`,
      { style: "normal", weight: "100 900", display: "swap" },
    );
    document.fonts.add(face);
  }
}
