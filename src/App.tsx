import _ from "lodash";
import { For, onMount } from "solid-js";
import TextBlock from "./components/TextBlock";
import { BottomPanel } from "./layout/BottomPanel";
import useCoreInitialization from "./preload";
import { useTextStore } from "./store/text";

function App() {
  const { initializeCore } = useCoreInitialization();
  const { textStore } = useTextStore()!;
  onMount(async () => {
    await initializeCore();
    console.log(textStore.length);
  });

  return (
    <main class="h-full w-full absolute left-0 right-0 flex flex-col p3">
      <div class="font-bold text-xl">Azalea</div>
      <For each={Array.from({ length: textStore.length }, (_, i) => i)}>
        {(i) => (
          <div>
            <TextBlock index={i} />
          </div>
        )}
      </For>
      <BottomPanel />
    </main>
  );
}

export default App;
