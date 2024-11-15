import { For, Show } from "solid-js";
import TextBlock from "../components/TextBlock";
import { useTextStore } from "../store/text";
import { useUIStore } from "../store/ui";
import { BottomPanel } from "./BottomPanel";

function MainPage() {
  const { uiStore } = useUIStore()!;
  const { textStore } = useTextStore()!;

  return (
    <div class="flex flex-col w-full">
      <div class="font-bold text-xl flex flex-row items-center p5 pb-0">
        <Show
          when={uiStore.coreInitialized}
          fallback={
            <div
              class="rounded-full mr1 w2 h2 bg-red-3"
              title="Core not Initialized"
            />
          }
        >
          <div
            class="rounded-full mr1 w2 h2 bg-green-4 cursor-help"
            title="Core Initialized"
          />
        </Show>
        Azalea
      </div>
      <div class="h-auto flex-1 flex-grow w-full overflow-auto px5 pt-2">
        <For each={Array.from({ length: textStore.length }, (_, i) => i)}>
          {(i) => (
            <div>
              <TextBlock index={i} />
            </div>
          )}
        </For>
      </div>
      <div class="h-40 bg-white">
        <BottomPanel />
      </div>
    </div>
  );
}

export default MainPage;
