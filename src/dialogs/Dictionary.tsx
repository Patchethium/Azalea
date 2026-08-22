import {
  commands,
  type DictionaryEntry,
  type DictionaryEntryInput,
  type DictionaryWordType,
} from "$binding";
import { AppDialogContent } from "@dialogs/AppContent";
import { Dialog } from "@kobalte/core/dialog";
import { TextField } from "@kobalte/core/text-field";
import { OptionSelector, PresetNumField } from "@layout/sidebar/preset/Fields";
import { ListToolbar } from "@layout/sidebar/preset/Toolbar";
import { countJapaneseMoras, toHalfWidthAscii } from "$utils";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { createStore } from "solid-js/store";
import { usei18n } from "@contexts/i18n";
import { useTextStore } from "@contexts/text";

interface DictionaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const wordTypes: DictionaryWordType[] = [
  "PROPER_NOUN",
  "COMMON_NOUN",
  "VERB",
  "ADJECTIVE",
  "SUFFIX",
];

const emptyEntry = (): DictionaryEntryInput => ({
  surface: "",
  pronunciation: "",
  accent_type: 0,
  word_type: "PROPER_NOUN",
  priority: 5,
});

export function DictionaryDialog(props: DictionaryDialogProps) {
  const { t1, t2 } = usei18n()!;
  const { refreshGeneratedQueries } = useTextStore()!;
  const [entries, setEntries] = createSignal<DictionaryEntry[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [draft, setDraft] = createStore<DictionaryEntryInput>(emptyEntry());
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let requestRevision = 0;

  const selectedIndex = createMemo(() => {
    const id = selectedId();
    return id === null ? -1 : entries().findIndex((entry) => entry.id === id);
  });
  const moraCount = createMemo(() => countJapaneseMoras(draft.pronunciation));

  createEffect(() => {
    const maximum = moraCount();
    if (draft.accent_type > maximum) setDraft("accent_type", maximum);
  });

  const wordTypeLabel = (type: DictionaryWordType) => {
    switch (type) {
      case "PROPER_NOUN":
        return t1("dictionary.word_types.proper_noun");
      case "COMMON_NOUN":
        return t1("dictionary.word_types.common_noun");
      case "VERB":
        return t1("dictionary.word_types.verb");
      case "ADJECTIVE":
        return t1("dictionary.word_types.adjective");
      case "SUFFIX":
        return t1("dictionary.word_types.suffix");
    }
  };

  const selectEntry = (entry: DictionaryEntry) => {
    setSelectedId(entry.id);
    setDraft({
      surface: entry.surface,
      pronunciation: entry.pronunciation,
      accent_type: entry.accent_type,
      word_type: entry.word_type,
      priority: entry.priority,
    });
    setError(null);
  };

  const startNewEntry = () => {
    setSelectedId(null);
    setDraft(emptyEntry());
    setError(null);
  };

  const loadEntries = async () => {
    const revision = ++requestRevision;
    setLoading(true);
    setError(null);
    try {
      const result = await commands.getDictionaryEntries();
      if (revision !== requestRevision) return;
      if (result.status === "error") {
        console.error(result.error);
        setError(t1("dictionary.load_error"));
        return;
      }
      setEntries(result.data);
      if (result.data[0]) selectEntry(result.data[0]);
      else startNewEntry();
    } catch (loadError) {
      if (revision !== requestRevision) return;
      console.error(loadError);
      setError(t1("dictionary.load_error"));
    } finally {
      if (revision === requestRevision) setLoading(false);
    }
  };

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (open) void loadEntries();
        else requestRevision += 1;
      },
    ),
  );
  onCleanup(() => {
    requestRevision += 1;
  });

  const formValid = () =>
    draft.surface.trim().length > 0 && draft.pronunciation.trim().length > 0;

  const save = async () => {
    if (!formValid() || saving()) return;
    setSaving(true);
    setError(null);
    const entry = { ...draft };
    const id = selectedId();
    try {
      const result =
        id === null
          ? await commands.addDictionaryEntry(entry)
          : await commands.updateDictionaryEntry(id, entry);
      if (result.status === "error") {
        console.error(result.error);
        setError(t1("dictionary.operation_error"));
        return;
      }
      setEntries((current) => {
        const index = current.findIndex((item) => item.id === result.data.id);
        if (index === -1) return [...current, result.data];
        return current.map((item) =>
          item.id === result.data.id ? result.data : item,
        );
      });
      selectEntry(result.data);
      refreshGeneratedQueries();
    } catch (saveError) {
      console.error(saveError);
      setError(t1("dictionary.operation_error"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const id = selectedId();
    if (id === null || loading() || saving()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await commands.deleteDictionaryEntry(id);
      if (result.status === "error") {
        console.error(result.error);
        setError(t1("dictionary.operation_error"));
        return;
      }
      const remaining = entries().filter((entry) => entry.id !== id);
      setEntries(remaining);
      if (remaining[0]) selectEntry(remaining[0]);
      else startNewEntry();
      refreshGeneratedQueries();
    } catch (removeError) {
      console.error(removeError);
      setError(t1("dictionary.operation_error"));
    } finally {
      setSaving(false);
    }
  };

  const move = async (direction: -1 | 1) => {
    const id = selectedId();
    if (id === null || loading() || saving()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await commands.moveDictionaryEntry(id, direction);
      if (result.status === "error") {
        console.error(result.error);
        setError(t1("dictionary.operation_error"));
        return;
      }
      setEntries(result.data);
      refreshGeneratedQueries();
    } catch (moveError) {
      console.error(moveError);
      setError(t1("dictionary.operation_error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <AppDialogContent
        title={t1("dictionary.title")}
        closeLabel={t1("dictionary.close")}
        class="h-[min(80vh,36rem)] w-[min(94vw,50rem)]"
      >
        <div class="flex min-h-0 flex-1">
          <aside class="flex w-2/5 min-w-48 flex-col b-r b-slate-2 bg-slate-1 p3 dark:b-slate-6 dark:bg-slate-9">
            <h3 class="min-w-0 truncate font-semibold">
              {t1("dictionary.entries")}
            </h3>
            <ListToolbar
              class="my2"
              createLabel={t1("dictionary.add")}
              onCreate={startNewEntry}
              createDisabled={loading() || saving()}
              moveUpLabel={t1("dictionary.move_up")}
              onMoveUp={() => void move(-1)}
              moveUpDisabled={loading() || saving() || selectedIndex() <= 0}
              moveDownLabel={t1("dictionary.move_down")}
              onMoveDown={() => void move(1)}
              moveDownDisabled={
                loading() ||
                saving() ||
                selectedIndex() === -1 ||
                selectedIndex() === entries().length - 1
              }
              deleteLabel={t1("dictionary.delete")}
              onDelete={() => void remove()}
              deleteDisabled={loading() || saving() || selectedId() === null}
            />
            <div
              class="flex min-h-0 flex-1 flex-col gap1 overflow-y-auto"
              aria-label={t1("dictionary.entries")}
            >
              <Show
                when={!loading()}
                fallback={
                  <div class="flex flex-1 items-center justify-center text-sm text-slate-5">
                    {t1("dictionary.loading")}
                  </div>
                }
              >
                <Show
                  when={entries().length > 0}
                  fallback={
                    <div class="flex flex-1 items-center justify-center px2 text-center text-sm text-slate-5 dark:text-slate-4">
                      {t1("dictionary.empty")}
                    </div>
                  }
                >
                  <For each={entries()}>
                    {(entry) => (
                      <div class="p1 group" onClick={() => selectEntry(entry)}>
                        <div
                          class="items-start rounded-r-md p1 group-hover:bg-slate-2 dark:group-hover:bg-slate-7 overflow-hidden bg-white dark:bg-slate-8 border-l-2 border-slate-1 dark:border-slate-7
                          cursor-default select-none w-full min-h-[fit-content] group-active:bg-white dark:group-active:bg-slate-8 flex flex-col"
                          classList={{
                            "shadow-md group-hover:bg-white dark:group-hover:bg-slate-8 !border-primary-5":
                              selectedId() === entry.id,
                          }}
                        >
                          <div>{toHalfWidthAscii(entry.surface)}</div>
                          <div class="text-xs text-slate-5 flex flex-row items-center">
                            {entry.pronunciation}
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </Show>
            </div>
          </aside>

          <form
            class="flex min-w-0 flex-1 flex-col overflow-y-auto p4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <h3 class="mb4 font-semibold">
              {selectedId() === null
                ? t1("dictionary.new_entry")
                : t1("dictionary.edit_entry")}
            </h3>
            <fieldset
              class="flex flex-col gap3"
              disabled={loading() || saving()}
            >
              <TextField
                value={draft.surface}
                onChange={(value) => setDraft("surface", value)}
                class="flex flex-col gap1"
              >
                <TextField.Label class="text-sm font-medium">
                  {t1("dictionary.surface")}
                </TextField.Label>
                <TextField.Input
                  class="h-9 rounded-md b b-slate-2 bg-transparent px2 outline-none focus:b-primary-4 dark:b-slate-6"
                  placeholder={t1("dictionary.surface_placeholder")}
                />
              </TextField>
              <TextField
                value={draft.pronunciation}
                onChange={(value) => setDraft("pronunciation", value)}
                class="flex flex-col gap1"
              >
                <TextField.Label class="text-sm font-medium">
                  {t1("dictionary.pronunciation")}
                </TextField.Label>
                <TextField.Input
                  class="h-9 rounded-md b b-slate-2 bg-transparent px2 outline-none focus:b-primary-4 dark:b-slate-6"
                  placeholder={t1("dictionary.pronunciation_placeholder")}
                />
                <TextField.Description class="text-xs text-slate-5 dark:text-slate-4">
                  {t1("dictionary.pronunciation_hint")}
                </TextField.Description>
              </TextField>
              <OptionSelector
                name={t1("dictionary.word_type")}
                options={wordTypes}
                value={draft.word_type}
                getOptionLabel={(value) =>
                  wordTypeLabel(value as DictionaryWordType)
                }
                onChange={(value) =>
                  setDraft("word_type", value as DictionaryWordType)
                }
              />
              <div class="grid grid-cols-2 gap3">
                <PresetNumField
                  label={t1("dictionary.accent_type")}
                  value={draft.accent_type}
                  setValue={(value) => setDraft("accent_type", value)}
                  min={0}
                  max={moraCount()}
                  step={1}
                  description={t2("dictionary.accent_hint", {
                    count: moraCount(),
                  })}
                />
                <PresetNumField
                  label={t1("dictionary.priority")}
                  value={draft.priority}
                  setValue={(value) => setDraft("priority", value)}
                  min={0}
                  max={10}
                  step={1}
                  description={t1("dictionary.priority_hint")}
                />
              </div>
            </fieldset>

            <Show when={error()}>
              {(message) => (
                <div
                  role="alert"
                  class="mt3 text-sm text-red-6 dark:text-red-4"
                >
                  {message()}
                </div>
              )}
            </Show>
            <div class="flex-1" />
            <div class="mt4 flex justify-end gap2 b-t b-slate-2 pt3 dark:b-slate-6">
              <button
                type="submit"
                class="rounded-md bg-primary-5 px4 py2 text-white hover:bg-primary-6 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={loading() || saving() || !formValid()}
              >
                {saving() ? t1("dictionary.saving") : t1("dictionary.save")}
              </button>
            </div>
          </form>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}
