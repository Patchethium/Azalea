import Resizable from "@corvu/resizable";
import _ from "lodash";
import { Show, createResource, onMount } from "solid-js";
import { commands } from "./binding";
import ConfigPage from "./layout/ConfigPage";
import InitDialog from "./layout/InitDialog";
import MainPage from "./layout/MainPage";
import Sidebar from "./layout/Sidebar";
import { useConfigStore } from "./store/config";
import { useUIStore } from "./store/ui";

function App() {
  const { setConfig, setConfigInitialized, t1 } = useConfigStore()!;
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

  const [config_resource, _] = createResource(commands.initConfig);

  return (
    <main class="absolute h-full w-full left-0 top-0 flex flex-row bg-transparent">
      <Show
        when={!config_resource.loading}
        fallback={<div>{t1("main_page.loading")}</div>}
      >
        <Show when={!uiStore.coreInitialized}>
          <InitDialog />
        </Show>
        <Show when={uiStore.coreInitialized}>
          <Resizable class="absolute flex flex-row size-full bg-slate-1">
            <Resizable.Panel initialSize={0.15} minSize={0.1}>
              <Sidebar />
            </Resizable.Panel>
            <Resizable.Handle
              aria-label="Resize Handle"
              class="group basis-2 bg-transparent py-3 flex items-center justify-center px-2px"
            >
              <div class="rounded transition-colors bg-transparent group-hover:bg-blue-5 group-active:bg-blue-5 h-full w-[1px]" />
            </Resizable.Handle>
            <Resizable.Panel
              class="w-full overflow-hidden"
              initialSize={0.85}
              minSize={0.6}
            >
              <Show when={uiStore.page == null}>
                <MainPage />
              </Show>
              <Show when={uiStore.page === "config"}>
                <ConfigPage />
              </Show>
            </Resizable.Panel>
          </Resizable>
        </Show>
      </Show>
    </main>
  );
}

export default App;
