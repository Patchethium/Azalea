import { commands } from "$binding";
import { waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import { batch } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  audioQuery,
  config,
  metas,
  preset,
  spectrogram,
} from "../test/fixtures";
import {
  renderConfigStore,
  renderMetaStore,
  renderSpectrogramStore,
  renderTextStores,
} from "@contexts/providers.testUtils";
import {
  clampTextBlockIndex,
  findPresetStyle,
  resolvePresetIdentity,
} from "@contexts/text";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MetaProvider", () => {
  it("combines duplicate speakers and sorts speakers and styles by ID", () => {
    const { store } = renderMetaStore();

    const largerMinimum = {
      ...metas[0],
      name: "Larger minimum",
      speaker_uuid: "speaker-larger",
      styles: [
        { id: 6, name: "Six", order: 2, type: "talk" as const },
        { id: 4, name: "Four", order: 0, type: "talk" as const },
      ],
    };
    const smallerMinimum = {
      ...metas[0],
      name: "Smaller minimum",
      speaker_uuid: "speaker-smaller",
      styles: [
        { id: 10, name: "Ten", order: 1, type: "talk" as const },
        { id: 2, name: "Two", order: 0, type: "talk" as const },
      ],
    };
    const largerMinimumDuplicate = {
      ...largerMinimum,
      styles: [{ id: 5, name: "Five", order: 1, type: "talk" as const }],
    };

    expect(
      store.setMetas([largerMinimum, smallerMinimum, largerMinimumDuplicate]),
    ).toBeUndefined();
    expect(store.metas.map((speaker) => speaker.name)).toEqual([
      "Smaller minimum",
      "Larger minimum",
    ]);
    expect(store.availableStyleIds()).toEqual([2, 10, 4, 5, 6]);
    expect(store.setMetas(metas)).toEqual(
      new Error("Metas are read-only and we already have some"),
    );
  });

  it("owns speaker icon Blob URLs across replacements, clears, and cleanup", () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second")
      .mockReturnValueOnce("blob:cleanup");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL");
    const { store, unmount } = renderMetaStore();
    const request = { speaker_uuid: "speaker", style_id: 7 };
    const missingRequest = { speaker_uuid: "missing", style_id: 8 };
    const result = (dataUrl: string) => [
      { speaker_uuid: "speaker", data_url: dataUrl, error: null },
    ];
    const firstRevision = store.speakerIconRevision();

    expect(
      store.hydrateSpeakerIcons(
        [request, missingRequest],
        [
          ...result("data:image/png;base64,Zmlyc3Q="),
          { speaker_uuid: "missing", data_url: null, error: null },
        ],
        firstRevision,
      ),
    ).toBe(true);
    expect(store.speakerIconUrl(request)).toBe("blob:first");
    expect(store.speakerIconsAreHydrated([request, missingRequest])).toBe(true);
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));

    expect(
      store.mergeSpeakerIcons(
        [request],
        result("data:image/png;base64,c2Vjb25k"),
        firstRevision,
      ),
    ).toBe(true);
    expect(store.speakerIconUrl(request)).toBe("blob:second");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:first");
    expect(
      store.mergeSpeakerIcons(
        [request],
        [{ speaker_uuid: "speaker", data_url: null, error: null }],
        firstRevision,
      ),
    ).toBe(true);
    expect(store.speakerIconUrl(request)).toBeUndefined();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:second");
    expect(store.mergeSpeakerIcons([request], [], firstRevision)).toBe(true);

    store.clearSpeakerIcons();
    expect(store.speakerIconUrl(request)).toBeUndefined();
    expect(store.speakerIconsAreHydrated([request])).toBe(true);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:second");
    expect(
      store.hydrateSpeakerIcons(
        [request],
        result("data:image/png;base64,c3RhbGU="),
        firstRevision,
      ),
    ).toBe(false);

    const currentRevision = store.speakerIconRevision();
    expect(
      store.mergeSpeakerIcons(
        [request],
        result("data:image/png;base64,Y2xlYW51cA=="),
        currentRevision,
      ),
    ).toBe(true);
    unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:cleanup");
  });

  it("rejects invalid icon data and stale work without leaking Blob URLs", () => {
    const { store } = renderMetaStore();
    const request = { speaker_uuid: "speaker", style_id: 7 };
    const revision = store.speakerIconRevision();
    expect(() =>
      store.hydrateSpeakerIcons(
        [request],
        [{ speaker_uuid: "speaker", data_url: "invalid", error: null }],
        revision,
      ),
    ).toThrow("Invalid speaker icon data URL");

    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL");
    vi.spyOn(URL, "createObjectURL").mockImplementationOnce(() => {
      store.clearSpeakerIcons();
      return "blob:stale";
    });
    expect(
      store.hydrateSpeakerIcons(
        [request],
        [
          {
            speaker_uuid: "speaker",
            data_url: "data:image/svg+xml,%3Csvg%2F%3E",
            error: null,
          },
        ],
        revision,
      ),
    ).toBe(false);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:stale");
    store.removeSpeakerIcon(request);
  });
});

