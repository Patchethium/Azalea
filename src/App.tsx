import _ from "lodash";
import { For, Show, onMount } from "solid-js";
import TextBlock from "./components/TextBlock";
import { BottomPanel } from "./layout/BottomPanel";
import { useConfigStore } from "./store/config";
import { useTextStore } from "./store/text";
import { useUIStore } from "./store/ui";
import { commands } from "./binding";
import InitDialog from "./layout/InitDialog";

function App() {
  const { textStore } = useTextStore()!;
  const { setConfig } = useConfigStore()!;
  const {uiStore} = useUIStore()!;
  onMount(async () => {
    const res = await commands.initConfig();
    if (res.status === "ok") {
      setConfig(res.data);
    } else {
      console.error("Failed to initialize config:", res.error);
    }
  });

  return (
    <main class="h-full w-full absolute left-0 right-0 flex flex-col">
      <Show when={!uiStore.coreInitialized}>
        {/* Below is the core setting dialog. */}
        <InitDialog />
      </Show>
      <Show when={uiStore.coreInitialized}>
        <div class="p3">
          <div class="font-bold text-xl">Azalea</div>
          <For each={Array.from({ length: textStore.length }, (_, i) => i)}>
            {(i) => (
              <div>
                <TextBlock index={i} />
              </div>
            )}
          </For>
          <BottomPanel />
        </div>
      </Show>
    </main>
  );
}

export default App;
