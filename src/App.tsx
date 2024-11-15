import _ from "lodash";
import { Show, createResource, onMount } from "solid-js";
import { commands } from "./binding";
import InitDialog from "./layout/InitDialog";
import MainPage from "./layout/MainPage";
import { useConfigStore } from "./store/config";
import { useUIStore } from "./store/ui";

function App() {
  const { setConfig, setConfigInitialized } = useConfigStore()!;
  const { uiStore } = useUIStore()!;
  onMount(async () => {
    const res = await commands.initConfig();
    if (res.status === "ok") {
      setConfigInitialized(true);
      setConfig(res.data);
    } else {
      console.error("Failed to initialize config:", res.error);
    }
  });

  const [config, _] = createResource(commands.initConfig);

  return (
    <main class="absolute h-full w-full left-0 top-0 flex flex-row">
      <Show when={!config.loading} fallback={<div>Loading...</div>}>
        <Show when={!uiStore.coreInitialized}>
          <InitDialog />
        </Show>
        <Show when={uiStore.coreInitialized}>
          <MainPage />
        </Show>
      </Show>
    </main>
  );
}

export default App;
