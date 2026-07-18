import { Dialog } from "@kobalte/core/dialog";
import { For, Show } from "solid-js";
import { usei18n } from "../contexts/i18n";
import { useSystemStore } from "../contexts/system";
import { AppDialogContent } from "./AppDialogContent";

export function ShortcutReferenceDialog() {
  const { t1 } = usei18n()!;
  const { systemStore } = useSystemStore()!;
  const primaryKey = () => (systemStore.os === "MacOS" ? "Cmd" : "Ctrl");
  const shortcuts = () => [
    { keys: [primaryKey(), "S"], action: t1("shortcuts.save_project") },
    { keys: [primaryKey(), "Enter"], action: t1("shortcuts.play_current") },
    { keys: ["Shift", "Enter"], action: t1("shortcuts.play_next") },
    { keys: [primaryKey(), "Space"], action: t1("shortcuts.stop_playback") },
  ];

  return (
    <Dialog>
      <Dialog.Trigger
        class="group size-8 p1 rounded-lg bg-white shadow-md hover:bg-blue-5 ui-expanded:bg-blue-5 transition-transform outline-none"
        title={t1("shortcuts.open")}
        aria-label={t1("shortcuts.open")}
      >
        <div class="i-lucide:keyboard bg-slate-8 size-full group-hover:bg-white ui-expanded:!bg-white" />
      </Dialog.Trigger>
      <AppDialogContent
        title={t1("shortcuts.title")}
        closeLabel={t1("shortcuts.close")}
        class="w-[min(90vw,30rem)]"
      >
        <div class="flex flex-col px4 py2">
          <For each={shortcuts()}>
            {(shortcut) => (
              <div class="flex items-center gap3 py3 b-b b-slate-2 last:b-b-0">
                <div class="flex items-center gap1 min-w-36">
                  <For each={shortcut.keys}>
                    {(key, index) => (
                      <>
                        <kbd class="min-w-7 px2 py1 text-center text-sm font-mono bg-slate-1 b b-slate-3 rounded shadow-sm">
                          {key}
                        </kbd>
                        <Show when={index() < shortcut.keys.length - 1}>
                          <span class="text-slate-5">+</span>
                        </Show>
                      </>
                    )}
                  </For>
                </div>
                <span>{shortcut.action}</span>
              </div>
            )}
          </For>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}
