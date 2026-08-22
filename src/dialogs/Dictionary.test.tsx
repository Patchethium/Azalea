import type { DictionaryEntry } from "$binding";
import { DictionaryDialog } from "@dialogs/Dictionary";
import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import userEvent from "@testing-library/user-event";
import { batch, type Component, createSignal, onMount } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { ConfigProvider } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider } from "@contexts/meta";
import { TextProvider, useTextStore } from "@contexts/text";
import { UIProvider } from "@contexts/ui";
import { audioQuery, config } from "../test/fixtures";

const existingEntry: DictionaryEntry = {
  id: "11111111-1111-4111-8111-111111111111",
  surface: "既存",
  pronunciation: "キソン",
  accent_type: 0,
  word_type: "COMMON_NOUN",
  priority: 5,
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

function renderDictionary(
  setup?: (text: NonNullable<ReturnType<typeof useTextStore>>) => void,
) {
  let text!: NonNullable<ReturnType<typeof useTextStore>>;
  const Harness: Component = () => {
    text = useTextStore()!;
    onMount(() => {
      batch(() => {
        text.replaceTextBlocks([
          {
            id: "generated",
            text: "generated",
            query: audioQuery(),
            query_is_modified: false,
            preset_id: null,
          },
          {
            id: "manual",
            text: "manual",
            query: audioQuery({ speedScale: 1.25 }),
            query_is_modified: true,
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

describe("DictionaryDialog", () => {
  it("adds, edits, and deletes entries while refreshing only generated queries", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const invocations: Array<{ cmd: string; args: Record<string, unknown> }> =
      [];
    let entries = [existingEntry];
    mockIPC((cmd, args) => {
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
    ).toHaveClass("bg-slate-1", "dark:bg-slate-9");
    const existingCard = screen.getByText("既存").parentElement;
    expect(existingCard).toHaveClass(
      "dark:bg-slate-8",
      "dark:group-hover:bg-slate-8",
      "!border-primary-5",
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
    expect(wordTypeList.parentElement).toHaveClass("z-60");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(
      screen.getByRole("button", { name: "Word type Verb" }),
    ).toBeInTheDocument();
    fireEvent.input(
      screen.getByRole("spinbutton", { name: "Accent position" }),
      {
        target: { value: "" },
      },
    );
    fireEvent.input(
      screen.getByRole("spinbutton", { name: "Accent position" }),
      {
        target: { value: "2" },
      },
    );
    fireEvent.input(screen.getByRole("spinbutton", { name: "Priority" }), {
      target: { value: "" },
    });
    fireEvent.input(screen.getByRole("spinbutton", { name: "Priority" }), {
      target: { value: "8" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        invocations.filter(({ cmd }) => cmd === "add_dictionary_entry"),
      ).toHaveLength(1),
    );
    expect(
      invocations.find(({ cmd }) => cmd === "add_dictionary_entry")?.args,
    ).toMatchObject({
      entry: {
        surface: "Azalea",
        pronunciation: "アザレア",
        accent_type: 2,
        word_type: "VERB",
        priority: 8,
      },
    });
    expect(dialog.getText().textStore[0].query).toBeNull();
    expect(dialog.getText().textStore[1]).toMatchObject({
      query_is_modified: true,
      query: { speedScale: 1.25 },
    });

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
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        invocations.filter(({ cmd }) => cmd === "update_dictionary_entry"),
      ).toHaveLength(1),
    );
    expect(screen.getByRole("textbox", { name: "Word" })).toHaveValue(
      "Updated",
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
    mockIPC((cmd) => {
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
    const accent = screen.getByRole("spinbutton", {
      name: "Accent position",
    });
    fireEvent.input(accent, { target: { value: "4" } });
    await waitFor(() => expect(accent).toHaveValue("4"));

    fireEvent.input(pronunciation, { target: { value: "キャット" } });

    await waitFor(() => expect(accent).toHaveValue("3"));
    expect(accent).toHaveAttribute("aria-valuemax", "3");
    expect(screen.getByText(/pitch falls \(maximum: 3\)/)).toBeInTheDocument();
  });

  it("reports load and validation failures without discarding the editor", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockIPC((cmd) => {
      if (cmd === "get_dictionary_entries") throw "load failed";
      return null;
    });
    const rejected = renderDictionary();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The user dictionary could not be loaded.",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    rejected.unmount();

    mockIPC((cmd) => {
      if (cmd === "get_dictionary_entries") throw new Error("transport failed");
      return null;
    });
    renderDictionary();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The user dictionary could not be loaded.",
    );
  });

  it("keeps entries editable when mutation requests fail", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    let updateCalls = 0;
    let moveCalls = 0;
    let deleteCalls = 0;
    mockIPC((cmd) => {
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
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The dictionary entry could not be saved.",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateCalls).toBe(2));

    await user.click(screen.getByRole("button", { name: "Move word down" }));
    await waitFor(() => expect(moveCalls).toBe(1));
    expect(screen.getByDisplayValue("既存")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move word down" }));
    await waitFor(() => expect(moveCalls).toBe(2));
    expect(screen.getByDisplayValue("既存")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete word" }));
    await waitFor(() => expect(deleteCalls).toBe(1));
    expect(screen.getByDisplayValue("既存")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete word" }));
    await waitFor(() => expect(deleteCalls).toBe(2));
    expect(screen.getByDisplayValue("既存")).toBeInTheDocument();
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
    mockIPC((cmd) => {
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
});
