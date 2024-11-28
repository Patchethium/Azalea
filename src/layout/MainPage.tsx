import Resizable from "@corvu/resizable";
import _ from "lodash";
import { For } from "solid-js";
import { BottomPanel } from "../components/BottomPanel";
import TextBlock from "../components/TextBlock";
import { useTextStore } from "../contexts/text";
function MainPage() {
  const { textStore } = useTextStore()!;

  return (
    <div class="flex flex-col size-full">
      <Resizable orientation="vertical" class="size-full">
        <Resizable.Panel
          class="h-full flex flex-col overflow-hidden p2 pl0 pb0"
          initialSize={0.7}
          minSize={0.3}
        >
          <div class="h-full flex-1 flex-grow w-full flex flex-col overflow-auto px-3 gap-4 bg-white rounded-md border border-slate-2">
            <div class="w-full h-3" />
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
        <Resizable.Panel initialSize={0.3} minSize={0.2}>
          <div class="hfull bg-transparent p-2 pl-0 pt-0">
            <BottomPanel />
          </div>
        </Resizable.Panel>
      </Resizable>
    </div>
  );
}

export default MainPage;
