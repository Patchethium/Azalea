import { BottomPanel, SpectrogramCanvas } from "@layout/bottomPanel";
import { useTextBlockSynthesis } from "@components/textBlock/useSynthesis";
import { useTuningPanel } from "@layout/bottomPanel/tuning/usePanel";
import type { WaveformSynthesisNotice } from "@layout/bottomPanel/types";
import { usePlaybackControls } from "@layout/bottomPanel/usePlaybackControls";
import Sidebar from "@layout/sidebar";
import { MultiProvider } from "@solid-primitives/context";
import { render } from "@solidjs/testing-library";
import {
  batch,
  type Component,
  createMemo,
  createSignal,
  onMount,
  type Setter,
} from "solid-js";
import { ConfigProvider, useConfigStore } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider, useMetaStore } from "@contexts/meta";
import { SpectrogramProvider } from "@contexts/spectrogram";
import { SystemProvider } from "@contexts/system";
import { findPresetById, TextProvider, useTextStore } from "@contexts/text";
import { UIProvider, useUIStore } from "@contexts/ui";
import { getModifiedQuery } from "$utils";
import { audioQuery, config, metas, preset } from "../../test/fixtures";

const BufferedWaveformJob: Component = () => {
  const { projectPresetStore, textStore } = useTextStore()!;
  const currentText = createMemo(() => textStore[0]);
  const currentPreset = createMemo(() =>
    findPresetById(projectPresetStore, currentText().preset_id),
  );
  const currentModifiedQuery = createMemo(() => {
    const query = currentText().query;
    const selectedPreset = currentPreset();
    return query === null || selectedPreset === null
      ? null
      : getModifiedQuery(query, selectedPreset);
  });
  useTextBlockSynthesis({
    index: 0,
    currentText,
    currentPreset,
    currentModifiedQuery,
  });
  return null;
};

export const renderCanvas = (
  preview: Parameters<typeof SpectrogramCanvas>[0]["preview"],
  stale = false,
) =>
  render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, null],
      ]}
    >
      <SpectrogramCanvas
        preview={preview}
        width={120}
        preSilence={1}
        postSilence={1}
        stale={stale}
      />
    </MultiProvider>
  ));

export const renderPanel = (
  configOverrides: Partial<ReturnType<typeof config>["ui"]> = {},
  withSidebar = false,
  withWaveformSynthesis = false,
) => {
  let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
  let text!: NonNullable<ReturnType<typeof useTextStore>>;
  let ui!: NonNullable<ReturnType<typeof useUIStore>>;
  const Harness: Component = () => {
    const [fixtureInitialized, setFixtureInitialized] = createSignal(false);
    appConfig = useConfigStore()!;
    text = useTextStore()!;
    ui = useUIStore()!;
    const meta = useMetaStore()!;
    onMount(() => {
      batch(() => {
        meta.setMetas(metas);
        appConfig.setConfig(config(configOverrides));
        appConfig.setRange({ 1: [4, 6] });
        text.setProjectPresetStore([preset()]);
        text.replaceTextBlocks([
          {
            id: "first-block",
            text: "first",
            query: audioQuery(),
            query_is_modified: false,
            preset_id: "preset-1",
          },
          {
            id: "second-block",
            text: "second",
            query: audioQuery({ speedScale: 1.1 }),
            query_is_modified: false,
            preset_id: "preset-1",
          },
        ]);
        setFixtureInitialized(true);
      });
    });
    return (
      <main>
        {withSidebar && <Sidebar />}
        {withWaveformSynthesis && fixtureInitialized() && (
          <BufferedWaveformJob />
        )}
        <BottomPanel />
      </main>
    );
  };
  const result = render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [SpectrogramProvider, null],
        [ConfigProvider, null],
        [SystemProvider, null],
        [i18nProvider, null],
        [TextProvider, null],
      ]}
    >
      <Harness />
    </MultiProvider>
  ));
  return {
    ...result,
    getConfigStore: () => appConfig,
    getTextStore: () => text,
    getUiStore: () => ui,
  };
};

export const renderTuningHook = (
  configOverrides: Partial<ReturnType<typeof config>["ui"]> = {},
) => {
  let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
  let text!: NonNullable<ReturnType<typeof useTextStore>>;
  let ui!: NonNullable<ReturnType<typeof useUIStore>>;
  let panel!: ReturnType<typeof useTuningPanel>;
  let setNotice!: Setter<WaveformSynthesisNotice | null>;
  const Harness: Component = () => {
    appConfig = useConfigStore()!;
    text = useTextStore()!;
    ui = useUIStore()!;
    const meta = useMetaStore()!;
    const [notice, setWaveformNotice] =
      createSignal<WaveformSynthesisNotice | null>(null);
    setNotice = setWaveformNotice;
    panel = useTuningPanel(notice);
    onMount(() => {
      batch(() => {
        meta.setMetas(metas);
        appConfig.setConfig(config(configOverrides));
        appConfig.setRange({ 1: [4, 6] });
        text.setProjectPresetStore([preset()]);
        text.replaceTextBlocks([
          {
            id: "first-block",
            text: "first",
            query: audioQuery(),
            query_is_modified: false,
            preset_id: "preset-1",
          },
        ]);
      });
    });
    return <div ref={panel.setScrollAreaRef} />;
  };
  const result = render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [SpectrogramProvider, null],
        [ConfigProvider, null],
        [SystemProvider, null],
        [i18nProvider, null],
        [TextProvider, null],
      ]}
    >
      <Harness />
    </MultiProvider>
  ));
  return {
    ...result,
    getConfigStore: () => appConfig,
    getPanel: () => panel,
    getTextStore: () => text,
    getUiStore: () => ui,
    setNotice,
  };
};

export const renderPlaybackHook = (
  onWaveformSynthesized: (notice: WaveformSynthesisNotice) => void,
) => {
  let controls!: ReturnType<typeof usePlaybackControls>;
  let text!: NonNullable<ReturnType<typeof useTextStore>>;
  let ui!: NonNullable<ReturnType<typeof useUIStore>>;
  const Harness: Component = () => {
    const appConfig = useConfigStore()!;
    const meta = useMetaStore()!;
    text = useTextStore()!;
    ui = useUIStore()!;
    controls = usePlaybackControls(onWaveformSynthesized);
    onMount(() => {
      batch(() => {
        meta.setMetas(metas);
        appConfig.setConfig(config());
        text.setProjectPresetStore([preset()]);
        text.replaceTextBlocks([
          {
            id: "first-block",
            text: "first",
            query: audioQuery(),
            query_is_modified: false,
            preset_id: "preset-1",
          },
          {
            id: "second-block",
            text: "second",
            query: audioQuery({ speedScale: 1.1 }),
            query_is_modified: false,
            preset_id: "preset-1",
          },
        ]);
      });
    });
    return null;
  };
  const result = render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, null],
        [SystemProvider, null],
        [i18nProvider, null],
        [TextProvider, null],
      ]}
    >
      <Harness />
    </MultiProvider>
  ));
  return {
    ...result,
    getControls: () => controls,
    getTextStore: () => text,
    getUiStore: () => ui,
  };
};
