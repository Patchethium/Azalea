import { For, onMount } from "solid-js";
import TextBlock from "./components/TextBlock";
import useCoreInitialization from "./preload";
import { useTextStore } from "./store/text";
import _ from "lodash";

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
      <For each={_.range(0, textStore.length)}>
        {(i) => (
          <div>
            <TextBlock index={i} />
          </div>
        )}
      </For>
    </main>
  );
}

export default App;
