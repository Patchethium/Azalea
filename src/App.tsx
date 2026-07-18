import Resizable from "@corvu/resizable";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import style from "./app.module.css";
import { events } from "./binding";
import { useConfigStore } from "./contexts/config";
import { usei18n } from "./contexts/i18n";
import { useMetaStore } from "./contexts/meta";
import { useTextStore } from "./contexts/text";
import { useUIStore } from "./contexts/ui";
import ConfigPage from "./layout/ConfigPage";
import InitPage from "./layout/InitPage";
import MainPage from "./layout/MainPage";
import Sidebar from "./layout/Sidebar";

function App() {
  const {
    config,
    setConfig,
    setConfigInitialized,
    coreInitializeResource,
    setRange,
  } = useConfigStore()!;
  const { setMetas } = useMetaStore()!;
  const { t1 } = usei18n()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const { newProject } = useTextStore()!;

  const [initializing, setInitializing] = createSignal(true);

  onMount(async () => {
    const unlisten = await events.initializationEvent.listen(({ payload }) => {
      if (payload.error) {
        console.error("Failed to initialize application:", payload.error);
      }
      if (payload.config) {
        setUIStore("coreInitialized", payload.core_initialized);
        setRange(Object.fromEntries(payload.range));
        if (payload.metas) setMetas(payload.metas);
        setConfig(payload.config);
        setConfigInitialized(true);
      }
      setInitializing(false);
    });
    onCleanup(unlisten);
    await events.frontendReadyEvent.emit();
  });

  createEffect(() => {
    if (!coreInitializeResource.loading) {
      newProject();
    }
  });

  createEffect(() => {
    document.documentElement.classList.toggle(
      "dark",
      config.ui_config.dark_mode ?? false,
    );
  });

  return (
    <main class="absolute h-full w-full left-0 top-0 flex flex-row bg-slate-1 text-slate-9 dark:(bg-slate-9 text-slate-1)">
      <Show
        when={!initializing() && !coreInitializeResource.loading}
        fallback={
          <div class="size-full flex items-center justify-center text-2xl font-bold">
            {t1("loading")}
          </div>
        }
      >
        <Show when={!uiStore.coreInitialized}>
          <InitPage />
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
              <MainPage />
              <ConfigPage />
            </Resizable.Panel>
          </Resizable>
        </Show>
      </Show>
    </main>
  );
}

export default App;
