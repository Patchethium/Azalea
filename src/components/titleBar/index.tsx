import { Tooltip } from "@components/tooltip";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Show } from "solid-js";
import { usei18n } from "@contexts/i18n";
import { useTextStore } from "@contexts/text";

export function TitleBar() {
  const { t1 } = usei18n()!;
  const { isProjectDirty } = useTextStore()!;
  const appWindow = getCurrentWindow();
  const runWindowAction = (name: string, action: () => Promise<void>) => {
    void action().catch((error) => {
      console.error(`Failed to ${name} the window:`, error);
    });
  };

  return (
    <header class="h-8 shrink-0 flex select-none bg-surface-titlebar text-ink b-b b-border-titlebar">
      <div
        data-tauri-drag-region
        class="min-w-0 flex-1 flex items-center px3 text-xs font-semibold"
      >
        <span data-tauri-drag-region class="truncate">
          Azalea
        </span>
        <Show when={isProjectDirty()}>
          <Tooltip content={t1("titlebar.unsaved")}>
            <span
              data-tauri-drag-region
              role="status"
              aria-label={t1("titlebar.unsaved")}
              class="ml2 size-1.5 shrink-0 rounded-full bg-accent"
            />
          </Tooltip>
        </Show>
      </div>
      <div class="flex shrink-0">
        <Tooltip content={t1("titlebar.minimize")} class="h-full">
          <button
            type="button"
            aria-label={t1("titlebar.minimize")}
            class="h-full w-11 flex items-center justify-center bg-transparent outline-none hover:bg-hover-titlebar focus-visible:bg-hover-titlebar"
            onClick={() =>
              runWindowAction("minimize", () => appWindow.minimize())
            }
          >
            <span aria-hidden="true" class="i-lucide:minus size-4" />
          </button>
        </Tooltip>
        <Tooltip content={t1("titlebar.maximize")} class="h-full">
          <button
            type="button"
            aria-label={t1("titlebar.maximize")}
            class="h-full w-11 flex items-center justify-center bg-transparent outline-none hover:bg-hover-titlebar focus-visible:bg-hover-titlebar"
            onClick={() =>
              runWindowAction("maximize or restore", () =>
                appWindow.toggleMaximize(),
              )
            }
          >
            <span aria-hidden="true" class="i-lucide:square size-3.5" />
          </button>
        </Tooltip>
        <Tooltip content={t1("titlebar.close")} class="h-full">
          <button
            type="button"
            aria-label={t1("titlebar.close")}
            class="h-full w-11 flex items-center justify-center bg-transparent outline-none hover:(bg-danger-strong text-on-accent) focus-visible:(bg-danger-strong text-on-accent)"
            onClick={() => runWindowAction("close", () => appWindow.close())}
          >
            <span aria-hidden="true" class="i-lucide:x size-4" />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
