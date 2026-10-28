import type { DictionaryEntry } from "$binding";
import { DictionaryDialog } from "@dialogs/Dictionary";
import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import userEvent from "@testing-library/user-event";
import { batch, type Component, createSignal, onMount } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { ConfigProvider } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider, useMetaStore } from "@contexts/meta";
import { TextProvider, useTextStore } from "@contexts/text";
import { UIProvider } from "@contexts/ui";
import { audioQuery, config, metas } from "../test/fixtures";

const existingEntry: DictionaryEntry = {
  id: "11111111-1111-4111-8111-111111111111",
  surface: "既存",
  pronunciation: "キソン",
  accent_type: 0,
  word_type: "COMMON_NOUN",
  priority: 5,
};

// Entries read as registered unless a test answers the reading check itself.
const mockDictionaryIPC: typeof mockIPC = (handler, options) =>
  mockIPC(
    (cmd, args) =>
      cmd === "dictionary_entry_conflicts" ? [] : handler(cmd, args),
    options,
  );

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

function renderDictionary(
  setup?: (text: NonNullable<ReturnType<typeof useTextStore>>) => void,
  speakers: typeof metas = [],
) {
  let text!: NonNullable<ReturnType<typeof useTextStore>>;
  const Harness: Component = () => {
    text = useTextStore()!;
    const meta = useMetaStore()!;
    onMount(() => {
      batch(() => {
        if (speakers.length > 0) meta.setMetas(speakers);
        text.replaceTextBlocks([
          {
            id: "generated",
            text: "generated",
            query: audioQuery(),
            pitch_noise_seed: 0,
            preset_id: null,
          },
          {
            id: "manual",
            text: "manual",
            query: audioQuery({ speedScale: 1.25 }),
            pitch_is_modified: true,
            pitch_noise_seed: 0,
            preset_id: null,
          },
        ]);
        setup?.(text);
      });
    });
    return <DictionaryDialog open onOpenChange={() => {}} />;
  };

  const result = render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, config()],
        [i18nProvider, null],
        [TextProvider, null],
      ]}
    >
      <Harness />
    </MultiProvider>
  ));
  return { ...result, getText: () => text };
}

const getAccentSlider = () =>
  screen
    .getAllByRole("slider", { name: "Accent position" })
    .find((element) => element.tagName === "SPAN")!;

