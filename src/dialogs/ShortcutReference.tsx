import { AppDialogContent } from "@dialogs/AppContent";
import { Dialog } from "@kobalte/core/dialog";
import { createSignal, For, Show } from "solid-js";
import { usei18n } from "@contexts/i18n";
import {
  type ResolvedKeyboardShortcut,
  type ShortcutAction,
  shortcutActions,
  useShortcutsStore,
} from "@contexts/shortcuts";

interface ShortcutReferenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutReferenceDialog(props: ShortcutReferenceDialogProps) {
  const { t1 } = usei18n()!;
  const {
    assignShortcut,
    formatShortcut,
    isDefaultShortcut,
    resetAllShortcuts,
    resetShortcut,
    shortcutFromKeyboardEvent,
  } = useShortcutsStore()!;
  const [recording, setRecording] = createSignal<ShortcutAction | null>(null);
  const [conflict, setConflict] = createSignal(false);

  const tryAssignShortcut = (
    action: ShortcutAction,
    shortcut: ResolvedKeyboardShortcut,
  ) => {
    const assigned = assignShortcut(action, shortcut);
    setConflict(!assigned);
    return assigned;
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

    const shortcut = shortcutFromKeyboardEvent(event);
    if (shortcut === null || !tryAssignShortcut(action, shortcut)) return;
    setRecording(null);
  };

  const resetAll = () => {
    resetAllShortcuts();
    setRecording(null);
    setConflict(false);
  };

  const resetEditor = () => {
    setRecording(null);
    setConflict(false);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) resetEditor();
        props.onOpenChange(open);
      }}
    >
      <AppDialogContent
        title={t1("shortcuts.title")}
        closeLabel={t1("shortcuts.close")}
        class="max-h-[80vh] w-[min(90vw,40rem)]"
      >
        <div class="min-h-0 flex-1 overflow-y-auto">
          <p class="px4 pt3 text-sm text-slate-5 dark:text-slate-4">
            {t1("shortcuts.instructions")}
          </p>
          <div class="px4 pt2">
            <For each={shortcutActions}>
              {(action) => {
                const keys = () => formatShortcut(action);
                return (
                  <div class="grid grid-cols-[minmax(12rem,3fr)_minmax(0,2fr)_2rem] items-center gap3 py3 b-b b-slate-2 dark:b-slate-6 last:b-b-0">
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
                      class="group h-9 min-w-0 grid grid-cols-[repeat(9,max-content)] items-center justify-center gap1 overflow-x-auto rounded-md bg-transparent px2 outline-none focus-visible:ring-2 focus-visible:ring-primary-2"
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
                              <kbd class="min-w-7 rounded-md bg-slate-1 px2 py1 text-center text-sm font-mono group-hover:text-primary-5 transition-colors dark:bg-slate-9">
                                {key}
                              </kbd>
                              <Show when={index() < keys().length - 1}>
                                <div
                                  aria-hidden="true"
                                  class="i-lucide:plus size-4 text-slate-5"
                                />
                              </Show>
                            </>
                          )}
                        </For>
                      </Show>
                    </button>
                    <span class="min-w-0 text-left">
                      {t1(`shortcuts.${action}`)}
                    </span>
                    <Show when={!isDefaultShortcut(action)}>
                      <button
                        type="button"
                        title={t1("shortcuts.reset")}
                        aria-label={t1("shortcuts.reset")}
                        onClick={() => setConflict(!resetShortcut(action))}
                        class="size-8 flex items-center justify-center rounded-md bg-transparent outline-none hover:bg-slate-1 focus-visible:(ring-2 ring-primary-2) dark:hover:bg-slate-7"
                      >
                        <div class="i-lucide:rotate-ccw size-4" />
                      </button>
                    </Show>
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
        </div>
        <div class="shrink-0 flex justify-end px4 py3 b-t b-slate-2 dark:b-slate-6">
          <button
            type="button"
            onClick={resetAll}
            class="h-8 rounded-md b b-slate-2 bg-transparent px3 text-sm outline-none hover:(bg-slate-1 dark:bg-slate-7) focus-visible:(b-primary-5 ring-2 ring-primary-2) dark:b-slate-6"
          >
            {t1("shortcuts.reset_all")}
          </button>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}
