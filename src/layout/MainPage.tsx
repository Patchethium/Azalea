import Resizable from "@corvu/resizable";
import _ from "lodash";
import { For } from "solid-js";
import { BottomPanel } from "../components/BottomPanel";
import TextBlock from "../components/TextBlock";
import { useConfigStore } from "../contexts/config";
import { useTextStore } from "../contexts/text";
function MainPage() {
  const { textStore } = useTextStore()!;
  const { config, setConfig } = useConfigStore()!;

  return (
    <div class="flex flex-col size-full">
      <Resizable orientation="vertical" class="size-full">
        <Resizable.Panel
          class="h-full flex flex-col overflow-hidden ml0 mb0 mr2 mt1"
          initialSize={1.0 - (config.ui_config.bottom_ratio ?? 0.3)}
          minSize={0.3}
        >
          <div class="h-full w-full flex flex-col overflow-auto bg-transparent pl-1">
            <div class="h-2 w-full" />
            <For each={_.range(0, textStore.length, 1)}>
              {(i) => (
                <div>
                  <TextBlock index={i} />
                </div>
              )}
            </For>
          </div>
        </Resizable.Panel>
        <Resizable.Handle
          aria-label="Resize Handle"
          class="group basis-2 px-[2px] bg-transparent pr-3 flex items-center justify-center"
        >
          <div class="size-full rounded transition-colors bg-transparent group-hover:bg-blue-5 group-active:bg-blue-5 h-[1px]" />
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
