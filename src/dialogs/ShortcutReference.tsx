import { AppDialogContent } from "@dialogs/AppContent";
import { Dialog } from "@kobalte/core/dialog";
import { createSignal, For, Show } from "solid-js";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { useSystemStore } from "@contexts/system";
import {
  defaultKeyboardShortcuts,
  formatShortcut,
  type ResolvedKeyboardShortcut,
  resolveShortcut,
  type ShortcutAction,
  shortcutActions,
  shortcutFromKeyboardEvent,
  shortcutSignature,
} from "../shortcuts";

export function ShortcutReferenceDialog() {
  const { t1 } = usei18n()!;
  const { config, setConfig } = useConfigStore()!;
  const { systemStore } = useSystemStore()!;
  const [recording, setRecording] = createSignal<ShortcutAction | null>(null);
  const [conflict, setConflict] = createSignal(false);

  const setShortcut = (
    action: ShortcutAction,
    shortcut: ResolvedKeyboardShortcut,
  ) => {
    setConfig("ui_config", "shortcuts", {
      ...config.ui_config.shortcuts,
      [action]: shortcut,
    });
  };

  const assignShortcut = (
    action: ShortcutAction,
    shortcut: ResolvedKeyboardShortcut,
  ) => {
    const duplicate = shortcutActions.some(
      (candidate) =>
        candidate !== action &&
        shortcutSignature(
          resolveShortcut(config.ui_config.shortcuts, candidate),
        ) === shortcutSignature(shortcut),
    );
    if (duplicate) {
      setConflict(true);
      return false;
    }
    setShortcut(action, shortcut);
    setConflict(false);
    return true;
  };

  const recordShortcut = (action: ShortcutAction, event: KeyboardEvent) => {
    if (recording() !== action) return;
    event.preventDefault();
    event.stopPropagation();
    if (
      event.key === "Escape" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      setRecording(null);
      setConflict(false);
      return;
    }

    const shortcut = shortcutFromKeyboardEvent(event, systemStore.os);
    if (shortcut === null || !assignShortcut(action, shortcut)) return;
    setRecording(null);
  };

  const resetAllShortcuts = () => {
    setConfig("ui_config", "shortcuts", { ...defaultKeyboardShortcuts });
    setRecording(null);
    setConflict(false);
  };

  const resetEditor = () => {
    setRecording(null);
    setConflict(false);
  };

  return (
    <Dialog onOpenChange={(open) => !open && resetEditor()}>
      <Dialog.Trigger
        class="group size-8 p1 rounded-lg bg-white dark:bg-slate-8 shadow-md hover:bg-primary-5 data-[expanded]:bg-primary-5 transition-transform outline-none"
        title={t1("shortcuts.open")}
        aria-label={t1("shortcuts.open")}
      >
        <div class="i-lucide:keyboard bg-slate-8 dark:bg-slate-1 size-full group-hover:bg-white group-data-[expanded]:!bg-white" />
      </Dialog.Trigger>
      <AppDialogContent
        title={t1("shortcuts.title")}
        closeLabel={t1("shortcuts.close")}
        class="w-[min(90vw,34rem)]"
      >
        <p class="px4 pt3 text-sm text-slate-5 dark:text-slate-4">
          {t1("shortcuts.instructions")}
        </p>
        <div class="flex flex-col px4 pt2">
          <For each={shortcutActions}>
            {(action) => {
              const shortcut = () =>
                resolveShortcut(config.ui_config.shortcuts, action);
              const keys = () => formatShortcut(shortcut(), systemStore.os);
              const isDefault = () =>
                shortcutSignature(shortcut()) ===
                shortcutSignature(defaultKeyboardShortcuts[action]);
              return (
                <div class="flex items-center gap3 py3 b-b b-slate-2 dark:b-slate-6 last:b-b-0">
                  <button
                    type="button"
                    aria-label={`${t1(`shortcuts.${action}`)}: ${keys().join(
                      " + ",
                    )}`}
                    title={t1("shortcuts.edit")}
                    onClick={() => {
                      setRecording(action);
                      setConflict(false);
                    }}
                    onKeyDown={(event) => recordShortcut(action, event)}
                    onBlur={() => {
                      if (recording() === action) setRecording(null);
                    }}
                    class="group min-w-40 h-9 flex items-center justify-center gap1 rounded-md bg-transparent px2 outline-none focus-visible:ring-2 focus-visible:ring-primary-2"
                    classList={{
                      "ring-2 ring-primary-2": recording() === action,
                    }}
                  >
                    <Show
                      when={recording() !== action}
                      fallback={
                        <span class="text-xs text-primary-7 dark:text-primary-3">
                          {t1("shortcuts.recording")}
                        </span>
                      }
                    >
                      <For each={keys()}>
                        {(key, index) => (
                          <>
                            <kbd class="min-w-7 px2 py1 text-center text-sm font-mono group-hover:text-primary-5 transition-colors">
                              {key}
                            </kbd>
                            <Show when={index() < keys().length - 1}>
                              <span class="text-slate-5">+</span>
                            </Show>
                          </>
                        )}
                      </For>
                    </Show>
                  </button>
                  <span class="flex-1">{t1(`shortcuts.${action}`)}</span>
                  <button
                    type="button"
                    disabled={isDefault()}
                    title={t1("shortcuts.reset")}
                    aria-label={t1("shortcuts.reset")}
                    onClick={() =>
                      assignShortcut(action, defaultKeyboardShortcuts[action])
                    }
                    class="size-8 shrink-0 flex items-center justify-center rounded-md bg-transparent outline-none hover:bg-slate-1 disabled:(cursor-not-allowed opacity-30) focus-visible:(ring-2 ring-primary-2) dark:hover:bg-slate-7"
                  >
                    <div class="i-lucide:rotate-ccw size-4" />
                  </button>
                </div>
              );
            }}
          </For>
        </div>
        <Show when={conflict()}>
          <p class="px4 pt2 text-sm text-red-6 dark:text-red-4" role="alert">
            {t1("shortcuts.conflict")}
          </p>
        </Show>
        <div class="flex justify-end px4 py3">
          <button
            type="button"
            onClick={resetAllShortcuts}
            class="h-8 rounded-md b b-slate-2 bg-transparent px3 text-sm outline-none hover:(bg-slate-1 dark:bg-slate-7) focus-visible:(b-primary-5 ring-2 ring-primary-2) dark:b-slate-6"
          >
            {t1("shortcuts.reset_all")}
          </button>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}
