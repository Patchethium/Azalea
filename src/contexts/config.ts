// The store holding the configuration

import {
  AzaleaConfig,
  type CoreConfig,
  type SetupSource,
  commands,
  PitchRange,
  StyleId,
  ThemeMode,
  TitlebarStyle,
} from "$binding";
import { createContextProvider } from "@solid-primitives/context";
import { batch, createEffect, createResource, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import {
  DEFAULT_CPU_NUM_THREADS,
  DEFAULT_ENGLISH_ACCENT_PREDICTION,
  DEFAULT_ENGLISH_NGRAM_FILTER,
  DEFAULT_ENGLISH_TRANSFORM,
  DEFAULT_ENGLISH_TURBO_MODEL,
  DEFAULT_TITLEBAR_STYLE,
  DEFAULT_PITCH_RULER,
  DEFAULT_PLAYBACK_TIMELINE,
  DEFAULT_SPECTROGRAM_PREVIEW,
  DEFAULT_STREAMING_SYNTHESIS,
  DEFAULT_THEME_MODE,
} from "$constants";
import { useMetaStore } from "@contexts/meta";
import { useUIStore } from "@contexts/ui";

const [ConfigProvider, useConfigStore] = createContextProvider(() => {
  const { uiStore, setUIStore } = useUIStore()!;
  const { setMetas, availableStyleIds } = useMetaStore()!;

  const [config, setConfig] = createStore<AzaleaConfig>({
    core: null,
    system_presets: [],
    ui: {},
  } as AzaleaConfig);

  type RangeMap = { [key in StyleId]: PitchRange };

  const [range, setRange] = createSignal<RangeMap | null>(null);

  const [downloadedCore, setDownloadedCore] = createSignal<CoreConfig | null>(
    null,
  );
  const [activeSetupSource, setActiveSetupSource] = createSignal<SetupSource>(
    "ExistingInstallation",
  );
  const [coreSwitching, setCoreSwitching] = createSignal(false);
  const [setupSwitchPending, setSetupSwitchPending] = createSignal(false);
  const [coreRevision, setCoreRevision] = createSignal(0);
  const [coreError, setCoreError] = createSignal<string | null>(null);
  const setupSource = () => config.setup_source ?? "ExistingInstallation";
  const setupChangePending = () =>
    uiStore.coreInitialized && setupSource() !== activeSetupSource();
  const voicesReady = () =>
    uiStore.coreInitialized &&
    !setupChangePending() &&
    !coreSwitching() &&
    availableStyleIds().length > 0;
  const effectiveCore = () =>
    setupSource() === "Downloaded"
      ? downloadedCore() && {
          ...downloadedCore()!,
          cache_size: config.downloaded_setup?.cache_size ?? 128,
          cpu_num_threads:
            config.downloaded_setup?.cpu_num_threads ?? DEFAULT_CPU_NUM_THREADS,
        }
      : config.core;
  const cpuNumThreads = () =>
    setupSource() === "Downloaded"
      ? (config.downloaded_setup?.cpu_num_threads ?? DEFAULT_CPU_NUM_THREADS)
      : (config.core?.cpu_num_threads ?? DEFAULT_CPU_NUM_THREADS);
  const setCpuNumThreads = (threads: number) => {
    if (setupSource() === "Downloaded") {
      setConfig("downloaded_setup", {
        cache_size: config.downloaded_setup?.cache_size ?? 128,
        cpu_num_threads: threads,
      });
    } else if (config.core) setConfig("core", "cpu_num_threads", threads);
  };

  const [configInitialized, setConfigInitialized] = createSignal(false);
  const [committedCpuNumThreads, setCommittedCpuNumThreads] = createSignal<
    number | undefined
  >(undefined);
  const markCpuThreadsCommitted = (threads: number | undefined) => {
    setCommittedCpuNumThreads(threads ?? DEFAULT_CPU_NUM_THREADS);
  };
  createEffect(() => {
    if (!configInitialized() || !uiStore.coreInitialized) return;
    if (committedCpuNumThreads() !== undefined) return;
    markCpuThreadsCommitted(cpuNumThreads());
  });

  const spectrogramPreviewEnabled = () =>
    config.ui.spectrogram_preview ?? DEFAULT_SPECTROGRAM_PREVIEW;
  const setSpectrogramPreviewEnabled = (enabled: boolean) => {
    setConfig("ui", "spectrogram_preview", enabled);
  };
  const streamingSynthesisEnabled = () =>
    config.ui.streaming_synthesis ?? DEFAULT_STREAMING_SYNTHESIS;
  const setStreamingSynthesisEnabled = (enabled: boolean) => {
    setConfig("ui", "streaming_synthesis", enabled);
  };
  const englishTransformEnabled = () =>
    config.ui.english_transform ?? DEFAULT_ENGLISH_TRANSFORM;
  const englishAccentPredictionEnabled = () =>
    config.ui.english_accent_prediction ?? DEFAULT_ENGLISH_ACCENT_PREDICTION;
  const englishNgramFilterEnabled = () =>
    config.ui.english_ngram_filter ?? DEFAULT_ENGLISH_NGRAM_FILTER;
  const englishTurboModelEnabled = () =>
    config.ui.english_turbo_model ?? DEFAULT_ENGLISH_TURBO_MODEL;
  /** The English reading options the backend applies, null when disabled. */
  const englishReadingKey = () =>
    englishTransformEnabled()
      ? JSON.stringify([
          englishAccentPredictionEnabled(),
          englishNgramFilterEnabled(),
          englishTurboModelEnabled(),
        ])
      : null;
  /** Bumped once the backend has saved changed English reading options. */
  const [englishReadingRevision, setEnglishReadingRevision] = createSignal(0);
  let savedEnglishReading: string | null | undefined;
  const playbackTimelineEnabled = () =>
    config.ui.playback_timeline ?? DEFAULT_PLAYBACK_TIMELINE;
  const setPlaybackTimelineEnabled = (enabled: boolean) => {
    setConfig("ui", "playback_timeline", enabled);
  };
  const titlebarStyle = (): TitlebarStyle =>
    config.ui.titlebar_style ?? DEFAULT_TITLEBAR_STYLE;
  const setTitlebarStyle = (style: TitlebarStyle) => {
    setConfig("ui", "titlebar_style", style);
  };
  const pitchRulerEnabled = () => config.ui.pitch_ruler ?? DEFAULT_PITCH_RULER;
  /** Whether the loaded ONNX Runtime allows pitch noise and pitch completion. */
  const [pitchControlSupported, setPitchControlSupported] = createSignal(true);
  const pitchNoiseActive = () =>
    (config.ui.pitch_noise_enabled ?? false) && pitchControlSupported();
  const pitchCompletionAvailable = () =>
    (config.ui.pitch_completion_enabled ?? false) && pitchControlSupported();
  const pitchCompletionActive = () =>
    pitchCompletionAvailable() && !config.ui.pitch_completion_locked;
  const togglePitchCompletionLock = () => {
    if (pitchCompletionAvailable())
      setConfig(
        "ui",
        "pitch_completion_locked",
        !config.ui.pitch_completion_locked,
      );
  };
  const setPitchRulerEnabled = (enabled: boolean) => {
    setConfig("ui", "pitch_ruler", enabled);
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

  const load_pitch_control = async () => {
    const res = await commands.supportsPitchControl();
    if (res.status === "ok") {
      setPitchControlSupported(res.data);
    } else {
      console.error("Failed to get pitch control support:", res.error);
    }
  };

  const reloadCoreDependentState = async () => {
    await Promise.all([load_meta(), load_range(), load_pitch_control()]);
  };

  const refreshCoreAfterModelDeletion = async () => {
    if (!uiStore.coreInitialized || activeSetupSource() !== "Downloaded")
      return;
    const result = await commands.getMetas();
    batch(() => {
      setMetas(result.status === "ok" ? result.data : []);
      setCoreRevision((revision) => revision + 1);
      if (result.status === "error") {
        setDownloadedCore(null);
        setRange(null);
        setCoreError(result.error);
        setUIStore("coreInitialized", false);
      }
    });
    if (result.status === "ok") await load_range();
  };

  const reinitializeCore = async (): Promise<boolean> => {
    if (coreSwitching()) return false;
    const coreConfig = effectiveCore();
    if (coreConfig === null) {
      console.error("Cannot reinitialize core: no core config is set");
      return false;
    }
    const source = setupSource();
    setCoreSwitching(true);
    try {
      const res = await commands.reinitCore(coreConfig);
      if (res.status === "error") {
        setCoreError(res.error);
        setConfig("setup_source", activeSetupSource());
        console.error("Failed to reinitialize core:", res.error);
        return false;
      }
      await reloadCoreDependentState();
      batch(() => {
        setCoreError(null);
        setActiveSetupSource(source);
        markCpuThreadsCommitted(coreConfig.cpu_num_threads);
        setCoreRevision((revision) => revision + 1);
      });
      return true;
    } catch (error) {
      setCoreError(String(error));
      setConfig("setup_source", activeSetupSource());
      return false;
    } finally {
      setCoreSwitching(false);
    }
  };

  const [coreInitializeResource] = createResource(
    () => (uiStore.coreInitialized ? undefined : effectiveCore()),
    async (cfg) => {
      const source = setupSource();
      const res = await commands.initCore(cfg);
      setCoreError(null);
      if (res.status === "error") {
        if (res.error === "Core already loaded") {
          markCpuThreadsCommitted(cfg.cpu_num_threads);
          void reloadCoreDependentState();
          setActiveSetupSource(source);
          setUIStore("coreInitialized", true);
        } else {
          setUIStore("coreInitialized", false);
          setCoreError(res.error);
          console.error("Failed to initialize core:", res.error);
        }
      } else {
        markCpuThreadsCommitted(cfg.cpu_num_threads);
        void reloadCoreDependentState();
        setActiveSetupSource(source);
        setUIStore("coreInitialized", true);
      }
    },
  );

  /** The latest failed config write; a new object for every failure. */
  const [configSaveFailure, setConfigSaveFailure] = createSignal<{
    error: string;
  } | null>(null);
  const saveConfig = async () => {
    if (configInitialized()) {
      const englishReading = englishReadingKey();
      const res = await commands.setConfig(config);
      if (res.status === "error") {
        console.error("Failed to save config:", res.error);
        setConfigSaveFailure({ error: res.error });
      } else {
        // Queries are regenerated only after the backend reads the new options.
        if (
          savedEnglishReading !== undefined &&
          savedEnglishReading !== englishReading
        )
          setEnglishReadingRevision((revision) => revision + 1);
        savedEnglishReading = englishReading;
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
    setDownloadedCore,
    setupSource,
    activeSetupSource,
    setActiveSetupSource,
    coreSwitching,
    coreRevision,
    coreError,
    setCoreError,
    configSaveFailure,
    englishTransformEnabled,
    englishAccentPredictionEnabled,
    englishNgramFilterEnabled,
    englishTurboModelEnabled,
    englishReadingRevision,
    setupChangePending,
    setupSwitchPending,
    setSetupSwitchPending,
    voicesReady,
    cpuNumThreads,
    setCpuNumThreads,
    configInitialized,
    setConfigInitialized,
    committedCpuNumThreads,
    coreInitializeResource,
    range,
    setRange,
    reinitializeCore,
    refreshCoreAfterModelDeletion,
    spectrogramPreviewEnabled,
    setSpectrogramPreviewEnabled,
    streamingSynthesisEnabled,
    setStreamingSynthesisEnabled,
    playbackTimelineEnabled,
    setPlaybackTimelineEnabled,
    titlebarStyle,
    setTitlebarStyle,
    pitchRulerEnabled,
    setPitchRulerEnabled,
    pitchControlSupported,
    pitchNoiseActive,
    pitchCompletionAvailable,
    pitchCompletionActive,
    togglePitchCompletionLock,
    themeMode,
    setThemeMode,
  };
});

export { ConfigProvider, useConfigStore };
