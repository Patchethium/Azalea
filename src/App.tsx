import { events, type TitlebarStyle } from "$binding";
import Resizable from "@corvu/resizable";
import ConfigPage from "@dialogs/config";
import { AppToastRegion, showWarningToast } from "@components/toast";
import { TitleBar } from "@components/titleBar";
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
  DEFAULT_TITLEBAR_STYLE,
  DEFAULT_LOCALE,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_EDITOR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  PRIMARY_COLOR_PATTERN,
} from "$constants";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";
import { useSystemStore } from "@contexts/system";
import { useTextStore } from "@contexts/text";
import { useUIStore } from "@contexts/ui";

function App() {
  const {
    config,
    setConfig,
    setDownloadedCore,
    setActiveSetupSource,
    setCoreError,
    configInitialized,
    setConfigInitialized,
    coreInitializeResource,
    setRange,
    themeMode,
    titlebarStyle,
  } = useConfigStore()!;
  const { setMetas, availableStyleIds } = useMetaStore()!;
  const { t1, t2 } = usei18n()!;
  const { systemStore } = useSystemStore()!;
  const { setUIStore } = useUIStore()!;
  const { newProject, isProjectDirty } = useTextStore()!;

  const [initializing, setInitializing] = createSignal(true);
  const [appliedTitlebarStyle, setAppliedTitlebarStyle] =
    createSignal<TitlebarStyle>(DEFAULT_TITLEBAR_STYLE);
  const [windowWidth, setWindowWidth] = createSignal(window.innerWidth);
  const [systemTheme, setSystemTheme] = createSignal<Theme>(
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );
  const appWindow = getCurrentWindow();
  let decorationRequest = 0;

  onMount(async () => {
    const unlisten = await events.initializationEvent.listen(({ payload }) => {
      if (payload.error) {
        console.error("Failed to initialize application:", payload.error);
      }
      setCoreError(payload.error);
      if (payload.config) {
        setActiveSetupSource(
          payload.active_setup_source ??
            payload.config.setup_source ??
            "ExistingInstallation",
        );
        if (payload.resolved_core?.setup_source === "Downloaded")
          setDownloadedCore(payload.resolved_core ?? null);
        setUIStore("coreInitialized", payload.core_initialized);
        setRange(Object.fromEntries(payload.range));
        if (payload.metas) setMetas(payload.metas);
        setConfig(payload.config);
        setConfigInitialized(true);
        if (payload.unsupported_system_locale) {
          showWarningToast(
            t2("toast.unsupported_system_locale", {
              locale: payload.unsupported_system_locale,
            }),
            t1("toast.close"),
          );
        }
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

  onMount(() => {
    const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };
    darkModeQuery.addEventListener("change", updateSystemTheme);
    onCleanup(() =>
      darkModeQuery.removeEventListener("change", updateSystemTheme),
    );
  });

  onMount(() => {
    let disposed = false;
    let unlistenClose: (() => void) | undefined;

    const initializeCloseListener = async () => {
      try {
        const unlisten = await appWindow.onCloseRequested((event) => {
          if (isProjectDirty()) {
            event.preventDefault();
            setUIStore("pendingProjectAction", "close");
          }
        });
        if (disposed) unlisten();
        else unlistenClose = unlisten;
      } catch (error) {
        console.error("Failed to listen for window close requests:", error);
      }
    };

    void initializeCloseListener();
    onCleanup(() => {
      disposed = true;
      unlistenClose?.();
    });
  });

  createEffect(() => {
    if (!configInitialized()) return;
    const titlebar = titlebarStyle();
    const request = ++decorationRequest;
    void appWindow
      .setDecorations(titlebar === "Native")
      .then(() => {
        if (request === decorationRequest) {
          setAppliedTitlebarStyle(titlebar);
        }
      })
      .catch((error) => {
        console.error("Failed to update window decorations:", error);
      });
  });
  onCleanup(() => {
    decorationRequest += 1;
  });

  let projectInitialized = false;
  createEffect(() => {
    const stylesReady = availableStyleIds().length > 0;
    if (!projectInitialized && !coreInitializeResource.loading && stylesReady) {
      projectInitialized = true;
      // Project defaults read translations and metadata. Neither should become
      // an implicit reason to recreate the active project later.
      untrack(newProject);
    }
  });

  const sidebarPanelSizes = () => {
    const width = windowWidth();
    const configuredWidth = config.ui.side_width ?? DEFAULT_SIDEBAR_WIDTH;
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
    const configuredColor = config.ui.primary_color ?? DEFAULT_PRIMARY_COLOR;
    const primaryColor = PRIMARY_COLOR_PATTERN.test(configuredColor)
      ? configuredColor
      : DEFAULT_PRIMARY_COLOR;
    document.documentElement.style.setProperty("--primary-color", primaryColor);
  });

  createEffect(() => {
    const locale = config.ui.locale ?? DEFAULT_LOCALE;
    document.documentElement.lang = {
      En: "en",
      Ja: "ja",
      ZhCn: "zh-CN",
    }[locale];
    document.documentElement.classList.toggle(
      "embedded-font",
      config.ui.embedded_font ?? false,
    );
  });

  return (
    <main
      class="absolute h-full w-full left-0 top-0 flex flex-col bg-slate-1 text-slate-9 dark:(bg-slate-9 text-slate-1)"
      classList={{
        [style.macOSCustomTitlebar]:
          appliedTitlebarStyle() === "Custom" && systemStore.os === "MacOS",
      }}
    >
      <Show when={appliedTitlebarStyle() === "Custom"}>
        <TitleBar />
      </Show>
      <div class="relative min-h-0 flex-1">
        <Show
          when={!initializing()}
          fallback={
            <div class="size-full flex items-center justify-center text-2xl font-bold">
              {t1("loading")}
            </div>
          }
        >
          <Resizable
            class={`absolute flex flex-row size-full ${style.canvas}`}
            sizes={sidebarPanelSizes()}
            onSizesChange={(sizes) => {
              const sideWidth = Math.round(sizes[0] * windowWidth());
              if (sideWidth !== config.ui.side_width) {
                setConfig("ui", "side_width", sideWidth);
              }
            }}
          >
            <Resizable.Panel
              class="min-w-0 overflow-hidden"
              minSize={`${MIN_SIDEBAR_WIDTH}px`}
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
      </div>
      <AppToastRegion />
    </main>
  );
}

export default App;