describe("SpectrogramProvider", () => {
  it("keys previews by block, speaker, and query and invalidates stale requests", () => {
    const store = renderSpectrogramStore();

    const query = audioQuery();
    expect(store.getCachedSpectrogram("block", query, 1)).toBeNull();
    store.cacheSpectrogram("block", query, 1, spectrogram);
    expect(store.getCachedSpectrogram("block", query, 1)).toBe(spectrogram);
    expect(store.getCachedSpectrogram("block", query, 2)).toBeNull();
    expect(store.getLastCachedSpectrogram("block")).toBe(spectrogram);

    const staleRevision = store.beginSpectrogramRequest("block");
    const latestRevision = store.beginSpectrogramRequest("block");
    expect(store.isLatestSpectrogramRequest("block", staleRevision)).toBe(
      false,
    );
    expect(store.isLatestSpectrogramRequest("block", latestRevision)).toBe(
      true,
    );

    store.clearSpectrogramCache();
    expect(store.getLastCachedSpectrogram("block")).toBeNull();
    expect(store.isLatestSpectrogramRequest("block", latestRevision)).toBe(
      false,
    );
  });
});

describe("ConfigProvider", () => {
  it("defaults feature flags and persists nested changes only after initialization", async () => {
    const invocations: Array<{ cmd: string; args: unknown }> = [];
    mockIPC((cmd, args) => {
      invocations.push({ cmd, args });
      return null;
    });
    const configStore = renderConfigStore();

    expect(configStore.spectrogramPreviewEnabled()).toBe(true);
    expect(configStore.themeMode()).toBe("System");
    configStore.setSpectrogramPreviewEnabled(false);
    await Promise.resolve();
    expect(invocations).toHaveLength(0);

    batch(() => {
      configStore.setConfig(config({ spectrogram_preview: false }));
      configStore.setConfigInitialized(true);
    });
    configStore.setThemeMode("Dark");

    await waitFor(() =>
      expect(invocations.some(({ cmd }) => cmd === "set_config")).toBe(true),
    );
    const save = invocations.find(({ cmd }) => cmd === "set_config");
    expect(save?.args).toMatchObject({
      config: { ui: { theme_mode: "Dark" } },
    });
  });

  it("reports config persistence failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(commands, "setConfig").mockResolvedValue({
      status: "error",
      error: "save failed",
    });
    const configStore = renderConfigStore();

    batch(() => {
      configStore.setConfig(config());
      configStore.setConfigInitialized(true);
    });

    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "Failed to save config:",
        "save failed",
      ),
    );
  });

  it.each([
    {
      init: { status: "error" as const, error: "Core already loaded" },
      range: { status: "error" as const, error: "range failed" },
      meta: { status: "error" as const, error: "meta failed" },
      messages: ["Failed to get range:", "Failed to get metas:"],
    },
    {
      init: { status: "error" as const, error: "init failed" },
      range: { status: "ok" as const, data: {} },
      meta: { status: "ok" as const, data: [] },
      messages: ["Failed to initialize core:"],
    },
    {
      init: { status: "ok" as const, data: null },
      range: { status: "ok" as const, data: { 1: [4, 6] as [number, number] } },
      meta: { status: "ok" as const, data: metas },
      messages: [],
    },
  ])("handles core initialization result %#", async (scenario) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(commands, "initCore").mockResolvedValue(scenario.init);
    vi.spyOn(commands, "getRange").mockResolvedValue(scenario.range);
    vi.spyOn(commands, "getMetas").mockResolvedValue(scenario.meta);
    const configStore = renderConfigStore();

    configStore.setConfig("core", {
      ort_path: "/core",
      ojt_dir: "/dict",
      vvm_dir: "/models",
    });
    await waitFor(() => expect(commands.initCore).toHaveBeenCalledOnce());
    if (
      scenario.init.status === "ok" ||
      scenario.init.error === "Core already loaded"
    ) {
      await waitFor(() => expect(commands.getRange).toHaveBeenCalledOnce());
      expect(commands.getMetas).toHaveBeenCalledOnce();
    }
    for (const message of scenario.messages) {
      expect(console.error).toHaveBeenCalledWith(message, expect.any(String));
    }
  });
});

