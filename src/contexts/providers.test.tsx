import { MultiProvider } from "@solid-primitives/context";
import { render, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { Component } from "solid-js";
import { batch } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import {
  audioQuery,
  config,
  metas,
  preset,
  spectrogram,
} from "../test/fixtures";
import { ConfigProvider, useConfigStore } from "./config";
import { i18nProvider } from "./i18n";
import { MetaProvider, useMetaStore } from "./meta";
import { SpectrogramProvider, useSpectrogramStore } from "./spectrogram";
import { TextProvider, useTextStore } from "./text";
import { UIProvider, useUIStore } from "./ui";

type MetaStore = NonNullable<ReturnType<typeof useMetaStore>>;
type SpectrogramStore = NonNullable<ReturnType<typeof useSpectrogramStore>>;
type ConfigStore = NonNullable<ReturnType<typeof useConfigStore>>;
type TextStore = NonNullable<ReturnType<typeof useTextStore>>;
type UiStore = NonNullable<ReturnType<typeof useUIStore>>;

describe("MetaProvider", () => {
  it("combines duplicate speakers, sorts their styles, and stays read-only", () => {
    let store!: MetaStore;
    const Probe: Component = () => {
      store = useMetaStore()!;
      return null;
    };
    render(() => (
      <MultiProvider values={[[MetaProvider, []]]}>
        <Probe />
      </MultiProvider>
    ));

    const duplicate = {
      ...metas[0],
      styles: [{ id: 0, name: "Whisper", order: 2, type: "talk" as const }],
    };
    expect(store.setMetas([...metas, duplicate])).toBeUndefined();
    expect(store.metas).toHaveLength(1);
    expect(store.availableStyleIds()).toEqual([0, 1, 2]);
    expect(store.setMetas(metas)).toEqual(
      new Error("Metas are read-only and we already have some"),
    );
  });
});

describe("SpectrogramProvider", () => {
  it("keys previews by block, speaker, and query and invalidates stale requests", () => {
    let store!: SpectrogramStore;
    const Probe: Component = () => {
      store = useSpectrogramStore()!;
      return null;
    };
    render(() => (
      <MultiProvider values={[[SpectrogramProvider, null]]}>
        <Probe />
      </MultiProvider>
    ));

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
    let configStore!: ConfigStore;
    const Probe: Component = () => {
      configStore = useConfigStore()!;
      return null;
    };
    render(() => (
      <MultiProvider
        values={[
          [MetaProvider, []],
          [UIProvider, null],
          [ConfigProvider, null],
        ]}
      >
        <Probe />
      </MultiProvider>
    ));

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
      config: { ui_config: { theme_mode: "Dark" } },
    });
  });
});

describe("TextProvider", () => {
  it("maintains selection and runtime IDs when replacing and removing project data", async () => {
    let text!: TextStore;
    let ui!: UiStore;
    let meta!: MetaStore;
    const Probe: Component = () => {
      text = useTextStore()!;
      ui = useUIStore()!;
      meta = useMetaStore()!;
      return null;
    };
    render(() => (
      <MultiProvider
        values={[
          [MetaProvider, []],
          [UIProvider, null],
          [SpectrogramProvider, null],
          [ConfigProvider, null],
          [i18nProvider, null],
          [TextProvider, null],
        ]}
      >
        <Probe />
      </MultiProvider>
    ));

    meta.setMetas(metas);
    text.setProjectPresetStore([preset()]);
    text.replaceTextBlocks([
      { text: "first", query: null, preset_id: 0 },
      { text: "second", query: audioQuery(), preset_id: 0 },
    ]);
    ui.setUIStore("selectedTextBlockIndex", 99);

    await waitFor(() => expect(text.selectedTextBlockIndex()).toBe(1));
    expect(text.selectedTextBlock()?.text).toBe("second");
    expect(text.textStore[0].runtimeId).toBeTruthy();
    expect(text.textStore[0].runtimeId).not.toBe(text.textStore[1].runtimeId);
    await waitFor(() =>
      expect(text.project).toMatchObject({
        blocks: [
          { text: "first", preset_id: 0 },
          { text: "second", preset_id: 0 },
        ],
        presets: [{ name: "Default" }],
      }),
    );
    expect(text.project.blocks[0]).not.toHaveProperty("runtimeId");

    text.setTextStore([]);
    text.createFirstTextBlock();
    expect(text.textStore).toHaveLength(1);
    expect(text.textStore[0]).toMatchObject({
      text: "",
      preset_id: 0,
      query: null,
    });
    expect(ui.uiStore.selectedTextBlockIndex).toBe(0);
  });

  it("creates a new project from available metadata and localized defaults", async () => {
    vi.stubEnv("DEV", false);
    let text!: TextStore;
    let meta!: MetaStore;
    const Probe: Component = () => {
      text = useTextStore()!;
      meta = useMetaStore()!;
      return null;
    };
    render(() => (
      <MultiProvider
        values={[
          [MetaProvider, []],
          [UIProvider, null],
          [SpectrogramProvider, null],
          [ConfigProvider, null],
          [i18nProvider, null],
          [TextProvider, null],
        ]}
      >
        <Probe />
      </MultiProvider>
    ));

    meta.setMetas(metas);
    await waitFor(() => expect(meta.availableStyleIds()).toEqual([1, 2]));
    text.newProject();
    expect(text.projectPath()).toBeNull();
    expect(text.projectPresetStore).toHaveLength(1);
    expect(text.projectPresetStore[0].style_id).toBe(1);
    expect(text.textStore).toHaveLength(1);
    expect(text.textStore[0].preset_id).toBe(0);
  });
});
