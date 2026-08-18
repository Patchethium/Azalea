// The store holding the configuration

import { AzaleaConfig, commands, StyleId, ThemeMode } from "$binding";
import { createContextProvider } from "@solid-primitives/context";
import { createEffect, createResource, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import {
  DEFAULT_CUSTOM_TITLEBAR,
  DEFAULT_PLAYBACK_TIMELINE,
  DEFAULT_SPECTROGRAM_PREVIEW,
  DEFAULT_THEME_MODE,
} from "$constants";
import { useMetaStore } from "@contexts/meta";
import { useUIStore } from "@contexts/ui";

const [ConfigProvider, useConfigStore] = createContextProvider(() => {
  const { uiStore, setUIStore } = useUIStore()!;
  const { setMetas } = useMetaStore()!;

  const [config, setConfig] = createStore<AzaleaConfig>({
    core: null,
    system_presets: [],
    ui: {},
  } as AzaleaConfig);

  type RangeMap = { [key in StyleId]: [number, number] };

  const [range, setRange] = createSignal<RangeMap | null>(null);

  const [configInitialized, setConfigInitialized] = createSignal(false);

  const spectrogramPreviewEnabled = () =>
    config.ui.spectrogram_preview ?? DEFAULT_SPECTROGRAM_PREVIEW;
  const setSpectrogramPreviewEnabled = (enabled: boolean) => {
    setConfig("ui", "spectrogram_preview", enabled);
  };
  const playbackTimelineEnabled = () =>
    config.ui.playback_timeline ?? DEFAULT_PLAYBACK_TIMELINE;
  const setPlaybackTimelineEnabled = (enabled: boolean) => {
    setConfig("ui", "playback_timeline", enabled);
  };
  const customTitlebarEnabled = () =>
    config.ui.custom_titlebar ?? DEFAULT_CUSTOM_TITLEBAR;
  const setCustomTitlebarEnabled = (enabled: boolean) => {
    setConfig("ui", "custom_titlebar", enabled);
  };
  const themeMode = (): ThemeMode => config.ui.theme_mode ?? DEFAULT_THEME_MODE;
  const setThemeMode = (mode: ThemeMode) => {
    setConfig("ui", "theme_mode", mode);
  };

  const load_meta = async () => {
    const metas = await commands.getMetas();
    if (metas.status === "ok") {
      setMetas(metas.data);
    } else {
      console.error("Failed to get metas:", metas.error);
    }
  };

  const load_range = async () => {
    const res = await commands.getRange();
    if (res.status === "ok") {
      setRange(res.data as RangeMap);
    } else {
      console.error("Failed to get range:", res.error);
    }
  };

  const reloadCoreDependentState = async () => {
    await Promise.all([load_meta(), load_range()]);
  };

  const reinitializeCore = async (): Promise<boolean> => {
    const coreConfig = config.core;
    if (coreConfig === null) {
      console.error("Cannot reinitialize core: no core config is set");
      return false;
    }
    const res = await commands.reinitCore(coreConfig);
    if (res.status === "error") {
      console.error("Failed to reinitialize core:", res.error);
      return false;
    }
    await reloadCoreDependentState();
    return true;
  };

  const [coreInitializeResource] = createResource(
    () => (uiStore.coreInitialized ? undefined : config.core),
    async (cfg) => {
      const res = await commands.initCore(cfg);
      if (res.status === "error") {
        if (res.error === "Core already loaded") {
          void reloadCoreDependentState();
          setUIStore("coreInitialized", true);
        } else {
          setUIStore("coreInitialized", false);
          console.error("Failed to initialize core:", res.error);
        }
      } else {
        void reloadCoreDependentState();
        setUIStore("coreInitialized", true);
      }
    },
  );

  const saveConfig = async () => {
    if (configInitialized()) {
      const res = await commands.setConfig(config);
      if (res.status === "error") {
        console.error("Failed to save config:", res.error);
      }
    }
  };
  createEffect(() => {
    if (!configInitialized()) return;

    // Read the complete store so changes to nested settings trigger the effect.
    JSON.stringify(config);
    saveConfig();
  });

  return {
    config,
    setConfig,
    configInitialized,
    setConfigInitialized,
    coreInitializeResource,
    range,
    setRange,
    reinitializeCore,
    spectrogramPreviewEnabled,
    setSpectrogramPreviewEnabled,
    playbackTimelineEnabled,
    setPlaybackTimelineEnabled,
    customTitlebarEnabled,
    setCustomTitlebarEnabled,
    themeMode,
    setThemeMode,
  };
});

export { ConfigProvider, useConfigStore };
