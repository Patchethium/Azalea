import { mockConvertFileSrc } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("registerEmbeddedFonts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("adds each downloaded face once through the font scheme", async () => {
    const added: { family: string; source: string; weight?: string }[] = [];
    vi.stubGlobal(
      "FontFace",
      class {
        constructor(
          public family: string,
          public source: string,
          descriptors: FontFaceDescriptors,
        ) {
          added.push({ family, source, weight: descriptors.weight });
        }
      },
    );
    mockConvertFileSrc("linux");
    const add = vi.fn();
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { add },
    });
    const { registerEmbeddedFonts } = await import("./embeddedFonts");
    registerEmbeddedFonts();
    registerEmbeddedFonts();

    expect(add).toHaveBeenCalledTimes(2);
    expect(added.map((face) => face.family)).toEqual([
      "Azalea Noto Sans JP",
      "Azalea Noto Sans SC",
    ]);
    expect(added[0].source).toBe(
      'url("azalea-font://localhost/NotoSansJP-VF.otf") format("opentype")',
    );
    expect(added[1].weight).toBe("100 900");
  });

  it("does nothing where FontFace is unavailable", async () => {
    vi.stubGlobal("FontFace", undefined);
    const { registerEmbeddedFonts } = await import("./embeddedFonts");
    expect(() => registerEmbeddedFonts()).not.toThrow();
  });
});
