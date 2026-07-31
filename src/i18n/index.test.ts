import { describe, expect, it } from "vitest";
import { coverages, getDict, ja, localeNames, possibleLocales, zhCn } from ".";

describe("translations", () => {
  it("keeps all locale dictionaries synchronized", () => {
    const englishKeys = Object.keys(getDict("En")).sort();
    expect(Object.keys(getDict("Ja", "Ja")).sort()).toEqual(englishKeys);
    expect(Object.keys(getDict("ZhCn", "ZhCn")).sort()).toEqual(englishKeys);
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
    expect(getDict("En")["speaker_selection.download_icons"]).toBe(
      "Download speaker icons",
    );
    expect(getDict("Ja")["speaker_selection.download_icons"]).toBe(
      "話者アイコンをダウンロード",
    );
    expect(getDict("ZhCn")["speaker_selection.download_icons"]).toBe(
      "下载说话人图标",
    );
    expect(getDict("En")["config.clear_assets_cache"]).toBe("Clear cache");
    expect(getDict("Ja")["config.clear_assets_cache"]).toBe("キャッシュを削除");
    expect(getDict("ZhCn")["config.clear_assets_cache"]).toBe("清除缓存");
  });
});
