import { events } from "$binding";
import Resizable from "@corvu/resizable";
import ConfigPage from "@dialogs/config";
import InitPage from "@layout/InitPage";
import MainPage from "@layout/MainPage";
import Sidebar from "@layout/sidebar";
import { getCurrentWindow, Theme } from "@tauri-apps/api/window";
import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import style from "./app.module.css";
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_EDITOR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  PRIMARY_COLOR_PATTERN,
} from "$constants";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";
import { useTextStore } from "@contexts/text";
import { useUIStore } from "@contexts/ui";

function App() {
  const {
    config,
    setConfig,
    setConfigInitialized,
    coreInitializeResource,
    setRange,
    themeMode,
  } = useConfigStore()!;
  const { setMetas, availableStyleIds } = useMetaStore()!;
  const { t1 } = usei18n()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const { newProject } = useTextStore()!;

  const [initializing, setInitializing] = createSignal(true);
  const [windowWidth, setWindowWidth] = createSignal(window.innerWidth);
  const [systemTheme, setSystemTheme] = createSignal<Theme>(
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );

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

  onMount(() => {
    const updateWindowWidth = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", updateWindowWidth);
    onCleanup(() => window.removeEventListener("resize", updateWindowWidth));
  });

  onMount(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlistenTheme: (() => void) | undefined;

    const initializeSystemTheme = async () => {
      try {
        const unlisten = await appWindow.onThemeChanged(({ payload }) => {
          setSystemTheme(payload);
        });
        if (disposed) unlisten();
        else unlistenTheme = unlisten;
      } catch (error) {
        console.error("Failed to listen for system theme changes:", error);
      }
      try {
        const currentTheme = await appWindow.theme();
        if (!disposed && currentTheme !== null) setSystemTheme(currentTheme);
      } catch (error) {
        console.error("Failed to get the system theme:", error);
      }
    };

    void initializeSystemTheme();
    onCleanup(() => {
      disposed = true;
      unlistenTheme?.();
    });
  });

  createEffect(() => {
    const stylesReady = availableStyleIds().length > 0;
    if (!coreInitializeResource.loading && stylesReady) {
      // Project defaults read translations and metadata. Neither should become
      // an implicit reason to recreate the active project later.
      untrack(newProject);
    }
  });

  const sidebarPanelSizes = () => {
    const width = windowWidth();
    const configuredWidth =
      config.ui_config.side_width ?? DEFAULT_SIDEBAR_WIDTH;
    const sidebarWidth =
      configuredWidth === 0
        ? 0
        : Math.min(
            Math.max(configuredWidth, MIN_SIDEBAR_WIDTH),
            width - MIN_EDITOR_WIDTH,
          );
    const sidebarRatio = sidebarWidth / width;
    return [sidebarRatio, 1 - sidebarRatio];
  };

  createEffect(() => {
    const mode = themeMode();
    const useDarkTheme =
      mode === "Dark" || (mode === "System" && systemTheme() === "dark");
    document.documentElement.classList.toggle("dark", useDarkTheme);
  });

  createEffect(() => {
    const configuredColor =
      config.ui_config.primary_color ?? DEFAULT_PRIMARY_COLOR;
    const primaryColor = PRIMARY_COLOR_PATTERN.test(configuredColor)
      ? configuredColor
      : DEFAULT_PRIMARY_COLOR;
    document.documentElement.style.setProperty("--primary-color", primaryColor);
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
          <Resizable
            class={`absolute flex flex-row size-full ${style.canvas}`}
            sizes={sidebarPanelSizes()}
            onSizesChange={(sizes) => {
              const sideWidth = Math.round(sizes[0] * windowWidth());
              if (sideWidth !== config.ui_config.side_width) {
                setConfig("ui_config", "side_width", sideWidth);
              }
            }}
          >
            <Resizable.Panel
              class="min-w-0 overflow-hidden"
              minSize="175px"
              collapsible
              collapseThreshold={0.05}
            >
              <Sidebar />
            </Resizable.Panel>
            <Resizable.Handle
              aria-label="Resize Handle"
              class="group basis-2 bg-transparent py-3 flex items-center justify-center px-2px"
            >
              <div class="rounded transition-colors bg-transparent group-hover:bg-primary-5 group-active:bg-primary-5 h-full w-[1px]" />
            </Resizable.Handle>
            <Resizable.Panel class="w-full overflow-hidden" minSize="400px">
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
