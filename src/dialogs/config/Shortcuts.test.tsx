import { ShortcutSettings } from "@dialogs/config/Shortcuts";
import { MultiProvider } from "@solid-primitives/context";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import { type Component, onMount } from "solid-js";
import { describe, expect, it } from "vitest";
import { ConfigProvider, useConfigStore } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider } from "@contexts/meta";
import { ShortcutsProvider } from "@contexts/shortcuts";
import { SystemProvider } from "@contexts/system";
import { UIProvider } from "@contexts/ui";
import { config } from "../../test/fixtures";

describe("ShortcutSettings", () => {
  it("records unique shortcuts, reports conflicts, and restores defaults", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
    const Harness: Component = () => {
      appConfig = useConfigStore()!;
      onMount(() => appConfig.setConfig(config()));
      return <ShortcutSettings />;
    };

    render(() => (
      <MultiProvider
        values={[
          [MetaProvider, []],
          [UIProvider, null],
          [ConfigProvider, null],
          [SystemProvider, null],
          [ShortcutsProvider, null],
          [i18nProvider, null],
        ]}
      >
        <Harness />
      </MultiProvider>
    ));

    const saveShortcut = await screen.findByRole("button", {
      name: "Save project: Ctrl + S",
    });
    expect(
      screen.getByRole("button", {
        name: "Toggle pitch completion lock: Ctrl + L",
      }),
    ).toBeInTheDocument();
    const undoShortcut = screen.getByRole("button", {
      name: "Undo text edit: Ctrl + Z",
    });
    expect(undoShortcut.parentElement?.parentElement).toHaveClass("grid");
    expect(document.querySelector("[title]")).toBeNull();
    fireEvent.focusIn(undoShortcut);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Edit shortcut",
    );
    fireEvent.focusOut(undoShortcut);
    expect(
      screen.getByRole("button", {
        name: "Redo text edit: Ctrl + Shift + Z",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Play or stop selected cell: Space",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Stop playback:/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Restore default shortcut" }),
    ).not.toBeInTheDocument();
    fireEvent.click(saveShortcut);
    fireEvent.keyDown(saveShortcut, {
      key: "S",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(appConfig.config.ui.shortcuts?.save_project).toMatchObject({
      key: "S",
      primary: true,
      shift: true,
    });
    expect(
      screen.getByRole("button", { name: "Restore default shortcut" }),
    ).toBeInTheDocument();

    const playShortcut = screen.getByRole("button", {
      name: "Play selected cell: Ctrl + Enter",
    });
    fireEvent.click(playShortcut);
    fireEvent.keyDown(playShortcut, { key: "Enter", shiftKey: true });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That shortcut is already assigned.",
    );
    expect(appConfig.config.ui.shortcuts?.play_current).toBeUndefined();

    fireEvent.keyDown(playShortcut, { key: "Escape" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.keyDown(playShortcut, { key: "X" });
    expect(appConfig.config.ui.shortcuts?.play_current).toBeUndefined();

    const editedSaveShortcut = screen.getByRole("button", {
      name: "Save project: Ctrl + Shift + S",
    });
    fireEvent.click(editedSaveShortcut);
    fireEvent.keyDown(editedSaveShortcut, {
      key: "Control",
      ctrlKey: true,
    });
    expect(screen.getByText("Press keys… (Esc to cancel)")).toBeInTheDocument();
    fireEvent.blur(editedSaveShortcut);
    expect(
      screen.queryByText("Press keys… (Esc to cancel)"),
    ).not.toBeInTheDocument();

    const resetSave = screen
      .getAllByRole("button", { name: "Restore default shortcut" })
      .find((button) => !button.hasAttribute("disabled"))!;
    fireEvent.click(resetSave);
    expect(appConfig.config.ui.shortcuts?.save_project).toMatchObject({
      key: "S",
      primary: true,
      shift: false,
    });
    expect(
      screen.queryByRole("button", { name: "Restore default shortcut" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Save project: Ctrl + S" }),
    );
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Save project: Ctrl + S" }),
      { key: "S", ctrlKey: true, shiftKey: true },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Restore all defaults" }),
    );
    await waitFor(() =>
      expect(appConfig.config.ui.shortcuts?.save_project).toMatchObject({
        key: "S",
        primary: true,
        shift: false,
      }),
    );
    expect(appConfig.config.ui.shortcuts?.toggle_playback).toMatchObject({
      key: "Space",
      primary: false,
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lists the fixed shortcuts on the fixed tab", () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    const Harness: Component = () => {
      const appConfig = useConfigStore()!;
      onMount(() => appConfig.setConfig(config()));
      return <ShortcutSettings />;
    };

    render(() => (
      <MultiProvider
        values={[
          [MetaProvider, []],
          [UIProvider, null],
          [ConfigProvider, null],
          [SystemProvider, null],
          [ShortcutsProvider, null],
          [i18nProvider, null],
        ]}
      >
        <Harness />
      </MultiProvider>
    ));

    fireEvent.click(screen.getByRole("tab", { name: "Fixed" }));

    expect(screen.getByText("Not configurable")).toBeInTheDocument();
    expect(
      screen.getByText("Dismiss text blocks, dialogs, and the phoneme editor"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Move to the previous text block"),
    ).toBeInTheDocument();
    expect(screen.getByText("Move to the next text block")).toBeInTheDocument();
    expect(
      screen.getByText("Focus the selected text block"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /Dismiss text blocks, dialogs, and the phoneme editor/,
      }),
    ).not.toBeInTheDocument();
    const fixedList = screen
      .getByText("Focus the selected text block")
      .closest(".select-none") as HTMLElement;
    expect(fixedList).not.toBeNull();
    expect(screen.getByText("Focus the selected text block")).not.toHaveClass(
      "opacity-60",
    );
    const fixedKey = within(fixedList).getByText("Enter");
    expect(fixedKey).toHaveClass("opacity-60");
    expect(fixedKey).toHaveClass("cursor-not-allowed");
  });
});
