import {
  type AccentPhrase,
  commands,
  type DictionaryEntry,
  type DictionaryEntryInput,
  type DictionaryWordType,
  type Mora,
} from "$binding";
import { AppDialogContent } from "@dialogs/AppContent";
import { IconButton } from "@components/iconButton";
import { Dialog } from "@kobalte/core/dialog";
import { TextField } from "@kobalte/core/text-field";
import { AccentPhraseItem } from "@layout/bottomPanel/AccentPhraseItem";
import { OptionSelector, PresetNumField } from "@layout/sidebar/preset/Fields";
import { ListToolbar } from "@layout/sidebar/preset/Toolbar";
import { debounce } from "@solid-primitives/scheduled";
import { splitJapaneseMoras, toHalfWidthAscii } from "$utils";
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
import { useUIStore } from "@contexts/ui";

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

const DICTIONARY_AUTOSAVE_DELAY_MS = 300;

interface PendingAutosave {
  editorRevision: number;
  id: string | null;
  entry: DictionaryEntryInput;
}

export function DictionaryDialog(props: DictionaryDialogProps) {
  const { t1, t2 } = usei18n()!;
  const { refreshGeneratedQueries } = useTextStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const [entries, setEntries] = createSignal<DictionaryEntry[]>([]);
  const [draft, setDraft] = createStore<DictionaryEntryInput>(emptyEntry());
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [actionPending, setActionPending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let requestRevision = 0;
  let editorRevision = 0;
  let pendingAutosave: PendingAutosave | null = null;
  let autosaveReady = false;
  let autosaveRunning = false;

  const selectedId = () => uiStore.selectedDictionaryEntryId;
  const setSelectedId = (id: string | null) =>
    setUIStore("selectedDictionaryEntryId", id);

  const selectedIndex = createMemo(() => {
    const id = selectedId();
    return id === null ? -1 : entries().findIndex((entry) => entry.id === id);
  });
  const pronunciationMoras = createMemo<Mora[]>(() =>
    splitJapaneseMoras(draft.pronunciation).map((text) => ({
      text,
      consonant: null,
      consonant_length: null,
      vowel: "",
      vowel_length: 0,
      pitch: 0,
    })),
  );
  const moraCount = () => pronunciationMoras().length;
  const accentPhraseMoras = createMemo<Mora[]>(() => [
    ...pronunciationMoras(),
    {
      text: "ガ",
      consonant: null,
      consonant_length: null,
      vowel: "",
      vowel_length: 0,
      pitch: 0,
    },
  ]);
  const accentPhrase = createMemo<AccentPhrase>(() => ({
    moras: accentPhraseMoras(),
    accent:
      draft.accent_type === 0 ? accentPhraseMoras().length : draft.accent_type,
    pause_mora: null,
    is_interrogative: false,
  }));

  const validEntry = (entry: DictionaryEntryInput) =>
    entry.surface.trim().length > 0 && entry.pronunciation.trim().length > 0;

  const mergeEntry = (entry: DictionaryEntry) => {
    setEntries((current) => {
      const index = current.findIndex((item) => item.id === entry.id);
      if (index === -1) return [...current, entry];
      return current.map((item) => (item.id === entry.id ? entry : item));
    });
  };

  const assignCreatedEntryId = (revision: number, id: string) => {
    const pending = pendingAutosave;
    if (pending?.editorRevision === revision && pending.id === null) {
      pendingAutosave = { ...pending, id };
    }
  };

  async function drainAutosave() {
    if (autosaveRunning || !autosaveReady || pendingAutosave === null) return;
    autosaveRunning = true;
    try {
      while (autosaveReady && pendingAutosave !== null) {
        const request: PendingAutosave = pendingAutosave;
        pendingAutosave = null;
        autosaveReady = false;
        try {
          const result =
            request.id === null
              ? await commands.addDictionaryEntry(request.entry)
              : await commands.updateDictionaryEntry(request.id, request.entry);
          if (result.status === "error") {
            console.error(result.error);
            setError(t1("dictionary.operation_error"));
            continue;
          }
          mergeEntry(result.data);
          if (request.id === null) {
            assignCreatedEntryId(request.editorRevision, result.data.id);
            if (
              editorRevision === request.editorRevision &&
              selectedId() === null
            ) {
              setSelectedId(result.data.id);
            }
          }
          setError(null);
          refreshGeneratedQueries();
        } catch (saveError) {
          console.error(saveError);
          setError(t1("dictionary.operation_error"));
        }
      }
    } finally {
      autosaveRunning = false;
      if (pendingAutosave === null) setSaving(false);
      else if (autosaveReady) void drainAutosave();
    }
  }

  const scheduledAutosave = debounce(() => {
    autosaveReady = true;
    void drainAutosave();
  }, DICTIONARY_AUTOSAVE_DELAY_MS);

  const flushAutosave = () => {
    if (pendingAutosave === null) return;
    scheduledAutosave.clear();
    autosaveReady = true;
    void drainAutosave();
  };

  const queueAutosave = () => {
    const entry = { ...draft };
    if (!validEntry(entry)) {
      if (pendingAutosave?.editorRevision === editorRevision) {
        pendingAutosave = null;
        autosaveReady = false;
        scheduledAutosave.clear();
        if (!autosaveRunning) setSaving(false);
      }
      return;
    }
    pendingAutosave = {
      editorRevision,
      id: selectedId(),
      entry,
    };
    autosaveReady = false;
    setSaving(true);
    setError(null);
    scheduledAutosave();
  };

  const editDraft = (update: Partial<DictionaryEntryInput>) => {
    setDraft(update);
    queueAutosave();
  };

  createEffect(() => {
    const maximum = moraCount();
    if (draft.accent_type > maximum) editDraft({ accent_type: maximum });
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
    flushAutosave();
    editorRevision += 1;
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
    flushAutosave();
    editorRevision += 1;
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
      const rememberedEntry = result.data.find(
        (entry) => entry.id === selectedId(),
      );
      if (rememberedEntry) selectEntry(rememberedEntry);
      else if (result.data[0]) selectEntry(result.data[0]);
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
        else {
          flushAutosave();
          requestRevision += 1;
        }
      },
    ),
  );
  onCleanup(() => {
    scheduledAutosave.clear();
    pendingAutosave = null;
    requestRevision += 1;
    editorRevision += 1;
  });

  const remove = async () => {
    const id = selectedId();
    if (id === null || loading() || saving() || actionPending()) return;
    setActionPending(true);
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
      setActionPending(false);
    }
  };

  const move = async (direction: -1 | 1) => {
    const id = selectedId();
    if (id === null || loading() || saving() || actionPending()) return;
    setActionPending(true);
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
      setActionPending(false);
    }
  };

  const controlsBusy = () => loading() || saving() || actionPending();

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <AppDialogContent
        title={t1("dictionary.title")}
        closeLabel={t1("dictionary.close")}
        class="h-[min(80vh,36rem)] w-[min(94vw,50rem)]"
      >
        <div class="flex min-h-0 flex-1">
          <aside class="flex w-2/5 min-w-48 flex-col b-r b-slate-2 bg-slate-1 p3 dark:b-slate-6 dark:bg-slate-9">
            <ListToolbar
              class="mb2 !shadow-none b b-slate-2 dark:b-slate-6"
              createLabel={t1("dictionary.add")}
              onCreate={startNewEntry}
              createDisabled={controlsBusy()}
              moveUpLabel={t1("dictionary.move_up")}
              onMoveUp={() => void move(-1)}
              moveUpDisabled={controlsBusy() || selectedIndex() <= 0}
              moveDownLabel={t1("dictionary.move_down")}
              onMoveDown={() => void move(1)}
              moveDownDisabled={
                controlsBusy() ||
                selectedIndex() === -1 ||
                selectedIndex() === entries().length - 1
              }
              deleteLabel={t1("dictionary.delete")}
              onDelete={() => void remove()}
              deleteDisabled={controlsBusy() || selectedId() === null}
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
                          class="items-start rounded-r-md b b-slate-2 dark:b-slate-6 border-l-2 p1 pl3 group-hover:bg-slate-2 dark:group-hover:bg-slate-7 overflow-hidden bg-white dark:bg-slate-8
                          cursor-default select-none w-full min-h-[fit-content] group-active:bg-white dark:group-active:bg-slate-8 flex flex-col"
                          classList={{
                            "shadow-md group-hover:bg-white dark:group-hover:bg-slate-8 !border-t-transparent !border-r-transparent !border-b-transparent !border-l-primary-5":
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

          <div class="flex min-w-0 flex-1 flex-col overflow-y-auto p4">
            <fieldset
              class="flex flex-col gap3"
              disabled={loading() || actionPending()}
            >
              <TextField
                value={draft.surface}
                onChange={(value) => editDraft({ surface: value })}
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
                onChange={(value) => editDraft({ pronunciation: value })}
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
              <div class="grid grid-cols-2 gap3">
                <OptionSelector
                  name={t1("dictionary.word_type")}
                  options={wordTypes}
                  value={draft.word_type}
                  getOptionLabel={(value) =>
                    wordTypeLabel(value as DictionaryWordType)
                  }
                  onChange={(value) =>
                    editDraft({ word_type: value as DictionaryWordType })
                  }
                />
                <div class="mt-1">
                  <PresetNumField
                    label={t1("dictionary.priority")}
                    value={draft.priority}
                    setValue={(value) => editDraft({ priority: value })}
                    min={0}
                    max={10}
                    step={1}
                    info={t1("dictionary.priority_hint")}
                  />
                </div>
              </div>
              <div class="flex flex-col gap1">
                <div class="flex items-center gap1">
                  <span class="text-sm">{t1("dictionary.accent_type")}</span>
                  <IconButton
                    type="button"
                    icon="i-lucide:info"
                    label={t2("dictionary.accent_hint", {
                      count: moraCount(),
                    })}
                    size="xs"
                  />
                </div>
                <Show when={moraCount() > 0}>
                  <div class="h-32 overflow-x-auto overflow-y-hidden">
                    <div class="mx-auto h-full w-max min-w-20">
                      <AccentPhraseItem
                        mode="accent"
                        label={t1("dictionary.accent_type")}
                        phrase={accentPhrase()}
                        mutedMoraIndex={moraCount()}
                        setPhrase={(phrase) => {
                          const accentType =
                            phrase.accent === phrase.moras.length
                              ? 0
                              : phrase.accent;
                          editDraft({ accent_type: accentType });
                        }}
                      />
                    </div>
                  </div>
                </Show>
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
          </div>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}
