import Resizable from "@corvu/resizable";
import { createResource, onMount, Show } from "solid-js";
import style from "./app.module.css";
import { commands } from "./binding";
import { useConfigStore } from "./contexts/config";
import { usei18n } from "./contexts/i18n";
import { useUIStore } from "./contexts/ui";
import ConfigPage from "./layout/ConfigPage";
import InitDialog from "./layout/InitDialog";
import MainPage from "./layout/MainPage";
import Sidebar from "./layout/Sidebar";

function App() {
  const { config, setConfig, setConfigInitialized, coreInitializeResource } =
    useConfigStore()!;
  const { t1 } = usei18n()!;
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
    <main class="absolute h-full w-full left-0 top-0 flex flex-row bg-slate-1">
      <Show
        when={!config_resource.loading && !coreInitializeResource.loading}
        fallback={
          <div class="size-full flex items-center justify-center text-2xl font-bold">
            {t1("main_page.loading")}
          </div>
        }
      >
        <Show when={!uiStore.coreInitialized}>
          <InitDialog />
        </Show>
        <Show when={uiStore.coreInitialized}>
          <Resizable class={`absolute flex flex-row size-full ${style.canvas}`}>
            <Resizable.Panel
              class="min-w-175px"
              initialSize={config.ui_config.side_ratio}
              minSize={0.1}
              onResize={(s) => setConfig("ui_config", "side_ratio", s)}
            >
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
              initialSize={1.0 - (config.ui_config.side_ratio ?? 0.5)}
              minSize={0.5}
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
