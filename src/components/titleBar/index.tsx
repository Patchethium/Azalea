import { getCurrentWindow } from "@tauri-apps/api/window";
import { usei18n } from "@contexts/i18n";

export function TitleBar() {
  const { t1 } = usei18n()!;
  const appWindow = getCurrentWindow();
  const runWindowAction = (name: string, action: () => Promise<void>) => {
    void action().catch((error) => {
      console.error(`Failed to ${name} the window:`, error);
    });
  };

  return (
    <header class="h-8 shrink-0 flex select-none bg-slate-2 text-slate-9 b-b b-slate-3 dark:(bg-slate-8 text-slate-1 b-slate-7)">
      <div
        data-tauri-drag-region
        class="min-w-0 flex-1 flex items-center px3 text-xs font-semibold"
      >
        <span data-tauri-drag-region class="truncate">
          Azalea
        </span>
      </div>
      <div class="flex shrink-0">
        <button
          type="button"
          aria-label={t1("titlebar.minimize")}
          title={t1("titlebar.minimize")}
          class="h-full w-11 flex items-center justify-center bg-transparent outline-none hover:bg-slate-3 focus-visible:bg-slate-3 dark:(hover:bg-slate-7 focus-visible:bg-slate-7)"
          onClick={() =>
            runWindowAction("minimize", () => appWindow.minimize())
          }
        >
          <span aria-hidden="true" class="i-lucide:minus size-4" />
        </button>
        <button
          type="button"
          aria-label={t1("titlebar.maximize")}
          title={t1("titlebar.maximize")}
          class="h-full w-11 flex items-center justify-center bg-transparent outline-none hover:bg-slate-3 focus-visible:bg-slate-3 dark:(hover:bg-slate-7 focus-visible:bg-slate-7)"
          onClick={() =>
            runWindowAction("maximize or restore", () =>
              appWindow.toggleMaximize(),
            )
          }
        >
          <span aria-hidden="true" class="i-lucide:square size-3.5" />
        </button>
        <button
          type="button"
          aria-label={t1("titlebar.close")}
          title={t1("titlebar.close")}
          class="h-full w-11 flex items-center justify-center bg-transparent outline-none hover:(bg-red-6 text-white) focus-visible:(bg-red-6 text-white)"
          onClick={() => runWindowAction("close", () => appWindow.close())}
        >
          <span aria-hidden="true" class="i-lucide:x size-4" />
        </button>
      </div>
    </header>
  );
}
