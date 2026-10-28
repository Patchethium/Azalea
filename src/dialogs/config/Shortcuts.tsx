import { Tooltip } from "@components/tooltip";
import { Button } from "@kobalte/core/button";
import { Tabs } from "@kobalte/core/tabs";
import { createSignal, For, Show } from "solid-js";
import { usei18n } from "@contexts/i18n";
import {
  fixedShortcuts,
  type ResolvedKeyboardShortcut,
  type ShortcutAction,
  shortcutActions,
  useShortcutsStore,
} from "@contexts/shortcuts";

/** Configurable and fixed keyboard shortcuts, shown as a Config section. */
export function ShortcutSettings() {
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

  const triggerClass =
    "bg-transparent hover:bg-hover px-2 rounded-md outline-none select-none";

  return (
    <Tabs defaultValue="configurable" class="flex flex-col">
      <div class="flex items-center gap2 pt1">
        <Tabs.List class="relative flex flex-1 flex-row items-center pb1 outline-none select-none">
          <Tabs.Trigger value="configurable" class={triggerClass}>
            {t1("shortcuts.tab_configurable")}
          </Tabs.Trigger>
          <Tabs.Trigger value="fixed" class={triggerClass}>
            {t1("shortcuts.tab_fixed")}
          </Tabs.Trigger>
          <Tabs.Indicator class="bg-accent h-1px absolute motion-safe:transition-all bottom-0 left-0" />
        </Tabs.List>
        <Button
          type="button"
          onClick={resetAll}
          class="shrink-0 flex items-center gap1 rounded-md b b-border bg-transparent px2 py1 text-sm outline-none hover:b-accent hover:bg-accent hover:text-on-accent focus-visible:(ring-2 ring-focus-ring)"
        >
          <div aria-hidden="true" class="i-lucide:rotate-ccw size-4" />
          {t1("shortcuts.reset_all")}
        </Button>
      </div>
      <div>
        <Tabs.Content value="configurable" class="outline-none">
          <div>
            <p class="m0 px1 pt3 text-sm text-ink-subtle">
              {t1("shortcuts.instructions")}
            </p>
            <div class="px1 pt2">
              <For each={shortcutActions}>
                {(action) => {
                  const keys = () => formatShortcut(action);
                  return (
                    <div class="grid grid-cols-[minmax(12rem,3fr)_minmax(0,2fr)_2rem] items-center gap3 py3 b-b b-border last:b-b-0">
                      <button
                        type="button"
                        aria-label={`${t1(`shortcuts.${action}`)}: ${keys().join(
                          " + ",
                        )}`}
                        onClick={() => {
                          setRecording(action);
                          setConflict(false);
                        }}
                        onKeyDown={(event) => recordShortcut(action, event)}
                        onBlur={() => {
                          if (recording() === action) setRecording(null);
                        }}
                        class="group h-9 w-full min-w-0 grid grid-cols-[repeat(9,max-content)] items-center justify-center gap1 overflow-x-auto rounded-md bg-transparent px2 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring-soft"
                        classList={{
                          "ring-2 ring-focus-ring-soft": recording() === action,
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
                                <kbd class="min-w-7 rounded-md bg-canvas px2 py1 text-center text-sm font-mono group-hover:text-accent motion-safe:transition-colors">
                                  {key}
                                </kbd>
                                <Show when={index() < keys().length - 1}>
                                  <div
                                    aria-hidden="true"
                                    class="i-lucide:plus size-4 text-ink-subtle"
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
                        <Tooltip content={t1("shortcuts.reset")}>
                          <button
                            type="button"
                            aria-label={t1("shortcuts.reset")}
                            onClick={() => setConflict(!resetShortcut(action))}
                            class="size-8 flex items-center justify-center rounded-md bg-transparent outline-none hover:bg-hover focus-visible:(ring-2 ring-focus-ring-soft)"
                          >
                            <div class="i-lucide:rotate-ccw size-4" />
                          </button>
                        </Tooltip>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
            <Show when={conflict()}>
              <p class="m0 px1 pt2 text-sm text-danger-ink" role="alert">
                {t1("shortcuts.conflict")}
              </p>
            </Show>
          </div>
        </Tabs.Content>
        <Tabs.Content value="fixed" class="outline-none">
          <div>
            <p class="m0 px1 pt3 text-sm text-ink-subtle">
              {t1("shortcuts.fixed_hint")}
            </p>
            <div class="px1 pt2 select-none">
              <For each={fixedShortcuts}>
                {(shortcut) => (
                  <div class="grid grid-cols-[minmax(12rem,3fr)_minmax(0,2fr)_2rem] items-center gap3 py3 b-b b-border last:b-b-0">
                    <div class="h-9 flex items-center justify-center gap1">
                      <For each={shortcut.keys}>
                        {(key) => (
                          <kbd class="min-w-7 cursor-not-allowed rounded-md bg-canvas px2 py1 text-center text-sm font-mono opacity-60">
                            {key}
                          </kbd>
                        )}
                      </For>
                    </div>
                    <span class="min-w-0 text-left">
                      {t1(`shortcuts.${shortcut.label}`)}
                    </span>
                    <div />
                  </div>
                )}
              </For>
            </div>
          </div>
        </Tabs.Content>
      </div>
    </Tabs>
  );
}
