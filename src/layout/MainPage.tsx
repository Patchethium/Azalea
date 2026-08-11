import TextBlock from "@components/textBlock";
import Resizable from "@corvu/resizable";
import { Button } from "@kobalte/core/button";
import { BottomPanel } from "@layout/bottomPanel";
import { For, Show } from "solid-js";
import { useConfigStore } from "../contexts/config";
import { usei18n } from "../contexts/i18n";
import { useTextStore } from "../contexts/text";

function MainPage() {
  const { textStore, createFirstTextBlock } = useTextStore()!;
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;

  return (
    <div class="flex flex-col size-full">
      <Resizable orientation="vertical" class="size-full">
        <Resizable.Panel
          class="h-full flex flex-col overflow-hidden ml0 mb0 mr2 mt1"
          initialSize={1.0 - (config.ui_config.bottom_ratio ?? 0.3)}
          minSize={0.3}
        >
          <div class="h-full w-full flex flex-col overflow-auto bg-transparent pl-1">
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
          </div>
        </Resizable.Panel>
        <Resizable.Handle
          aria-label="Resize Handle"
          class="group basis-2 px-[2px] bg-transparent pr-3 flex items-center justify-center"
        >
          <div class="size-full rounded transition-colors bg-transparent group-hover:bg-primary-5 group-active:bg-primary-5 h-[1px]" />
        </Resizable.Handle>
        <Resizable.Panel
          initialSize={config.ui_config.bottom_ratio ?? 0.3}
          onResize={(s) => setConfig("ui_config", "bottom_ratio", s)}
          minSize={0.2}
        >
          <div class="hfull bg-transparent p-2 pl-0 pt-0">
            <BottomPanel />
          </div>
        </Resizable.Panel>
      </Resizable>
    </div>
  );
}

export default MainPage;
