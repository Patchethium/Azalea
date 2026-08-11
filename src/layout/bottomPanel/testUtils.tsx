import { BottomPanel, SpectrogramCanvas } from "@layout/bottomPanel";
import Sidebar from "@layout/sidebar";
import { MultiProvider } from "@solid-primitives/context";
import { render } from "@solidjs/testing-library";
import { batch, type Component, onMount } from "solid-js";
import { ConfigProvider, useConfigStore } from "../../contexts/config";
import { i18nProvider } from "../../contexts/i18n";
import { MetaProvider, useMetaStore } from "../../contexts/meta";
import { SpectrogramProvider } from "../../contexts/spectrogram";
import { SystemProvider } from "../../contexts/system";
import { TextProvider, useTextStore } from "../../contexts/text";
import { UIProvider, useUIStore } from "../../contexts/ui";
import { audioQuery, config, metas, preset } from "../../test/fixtures";

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
  configOverrides: Partial<ReturnType<typeof config>["ui_config"]> = {},
  withSidebar = false,
) => {
  let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
  let text!: NonNullable<ReturnType<typeof useTextStore>>;
  let ui!: NonNullable<ReturnType<typeof useUIStore>>;
  const Harness: Component = () => {
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
            preset_id: 0,
          },
          {
            id: "second-block",
            text: "second",
            query: audioQuery({ speedScale: 1.1 }),
            query_is_modified: false,
            preset_id: 0,
          },
        ]);
      });
    });
    return (
      <main>
        {withSidebar && <Sidebar />}
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
