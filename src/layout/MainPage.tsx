import InitPage from "@layout/InitPage";
import { SpeakerPortraitPanel } from "@components/portrait";
import TextBlock from "@components/textBlock";
import Resizable from "@corvu/resizable";
import { Button } from "@kobalte/core/button";
import { BottomPanel } from "@layout/bottomPanel";
import { createMemo, For, Show } from "solid-js";
import {
  DEFAULT_BOTTOM_RATIO,
  DEFAULT_PORTRAIT_RATIO,
  MAX_PORTRAIT_RATIO,
  MIN_PORTRAIT_WIDTH,
} from "$constants";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";
import { findPresetById, findPresetStyle, useTextStore } from "@contexts/text";

function MainPage() {
  const {
    textStore,
    createFirstTextBlock,
    projectPresetStore,
    selectedTextBlock,
  } = useTextStore()!;
  const { config, setConfig, voicesReady } = useConfigStore()!;
  const { metas } = useMetaStore()!;
  const { t1, t2 } = usei18n()!;
  // The portrait follows the speaker and style of the selected block.
  const portraitIdentity = createMemo(() => {
    const preset = findPresetById(
      projectPresetStore,
      selectedTextBlock()?.preset_id,
    );
    return preset === null ? null : findPresetStyle(preset, metas);
  });
  const showPortrait = () =>
    voicesReady() && textStore.length > 0 && portraitIdentity() !== null;
  const editorPanelSizes = () => {
    if (!showPortrait()) return [1];
    const stored = config.ui.portrait_ratio ?? DEFAULT_PORTRAIT_RATIO;
    const ratio =
      Number.isFinite(stored) && stored >= 0 && stored <= MAX_PORTRAIT_RATIO
        ? stored
        : DEFAULT_PORTRAIT_RATIO;
    return [1 - ratio, ratio];
  };

  return (
    <div class="flex flex-col size-full">
      <Resizable orientation="vertical" class="size-full">
        <Resizable.Panel
          // The portrait panel reaches the window edge; text blocks keep a margin.
          class={`h-full flex flex-col overflow-hidden ml0 mb0 mt1 ${showPortrait() ? "mr0" : "mr2"}`}
          initialSize={1.0 - (config.ui.bottom_ratio ?? DEFAULT_BOTTOM_RATIO)}
          minSize={0.3}
        >
          <Resizable
            class="flex size-full min-h-0"
            sizes={editorPanelSizes()}
            onSizesChange={(sizes) => {
              // Sizes are controlled like the sidebar's: corvu's own
              // redistribution when a panel mounts or unmounts is ignored.
              const ratio = sizes[1];
              if (
                sizes.length === 2 &&
                Number.isFinite(ratio) &&
                ratio !== config.ui.portrait_ratio
              )
                setConfig("ui", "portrait_ratio", ratio);
            }}
          >
            <Resizable.Panel class="h-full min-w-0 flex flex-col overflow-auto bg-transparent pl-1">
              <Show when={voicesReady()} fallback={<InitPage />}>
                <Show
                  when={textStore.length > 0}
                  fallback={
                    <div class="size-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                      <div
                        aria-hidden="true"
                        class="i-lucide:file-plus-2 size-10 text-slate-4 dark:text-slate-5"
                      />
                      <div>
                        <h2 class="font-semibold">
                          {t1("text_block.empty_project.title")}
                        </h2>
                        <p class="mt-1 text-sm text-slate-5 dark:text-slate-4">
                          {t1("text_block.empty_project.description")}
                        </p>
                      </div>
                      <Button
                        type="button"
                        class="flex items-center gap-2 rounded-md bg-primary-5 px-3 py-2 text-white hover:bg-primary-6 active:bg-primary-7 focus-visible:(outline-solid outline-3 outline-primary-2)"
                        aria-label={t1("text_block.empty_project.create")}
                        onClick={createFirstTextBlock}
                      >
                        <div aria-hidden="true" class="i-lucide:plus size-4" />
                        {t1("text_block.empty_project.create")}
                      </Button>
                    </div>
                  }
                >
                  <div class="h-2 w-full" />
                  <For each={textStore}>
                    {(_, index) => (
                      <div>
                        <TextBlock index={index()} />
                      </div>
                    )}
                  </For>
                </Show>
              </Show>
            </Resizable.Panel>
            <Show when={showPortrait() && portraitIdentity()}>
              {(identity) => (
                <>
                  <Resizable.Handle
                    aria-label={t1("portrait.resize")}
                    class="group basis-2 bg-transparent py-3 flex items-center justify-center px-2px"
                  >
                    <div class="rounded transition-colors bg-transparent group-hover:bg-primary-5 group-active:bg-primary-5 h-full w-[1px]" />
                  </Resizable.Handle>
                  <Resizable.Panel
                    class="min-w-0 overflow-hidden"
                    minSize={`${MIN_PORTRAIT_WIDTH}px`}
                    maxSize={MAX_PORTRAIT_RATIO}
                    collapsible
                    collapseThreshold={0.05}
                  >
                    <SpeakerPortraitPanel
                      speakerUuid={identity().speaker.speaker_uuid}
                      styleId={identity().style.id}
                      speakerUuids={metas.map((meta) => meta.speaker_uuid)}
                      alt={t2("portrait.alt", {
                        name: identity().speaker.name,
                        style: identity().style.name,
                      })}
                      class="flex size-full items-center justify-center"
                    />
                  </Resizable.Panel>
                </>
              )}
            </Show>
          </Resizable>
        </Resizable.Panel>
        <Resizable.Handle
          aria-label="Resize Handle"
          class="group basis-2 px-[2px] bg-transparent pr-3 flex items-center justify-center"
        >
          <div class="size-full rounded transition-colors bg-transparent group-hover:bg-primary-5 group-active:bg-primary-5 h-[1px]" />
        </Resizable.Handle>
        <Resizable.Panel
          class="min-h-0 overflow-hidden"
          initialSize={config.ui.bottom_ratio ?? DEFAULT_BOTTOM_RATIO}
          onResize={(s) => setConfig("ui", "bottom_ratio", s)}
          minSize={0.2}
          collapsible
          collapseThreshold={0.05}
        >
          <div class="hfull bg-transparent p-2 pl-0 pt-0">
            <BottomPanel disabled={!voicesReady()} />
          </div>
        </Resizable.Panel>
      </Resizable>
    </div>
  );
}

export default MainPage;
