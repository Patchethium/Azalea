import { describe, expect, it } from "vitest";
import {
  coverages,
  en,
  getDict,
  ja,
  localeNames,
  possibleLocales,
  zhCn,
} from ".";

describe("translations", () => {
  it("keeps all locale dictionaries synchronized", () => {
    const englishKeys = Object.keys(en).sort();
    expect(Object.keys(ja).sort()).toEqual(englishKeys);
    expect(Object.keys(zhCn).sort()).toEqual(englishKeys);
    expect(coverages).toEqual({ En: 1, Ja: 1, ZhCn: 1 });
  });

  it("exposes every locale and resolves translated and fallback keys", () => {
    expect(possibleLocales).toEqual(["En", "Ja", "ZhCn"]);
    expect(localeNames).toEqual({
      En: "English",
      Ja: "日本語",
      ZhCn: "简体中文",
    });
    expect(getDict("Ja")["config.spectrogram_preview"]).toBe(
      ja.config.spectrogram_preview,
    );
    expect(getDict("ZhCn")["config.spectrogram_preview"]).toBe(
      zhCn.config.spectrogram_preview,
    );
  });
});
