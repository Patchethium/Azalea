import _ from "lodash";
import { For } from "solid-js";
import TextBlock from "../components/TextBlock";
import { useTextStore } from "../store/text";
import { BottomPanel } from "./BottomPanel";

function MainPage() {
  const { textStore } = useTextStore()!;

  return (
    <div class="flex flex-col w-full">
      <div class="h-auto flex-1 flex-grow w-full flex flex-col overflow-auto px5 pt-2">
        <For each={_.range(0, textStore.length, 1)}>
          {(i) => (
            <div>
              <TextBlock index={i} />
            </div>
          )}
        </For>
      </div>
      <div class="h-50 bg-white">
        <BottomPanel />
      </div>
    </div>
  );
}

export default MainPage;
