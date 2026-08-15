import TextBlock from "@components/textBlock";
import { MultiProvider } from "@solid-primitives/context";
import { render } from "@solidjs/testing-library";
import { batch, type Component, For, onMount } from "solid-js";
import { ConfigProvider, useConfigStore } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider, useMetaStore } from "@contexts/meta";
import { SpectrogramProvider } from "@contexts/spectrogram";
import { TextProvider, useTextStore } from "@contexts/text";
import { UIProvider, useUIStore } from "@contexts/ui";
import { audioQuery, config, metas, preset } from "../../test/fixtures";

export const renderBlock = (
  bufferRender: boolean,
  queryIsModified = false,
  renderAllBlocks = false,
) => {
  let text!: NonNullable<ReturnType<typeof useTextStore>>;
  let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
  let ui!: NonNullable<ReturnType<typeof useUIStore>>;
  const Harness: Component = () => {
    const meta = useMetaStore()!;
    appConfig = useConfigStore()!;
    text = useTextStore()!;
    ui = useUIStore()!;
    onMount(() => {
      batch(() => {
        meta.setMetas(metas);
        appConfig.setConfig(
          config({ buffer_render: bufferRender, synthesis_delay_ms: 0 }),
        );
        text.setProjectPresetStore([preset()]);
        text.replaceTextBlocks(
          [
            {
              id: "text-block",
              text: "hello",
              query: audioQuery(),
              query_is_modified: queryIsModified,
              preset_id: 0,
            },
            renderAllBlocks
              ? {
                  id: "second-text-block",
                  text: "second",
                  query: audioQuery(),
                  query_is_modified: false,
                  preset_id: 0,
                }
              : null,
          ].filter((block) => block !== null),
        );
      });
    });
    return renderAllBlocks ? (
      <For each={text.textStore}>
        {(_, index) => <TextBlock index={index()} />}
      </For>
    ) : (
      <TextBlock index={0} />
    );
  };
  const result = render(() => (
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
      <Harness />
    </MultiProvider>
  ));
  return {
    ...result,
    getTextStore: () => text,
    getConfigStore: () => appConfig,
    getUiStore: () => ui,
  };
};