describe("DictionaryDialog", () => {
  it("adds, edits, and deletes entries without refreshing existing queries", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const invocations: Array<{ cmd: string; args: Record<string, unknown> }> =
      [];
    let entries = [existingEntry];
    mockDictionaryIPC((cmd, args) => {
      invocations.push({ cmd, args: args as Record<string, unknown> });
      if (cmd === "get_dictionary_entries") return entries;
      if (cmd === "add_dictionary_entry") {
        const entry = (args as { entry: Omit<DictionaryEntry, "id"> }).entry;
        const added: DictionaryEntry = {
          ...entry,
          id: "22222222-2222-4222-8222-222222222222",
          surface: "Ａｚａｌｅａ",
        };
        entries = [...entries, added];
        return added;
      }
      if (cmd === "update_dictionary_entry") {
        const { id, entry } = args as {
          id: string;
          entry: Omit<DictionaryEntry, "id">;
        };
        const updated = { ...entry, id };
        entries = entries.map((item) => (item.id === id ? updated : item));
        return updated;
      }
      if (cmd === "move_dictionary_entry") {
        const { id, direction } = args as { id: string; direction: number };
        const from = entries.findIndex((item) => item.id === id);
        const to = from + direction;
        const [moved] = entries.splice(from, 1);
        entries.splice(to, 0, moved);
        entries = [...entries];
        return entries;
      }
      if (cmd === "delete_dictionary_entry") {
        const { id } = args as { id: string };
        entries = entries.filter((item) => item.id !== id);
        return null;
      }
      return null;
    });
    const dialog = renderDictionary();

    expect(
      await screen.findByRole("dialog", { name: "User Dictionary" }),
    ).toBeVisible();
    expect(await screen.findByDisplayValue("既存")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Dictionary entries").parentElement,
    ).toHaveClass("bg-canvas");
    expect(
      screen.getByLabelText("Dictionary entries").parentElement
        ?.firstElementChild,
    ).toHaveClass("!shadow-none", "b", "b-border");
    expect(screen.queryByText("Dictionary entries")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit word")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    const existingCard = screen.getByText("既存").parentElement;
    expect(existingCard).toHaveClass(
      "bg-surface",
      "group-hover:bg-surface",
      "!border-t-transparent",
      "!border-r-transparent",
      "!border-b-transparent",
      "!border-l-accent",
      "b",
      "b-border",
      "pl3",
      "shadow-md",
    );
    await user.click(screen.getByRole("button", { name: "Add word" }));

    await user.type(screen.getByRole("textbox", { name: "Word" }), "Azalea");
    await user.type(
      screen.getByRole("textbox", { name: "Pronunciation" }),
      "アザレア",
    );
    const wordType = screen.getByRole("button", {
      name: "Word type Proper noun",
    });
    wordType.focus();
    await user.keyboard("{ArrowDown}");
    const wordTypeList = await screen.findByRole("listbox", { hidden: true });
    expect(wordTypeList.parentElement).toHaveClass("z-popover");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(
      screen.getByRole("button", { name: "Word type Verb" }),
    ).toBeInTheDocument();
    const accentSlider = getAccentSlider();
    expect(accentSlider).toHaveAttribute("aria-valuemin", "1");
    expect(accentSlider).toHaveAttribute("aria-valuemax", "5");
    fireEvent.keyDown(accentSlider, { key: "ArrowLeft" });
    fireEvent.keyDown(accentSlider, { key: "ArrowLeft" });
    fireEvent.keyDown(accentSlider, { key: "ArrowLeft" });
    const priority = screen.getByRole("spinbutton", { name: "Priority" });
    const wordOptionsRow = wordType.closest(".grid");
    expect(wordOptionsRow).toHaveClass("grid-cols-2");
    expect(priority.closest(".grid")).toBe(wordOptionsRow);
    expect(priority.closest(".mt-1")).toBeInTheDocument();
    const accentInfo = screen.getByRole("button", {
      name: /0 is flat.*maximum: 4/,
    });
    const priorityInfo = screen.getByRole("button", {
      name: "Higher values take precedence (0–10).",
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    // The tooltip portals outside the modal dialog, whose hide-outside marks it
    // aria-hidden a frame after opening, so follow the trigger's description
    // link instead of racing that frame with a role query.
    const describedTooltip = (control: HTMLElement) => {
      const id = control
        .closest("[aria-describedby]")
        ?.getAttribute("aria-describedby");
      return id ? document.getElementById(id) : null;
    };
    accentInfo.focus();
    await waitFor(() =>
      expect(describedTooltip(accentInfo)).toHaveTextContent(
        /0 is flat.*maximum: 4/,
      ),
    );
    priorityInfo.focus();
    await waitFor(() =>
      expect(describedTooltip(priorityInfo)).toHaveTextContent(
        "Higher values take precedence (0–10).",
      ),
    );
    fireEvent.input(priority, {
      target: { value: "" },
    });
    expect(priority).toHaveValue("");
    fireEvent.input(priority, {
      target: { value: "8" },
    });
    // Autosave is debounced, so a slow run may create the entry before every
    // field is edited and send the rest as updates; check the latest save.
    const latestSave = () => {
      const saves = invocations.filter(
        ({ cmd }) =>
          cmd === "add_dictionary_entry" || cmd === "update_dictionary_entry",
      );
      return saves[saves.length - 1]?.args;
    };
    await waitFor(() =>
      expect(latestSave()).toMatchObject({
        entry: {
          surface: "Azalea",
          pronunciation: "アザレア",
          accent_type: 2,
          word_type: "VERB",
          priority: 8,
        },
      }),
    );
    expect(
      invocations.filter(({ cmd }) => cmd === "add_dictionary_entry"),
    ).toHaveLength(1);
    // Existing blocks keep their readings; only blocks read later use the entry.
    expect(dialog.getText().textStore[0].query).toEqual(audioQuery());
    expect(dialog.getText().textStore[1]).toMatchObject({
      pitch_is_modified: true,
      pitch_noise_seed: 0,
      query: { speedScale: 1.25 },
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Move word up" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Move word up" }));
    await waitFor(() =>
      expect(
        invocations.filter(({ cmd }) => cmd === "move_dictionary_entry"),
      ).toHaveLength(1),
    );
    expect(
      [...screen.getByLabelText("Dictionary entries").children].map(
        (entry) => entry.textContent,
      ),
    ).toEqual(["Azaleaアザレア", "既存キソン"]);
    expect(screen.getByRole("button", { name: "Move word up" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move word down" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Move word down" }));
    await waitFor(() =>
      expect(
        invocations.filter(({ cmd }) => cmd === "move_dictionary_entry"),
      ).toHaveLength(2),
    );
    expect(
      [...screen.getByLabelText("Dictionary entries").children].map(
        (entry) => entry.textContent,
      ),
    ).toEqual(["既存キソン", "Azaleaアザレア"]);

    await user.click(screen.getByText("既存"));
    expect(screen.getByRole("textbox", { name: "Word" })).toHaveValue("既存");
    await user.click(screen.getByText("Azalea"));

    const word = screen.getByRole("textbox", { name: "Word" });
    await user.clear(word);
    await user.type(word, "Updated");
    await waitFor(() =>
      expect(latestSave()).toMatchObject({
        id: "22222222-2222-4222-8222-222222222222",
        entry: { surface: "Updated" },
      }),
    );
    expect(screen.getByRole("textbox", { name: "Word" })).toHaveValue(
      "Updated",
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete word" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Delete word" }));
    await waitFor(() =>
      expect(
        invocations.filter(({ cmd }) => cmd === "delete_dictionary_entry"),
      ).toHaveLength(1),
    );
    expect(screen.queryByText("Updated")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Word" })).toHaveValue("既存");

    await user.click(screen.getByRole("button", { name: "Delete word" }));
    await waitFor(() =>
      expect(
        invocations.filter(({ cmd }) => cmd === "delete_dictionary_entry"),
      ).toHaveLength(2),
    );
    expect(
      screen.getByText("No words have been registered yet."),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Word" })).toHaveValue("");
  });

  it("clamps the accent position to the pronunciation's mora count", async () => {
    mockDictionaryIPC((cmd) => {
      if (cmd === "get_dictionary_entries") return [];
      return null;
    });
    renderDictionary();

    expect(
      await screen.findByText("No words have been registered yet."),
    ).toBeVisible();
    const pronunciation = screen.getByRole("textbox", {
      name: "Pronunciation",
    });
    fireEvent.input(pronunciation, { target: { value: "アザレア" } });
    const accent = getAccentSlider();
    expect(accent).toHaveAttribute("aria-valuemin", "1");
    expect(accent).toHaveAttribute("aria-valuemax", "5");
    expect(accent).toHaveAttribute("aria-valuenow", "5");
    const accentContainer = accent.closest(".h-32")!;
    expect(accentContainer).toHaveClass("overflow-y-hidden");
    expect(accentContainer.firstElementChild).toHaveClass("mx-auto");
    const firstMoraAtFlatAccent = screen.getAllByText("ア")[0];
    const appendedMora = screen.getByText("ガ");
    expect(appendedMora).toHaveClass("text-ink-subtle");
    expect(firstMoraAtFlatAccent).toHaveClass("mt-10");
    expect(appendedMora).toHaveClass("mb-10");

    for (let index = 0; index < 4; index += 1) {
      fireEvent.keyDown(accent, { key: "ArrowLeft" });
    }
    await waitFor(() => expect(accent).toHaveAttribute("aria-valuenow", "1"));
    expect(firstMoraAtFlatAccent).toHaveClass("mb-10");
    expect(appendedMora).toHaveClass("mt-10");
    for (let index = 0; index < 4; index += 1) {
      fireEvent.keyDown(accent, { key: "ArrowRight" });
    }
    await waitFor(() => expect(accent).toHaveAttribute("aria-valuenow", "5"));
    expect(firstMoraAtFlatAccent).toHaveClass("mt-10");
    expect(appendedMora).toHaveClass("mb-10");
    fireEvent.keyDown(accent, { key: "ArrowLeft" });
    await waitFor(() => expect(accent).toHaveAttribute("aria-valuenow", "4"));

    fireEvent.input(pronunciation, { target: { value: "キャット" } });

    await waitFor(() =>
      expect(getAccentSlider()).toHaveAttribute("aria-valuenow", "3"),
    );
    expect(getAccentSlider()).toHaveAttribute("aria-valuemax", "4");
    const firstMora = screen.getByText("キャ");
    expect(firstMora).toHaveClass("cursor-default", "select-none");
    expect(screen.getByText("ッ")).toBeInTheDocument();
    expect(screen.getByText("ト")).toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    fireEvent.mouseEnter(firstMora);
    fireEvent.mouseLeave(firstMora);
    fireEvent.click(firstMora);
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    const connection = screen.getAllByLabelText("Accent connection line")[0];
    expect(connection.parentElement).not.toHaveClass("cursor-pointer");
    fireEvent.mouseEnter(connection.parentElement!);
    fireEvent.mouseLeave(connection.parentElement!);
    fireEvent.click(connection.parentElement!);
    expect(screen.getAllByLabelText("Accent connection line")).toHaveLength(3);
    expect(
      screen.getByRole("button", {
        name: /pitch falls \(maximum: 3\)/,
      }),
    ).toBeInTheDocument();
  });

  it("keeps the latest draft while the first autosave creates an entry", async () => {
    const creation = deferred<DictionaryEntry>();
    let addedInput: Omit<DictionaryEntry, "id"> | undefined;
    const updates: Array<{
      id: string;
      entry: Omit<DictionaryEntry, "id">;
    }> = [];
    mockDictionaryIPC((cmd, args) => {
      if (cmd === "get_dictionary_entries") return [];
      if (cmd === "add_dictionary_entry") {
        addedInput = (args as { entry: Omit<DictionaryEntry, "id"> }).entry;
        return creation.promise;
      }
      if (cmd === "update_dictionary_entry") {
        const update = args as {
          id: string;
          entry: Omit<DictionaryEntry, "id">;
        };
        updates.push(update);
        return { ...update.entry, id: update.id };
      }
      return null;
    });
    renderDictionary();

    expect(
      await screen.findByText("No words have been registered yet."),
    ).toBeVisible();
    fireEvent.input(screen.getByRole("textbox", { name: "Word" }), {
      target: { value: "Azalea" },
    });
    fireEvent.input(screen.getByRole("textbox", { name: "Pronunciation" }), {
      target: { value: "アザレア" },
    });
    await waitFor(() => expect(addedInput).toBeDefined());

    fireEvent.input(screen.getByRole("textbox", { name: "Word" }), {
      target: { value: "Azalea Bloom" },
    });
    creation.resolve({
      ...addedInput!,
      id: "55555555-5555-4555-8555-555555555555",
      surface: "Ａｚａｌｅａ",
    });

    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({
      id: "55555555-5555-4555-8555-555555555555",
      entry: { surface: "Azalea Bloom", pronunciation: "アザレア" },
    });
    expect(screen.getByRole("textbox", { name: "Word" })).toHaveValue(
      "Azalea Bloom",
    );
  });

  it("cancels a queued autosave when the draft becomes incomplete", async () => {
    let updateCalls = 0;
    mockDictionaryIPC((cmd) => {
      if (cmd === "get_dictionary_entries") return [existingEntry];
      if (cmd === "update_dictionary_entry") updateCalls += 1;
      return null;
    });
    renderDictionary();

    expect(await screen.findByDisplayValue("既存")).toBeInTheDocument();
    fireEvent.input(screen.getByRole("textbox", { name: "Word" }), {
      target: { value: "Changed" },
    });
    fireEvent.input(screen.getByRole("textbox", { name: "Pronunciation" }), {
      target: { value: "" },
    });

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(updateCalls).toBe(0);
  });

  it("reports load and validation failures without discarding the editor", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockDictionaryIPC((cmd) => {
      if (cmd === "get_dictionary_entries") throw "load failed";
      return null;
    });
    const rejected = renderDictionary();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load the user dictionary.",
    );
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    rejected.unmount();

    mockDictionaryIPC((cmd) => {
      if (cmd === "get_dictionary_entries") throw new Error("transport failed");
      return null;
    });
    renderDictionary();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load the user dictionary.",
    );
  });

  it("keeps entries editable when mutation requests fail", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    let updateCalls = 0;
    let moveCalls = 0;
    let deleteCalls = 0;
    mockDictionaryIPC((cmd) => {
      if (cmd === "get_dictionary_entries") {
        return [
          existingEntry,
          {
            ...existingEntry,
            id: "33333333-3333-4333-8333-333333333333",
            surface: "別の単語",
          },
        ];
      }
      if (cmd === "update_dictionary_entry") {
        updateCalls += 1;
        if (updateCalls === 1) throw "validation failed";
        throw new Error("transport failed");
      }
      if (cmd === "delete_dictionary_entry") {
        deleteCalls += 1;
        if (deleteCalls === 1) throw "delete failed";
        throw new Error("transport failed");
      }
      if (cmd === "move_dictionary_entry") {
        moveCalls += 1;
        if (moveCalls === 1) throw "move failed";
        throw new Error("transport failed");
      }
      return null;
    });
    renderDictionary();

    expect(await screen.findByDisplayValue("既存")).toBeInTheDocument();
    fireEvent.input(screen.getByRole("textbox", { name: "Word" }), {
      target: { value: "Changed" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't save the dictionary entry.",
    );
    fireEvent.input(screen.getByRole("textbox", { name: "Word" }), {
      target: { value: "Changed again" },
    });
    await waitFor(() => expect(updateCalls).toBe(2));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Move word down" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Move word down" }));
    await waitFor(() => expect(moveCalls).toBe(1));
    expect(screen.getByDisplayValue("Changed again")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Move word down" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Move word down" }));
    await waitFor(() => expect(moveCalls).toBe(2));
    expect(screen.getByDisplayValue("Changed again")).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete word" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Delete word" }));
    await waitFor(() => expect(deleteCalls).toBe(1));
    expect(screen.getByDisplayValue("Changed again")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete word" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Delete word" }));
    await waitFor(() => expect(deleteCalls).toBe(2));
    expect(screen.getByDisplayValue("Changed again")).toBeInTheDocument();
  });

  it("restores the last selected entry and falls back when it is unavailable", async () => {
    const rememberedEntry = {
      ...existingEntry,
      id: "66666666-6666-4666-8666-666666666666",
      surface: "別の単語",
    };
    let availableEntries = [existingEntry, rememberedEntry];
    let loadCalls = 0;
    mockDictionaryIPC((cmd) => {
      if (cmd !== "get_dictionary_entries") return null;
      loadCalls += 1;
      return availableEntries;
    });
    let setOpen!: (open: boolean) => void;
    const Harness: Component = () => {
      const [open, setDialogOpen] = createSignal(true);
      setOpen = setDialogOpen;
      return <DictionaryDialog open={open()} onOpenChange={setDialogOpen} />;
    };
    render(() => (
      <MultiProvider
        values={[
          [MetaProvider, []],
          [UIProvider, null],
          [ConfigProvider, config()],
          [i18nProvider, null],
          [TextProvider, null],
        ]}
      >
        <Harness />
      </MultiProvider>
    ));

    expect(await screen.findByDisplayValue("既存")).toBeInTheDocument();
    fireEvent.click(screen.getByText("別の単語"));
    expect(screen.getByRole("textbox", { name: "Word" })).toHaveValue(
      "別の単語",
    );

    setOpen(false);
    availableEntries = [
      existingEntry,
      { ...rememberedEntry, surface: "記憶した単語" },
    ];
    setOpen(true);
    await waitFor(() => expect(loadCalls).toBe(2));
    expect(await screen.findByDisplayValue("記憶した単語")).toBeInTheDocument();

    setOpen(false);
    availableEntries = [existingEntry];
    setOpen(true);
    await waitFor(() => expect(loadCalls).toBe(3));
    expect(await screen.findByDisplayValue("既存")).toBeInTheDocument();
  });

  it("ignores a stale load after the dialog is closed and reopened", async () => {
    const firstLoad = deferred<DictionaryEntry[]>();
    const freshEntry = {
      ...existingEntry,
      id: "44444444-4444-4444-8444-444444444444",
      surface: "最新",
      pronunciation: "サイシン",
    };
    let loadCalls = 0;
    mockDictionaryIPC((cmd) => {
      if (cmd !== "get_dictionary_entries") return null;
      loadCalls += 1;
      return loadCalls === 1 ? firstLoad.promise : [freshEntry];
    });
    let setOpen!: (open: boolean) => void;
    const Harness: Component = () => {
      const [open, setDialogOpen] = createSignal(true);
      setOpen = setDialogOpen;
      return <DictionaryDialog open={open()} onOpenChange={setDialogOpen} />;
    };
    render(() => (
      <MultiProvider
        values={[
          [MetaProvider, []],
          [UIProvider, null],
          [ConfigProvider, config()],
          [i18nProvider, null],
          [TextProvider, null],
        ]}
      >
        <Harness />
      </MultiProvider>
    ));

    await waitFor(() => expect(loadCalls).toBe(1));
    setOpen(false);
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "User Dictionary" }),
      ).toHaveAttribute("data-closed"),
    );
    setOpen(true);
    expect(await screen.findByDisplayValue("最新")).toBeInTheDocument();

    firstLoad.resolve([existingEntry]);
    await Promise.resolve();
    expect(screen.getByDisplayValue("最新")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("既存")).not.toBeInTheDocument();
  });

  it("speaks the draft with the chosen preview style and stops it", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const previews: Array<Record<string, unknown>> = [];
    const plays: Array<Record<string, unknown>> = [];
    let stops = 0;
    mockDictionaryIPC(
      (cmd, args) => {
        if (cmd === "get_dictionary_entries") return [existingEntry];
        if (cmd === "dictionary_preview_query") {
          previews.push(args as Record<string, unknown>);
          return audioQuery();
        }
        if (cmd === "play_audio") {
          plays.push(args as Record<string, unknown>);
          return null;
        }
        if (cmd === "stop_audio") stops += 1;
        return null;
      },
      { shouldMockEvents: true },
    );
    renderDictionary(undefined, metas);
    expect(await screen.findByDisplayValue("既存")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Preview style / }));
    await user.click(
      await screen.findByRole("option", { name: "Normal", hidden: true }),
    );
    expect(
      screen.getByRole("button", { name: "Preview style Normal" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preview speaker Speaker" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Play pronunciation" }),
    );
    await waitFor(() => expect(plays).toHaveLength(1));
    expect(previews).toEqual([
      { pronunciation: "キソン", accentType: 0, speakerId: 1 },
    ]);
    expect(plays[0]).toMatchObject({ speakerId: 1, post: null });

    await user.click(
      await screen.findByRole("button", { name: "Stop playback" }),
    );
    expect(stops).toBe(1);
    expect(
      await screen.findByRole("button", { name: "Play pronunciation" }),
    ).toBeEnabled();

    await user.click(
      screen.getByRole("button", { name: "Play pronunciation" }),
    );
    await screen.findByRole("button", { name: "Stop playback" });
    await emit("audio-playback-finished");
    expect(
      await screen.findByRole("button", { name: "Play pronunciation" }),
    ).toBeEnabled();
  });

  it("disables the preview for non-katakana drafts and reports failures", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    let failPreview = true;
    mockDictionaryIPC(
      (cmd) => {
        if (cmd === "get_dictionary_entries") return [existingEntry];
        if (cmd === "dictionary_preview_query") {
          if (failPreview) throw "kana parse failed";
          return audioQuery();
        }
        if (cmd === "play_audio") throw "playback failed";
        return null;
      },
      { shouldMockEvents: true },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderDictionary(undefined, metas);
    expect(await screen.findByDisplayValue("既存")).toBeInTheDocument();
    const play = screen.getByRole("button", { name: "Play pronunciation" });

    await user.click(play);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't play the pronunciation.",
    );

    failPreview = false;
    await user.click(play);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Couldn't play the pronunciation.",
      ),
    );
    expect(play).toBeEnabled();

    const pronunciation = screen.getByRole("textbox", {
      name: "Pronunciation",
    });
    await user.clear(pronunciation);
    await user.type(pronunciation, "きそん");
    expect(play).toBeDisabled();
    vi.restoreAllMocks();
  });

  it("disables the preview when no speaker is available", async () => {
    mockDictionaryIPC((cmd) => (cmd === "get_dictionary_entries" ? [] : null), {
      shouldMockEvents: true,
    });
    renderDictionary();
    await screen.findByText("No words have been registered yet.");
    expect(
      screen.getByRole("button", { name: "Play pronunciation" }),
    ).toBeDisabled();
  });

  it("warns when sentences keep the built-in reading until the priority wins", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const otherEntry: DictionaryEntry = {
      ...existingEntry,
      id: "55555555-5555-4555-8555-555555555555",
      surface: "Ａｚａｌｅａ",
      pronunciation: "アザレア",
    };
    let entries = [existingEntry, otherEntry];
    const staleCheck = deferred<string[]>();
    let failCheck = false;
    const checks: string[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "get_dictionary_entries") return entries;
      if (cmd === "update_dictionary_entry") {
        const { id, entry } = args as {
          id: string;
          entry: Omit<DictionaryEntry, "id">;
        };
        const updated = { ...entry, id };
        entries = entries.map((item) => (item.id === id ? updated : item));
        return updated;
      }
      if (cmd === "dictionary_entry_conflicts") {
        const { id } = args as { id: string };
        checks.push(id);
        if (failCheck) throw "analysis failed";
        if (id === otherEntry.id) return staleCheck.promise;
        const priority = entries.find((entry) => entry.id === id)!.priority;
        return priority >= 8 ? [] : ["既存は", "既存を", "既存に", "既存の"];
      }
      return null;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderDictionary();

    const warning =
      "Low priority may cause ambiguous injection; you may want to raise it.";
    expect(await screen.findByRole("status")).toHaveTextContent(warning);

    // A response for an entry that is no longer selected is ignored.
    await user.click(screen.getByText("Azalea"));
    await user.click(screen.getByText("既存"));
    await waitFor(() => expect(checks).toHaveLength(3));
    expect(await screen.findByRole("status")).toHaveTextContent(warning);
    staleCheck.resolve([]);
    await Promise.resolve();
    expect(screen.getByRole("status")).toHaveTextContent(warning);

    const increase = screen.getByRole("button", { name: "Increase Priority" });
    await user.click(increase);
    // The warning hides while the edit saves and is checked again afterwards.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(warning);
    await user.click(increase);
    await user.click(increase);
    await waitFor(() => expect(entries[0].priority).toBe(8));
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );

    failCheck = true;
    await user.click(screen.getByText("Azalea"));
    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith("analysis failed"),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