describe("TextProvider", () => {
  it("maintains selection and stable IDs when replacing and removing project data", async () => {
    const { text, ui, meta } = renderTextStores();

    meta.setMetas(metas);
    text.setProjectPresetStore([preset()]);
    text.replaceTextBlocks([
      {
        id: "first-id",
        text: "first",
        query: null,
        query_is_modified: false,
        preset_id: "preset-1",
      },
      {
        id: "second-id",
        text: "second",
        query: audioQuery(),
        query_is_modified: false,
        preset_id: "preset-1",
      },
    ]);
    ui.setUIStore("selectedTextBlockIndex", 99);

    await waitFor(() => expect(text.selectedTextBlockIndex()).toBe(1));
    expect(text.selectedTextBlock()?.text).toBe("second");
    expect(text.textStore[0].id).toBe("first-id");
    expect(text.textStore[1].id).toBe("second-id");
    await waitFor(() =>
      expect(text.project).toMatchObject({
        blocks: [
          {
            id: "first-id",
            text: "first",
            query_is_modified: false,
            preset_id: "preset-1",
          },
          {
            id: "second-id",
            text: "second",
            query_is_modified: false,
            preset_id: "preset-1",
          },
        ],
        presets: [{ name: "Default" }],
      }),
    );
    expect(text.project.blocks[0]).toHaveProperty("id", "first-id");

    text.setTextStore([]);
    text.createFirstTextBlock();
    expect(text.textStore).toHaveLength(1);
    expect(text.textStore[0]).toMatchObject({
      text: "",
      preset_id: "preset-1",
      query: null,
      query_is_modified: false,
    });
    expect(ui.uiStore.selectedTextBlockIndex).toBe(0);
  });

  it("removes preset references without changing other preset identities", () => {
    const { text } = renderTextStores();
    text.setProjectPresetStore([
      preset({ id: "preset-1" }),
      preset({ id: "preset-2", name: "Second" }),
    ]);
    text.replaceTextBlocks([
      {
        id: "first",
        text: "first",
        query: null,
        query_is_modified: false,
        preset_id: "preset-1",
      },
      {
        id: "second",
        text: "second",
        query: null,
        query_is_modified: false,
        preset_id: "preset-2",
      },
    ]);

    expect(text.removeProjectPreset("preset-1")).toBe(0);
    expect(text.projectPresetStore.map((item) => item.id)).toEqual([
      "preset-2",
    ]);
    expect(text.textStore.map((block) => block.preset_id)).toEqual([
      null,
      "preset-2",
    ]);
  });

  it("creates a new project from available metadata and localized defaults", async () => {
    vi.stubEnv("DEV", false);
    const { text, meta } = renderTextStores();

    meta.setMetas(metas);
    await waitFor(() => expect(meta.availableStyleIds()).toEqual([1, 2]));
    text.newProject();
    expect(text.projectPath()).toBeNull();
    expect(text.projectPresetStore).toHaveLength(1);
    expect(text.projectPresetStore[0].style_id).toBe(1);
    expect(text.projectPresetStore[0]).toMatchObject({
      speaker_uuid: "speaker-1",
      style_name: "Normal",
    });
    expect(text.textStore).toHaveLength(1);
    expect(text.textStore[0].preset_id).toBe(text.projectPresetStore[0].id);
  });

  it("remaps style IDs by speaker UUID and style name", () => {
    const movedStyleMetas = [
      {
        ...metas[0],
        styles: [{ ...metas[0].styles[0], id: 42, name: "Normal" }],
      },
    ];
    const storedPreset = preset({
      style_id: 1,
      speaker_uuid: "speaker-1",
      style_name: "Normal",
    });

    expect(resolvePresetIdentity(storedPreset, movedStyleMetas)).toMatchObject({
      style_id: 42,
      speaker_uuid: "speaker-1",
      style_name: "Normal",
    });
    expect(
      findPresetStyle(
        preset({ speaker_uuid: "missing-speaker", style_name: "Normal" }),
        metas,
      ),
    ).toBeNull();
    expect(
      findPresetStyle(preset({ style_name: "Missing Style" }), metas),
    ).toBeNull();
    expect(
      findPresetStyle(
        preset({ style_id: 999, speaker_uuid: null, style_name: null }),
        metas,
      ),
    ).toBeNull();
  });

  it("handles empty stores, query marks, and fallback block IDs", () => {
    expect(clampTextBlockIndex(Number.NaN, 2)).toBe(0);
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", undefined);
    try {
      const { text } = renderTextStores();
      text.setTextStore([]);
      expect(text.insertTextBlockBelow(99)).toBe(0);
      expect(text.textStore[0]).toMatchObject({ preset_id: null, query: null });
      expect(text.textStore[0].id).toMatch(/^text-block-/);

      text.markQueryModified(0);
      expect(text.textStore[0].query_is_modified).toBe(false);
      text.setTextStore(0, "query", audioQuery());
      text.markQueryModified(0);
      expect(text.textStore[0].query_is_modified).toBe(true);
      text.createFirstTextBlock();
      expect(text.textStore).toHaveLength(1);
    } finally {
      vi.stubGlobal("crypto", originalCrypto);
    }
  });
});
