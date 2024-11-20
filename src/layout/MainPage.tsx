import Resizable from "@corvu/resizable";
import _ from "lodash";
import { For } from "solid-js";
import { BottomPanel } from "../components/BottomPanel";
import TextBlock from "../components/TextBlock";
import { useTextStore } from "../store/text";
function MainPage() {
  const { textStore } = useTextStore()!;

  return (
    <div class="flex flex-col w-full h-full bg-slate-1">
      <Resizable orientation="vertical" class="size-full">
        <Resizable.Panel
          class="h-full flex flex-col overflow-hidden"
          initialSize={0.7}
          minSize={0.3}
        >
          <div class="h-full flex-1 flex-grow w-full flex flex-col overflow-auto p3 gap-1 ">
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
          class="group basis-2 px-[2px] bg-transparent px-3"
        >
          <div class="size-full rounded transition-colors bg-slate-3 group-hover:bg-blue-5 group-active:bg-blue-5 h-[1px]" />
        </Resizable.Handle>
        <Resizable.Panel initialSize={0.3} minSize={0.2}>
          <div class="hfull bg-transparent p-1 pt-0">
            <BottomPanel />
          </div>
        </Resizable.Panel>
      </Resizable>
    </div>
  );
}

export default MainPage;
