import { waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultKeyboardShortcuts,
  type ResolvedKeyboardShortcut,
} from "@contexts/shortcuts";
import { renderShortcutsStore } from "@contexts/providers.testUtils";

const keyboardEvent = (
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent =>
  new KeyboardEvent("keydown", { key, cancelable: true, ...init });

beforeEach(() => {
  mockIPC((command) => (command === "get_os" ? "Linux" : null));
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("ShortcutsProvider normalization and display", () => {
  it.each([
    [" ", "Space"],
    ["Spacebar", "Space"],
    ["Esc", "Escape"],
    ["a", "A"],
    ["ArrowLeft", "ArrowLeft"],
  ])("normalizes %s to %s", (input, expected) => {
    const { shortcuts, config } = renderShortcutsStore();
    config.setConfig("ui", "shortcuts", {
      save_project: { key: input },
    });

    expect(shortcuts.getShortcut("save_project").key).toBe(expected);
  });

  it("uses defaults and normalizes configured keys", () => {
    const { shortcuts, config } = renderShortcutsStore();

    expect(shortcuts.getShortcut("undo")).toEqual({
      key: "Z",
      primary: true,
      secondary: false,
      shift: false,
      alt: false,
    });
    expect(shortcuts.getShortcut("redo")).toEqual({
      key: "Z",
      primary: true,
      secondary: false,
      shift: true,
      alt: false,
    });
    expect(shortcuts.getShortcut("save_project")).toBe(
      defaultKeyboardShortcuts.save_project,
    );
    expect(shortcuts.getShortcut("toggle_playback")).toEqual({
      key: "Space",
      primary: false,
      secondary: false,
      shift: false,
      alt: false,
    });

    config.setConfig("ui", "shortcuts", {
      save_project: { key: "s", alt: true },
    });
    expect(shortcuts.getShortcut("save_project")).toEqual({
      key: "S",
      primary: false,
      secondary: false,
      shift: false,
      alt: true,
    });
  });

  it("formats shortcuts for the current operating system", async () => {
    mockIPC((command) => (command === "get_os" ? "MacOS" : null));
    const { shortcuts, config } = renderShortcutsStore();
    config.setConfig("ui", "shortcuts", {
      save_project: {
        key: " ",
        primary: true,
        secondary: true,
        shift: true,
        alt: true,
      },
    });

    await waitFor(() =>
      expect(shortcuts.formatShortcut("save_project")).toEqual([
        "Cmd",
        "Ctrl",
        "Option",
        "Shift",
        "Space",
      ]),
    );
  });

  it("rejects duplicate assignments and supports one/all resets", () => {
    const { shortcuts, config } = renderShortcutsStore();
    const customSave: ResolvedKeyboardShortcut = {
      key: "S",
      primary: true,
      secondary: false,
      shift: true,
      alt: false,
    };

    expect(shortcuts.assignShortcut("save_project", customSave)).toBe(true);
    expect(shortcuts.assignShortcut("play_current", customSave)).toBe(false);
    expect(config.config.ui.shortcuts?.play_current).toBeUndefined();
    expect(shortcuts.resetShortcut("save_project")).toBe(true);
    expect(shortcuts.isDefaultShortcut("save_project")).toBe(true);

    expect(
      shortcuts.assignShortcut("undo", { ...customSave, key: "U" }),
    ).toBe(true);
    expect(shortcuts.isDefaultShortcut("undo")).toBe(false);
    shortcuts.resetAllShortcuts();
    expect(shortcuts.getShortcut("undo")).toEqual(
      defaultKeyboardShortcuts.undo,
    );
  });
});

describe("ShortcutsProvider keyboard matching", () => {
  it("maps primary and secondary modifiers by operating system", async () => {
    mockIPC((command) => (command === "get_os" ? "MacOS" : null));
    const { shortcuts } = renderShortcutsStore();

    await waitFor(() =>
      expect(
        shortcuts.shortcutFromKeyboardEvent(
          keyboardEvent("s", { metaKey: true, ctrlKey: false }),
        ),
      ).toMatchObject({ key: "S", primary: true, secondary: false }),
    );
    expect(shortcuts.shortcutFromKeyboardEvent(keyboardEvent("Shift"))).toBe(
      null,
    );
  });

  it("requires an exact modifier match and ignores repeat", () => {
    const { shortcuts, config } = renderShortcutsStore();

    expect(
      shortcuts.matchesShortcut(
        keyboardEvent("Enter", { shiftKey: true }),
        "play_next",
      ),
    ).toBe(true);
    expect(
      shortcuts.matchesShortcut(
        keyboardEvent("Enter", { shiftKey: true, ctrlKey: true }),
        "play_next",
      ),
    ).toBe(false);
    expect(
      shortcuts.matchesShortcut(keyboardEvent(" "), "toggle_playback"),
    ).toBe(true);
    expect(
      shortcuts.matchesShortcut(
        keyboardEvent(" ", { ctrlKey: true }),
        "toggle_playback",
      ),
    ).toBe(false);
    expect(
      shortcuts.matchesShortcut(
        keyboardEvent("Enter", { shiftKey: true, repeat: true }),
        "play_next",
      ),
    ).toBe(false);

    config.setConfig("ui", "shortcuts", {
      save_project: { key: "A", alt: true },
    });
    expect(
      shortcuts.matchesShortcut(
        keyboardEvent("a", { altKey: true }),
        "save_project",
      ),
    ).toBe(true);
  });
});

describe("ShortcutsProvider focus safety", () => {
  it("blocks handled, repeated, and composing application shortcuts", () => {
    const { shortcuts } = renderShortcutsStore();
    const handled = keyboardEvent("s");
    handled.preventDefault();

    expect(shortcuts.isApplicationShortcutAllowed(handled)).toBe(false);
    expect(
      shortcuts.isApplicationShortcutAllowed(
        keyboardEvent("s", { repeat: true }),
      ),
    ).toBe(false);
    expect(
      shortcuts.isApplicationShortcutAllowed(
        keyboardEvent("s", { isComposing: true }),
      ),
    ).toBe(false);
    expect(shortcuts.isApplicationShortcutAllowed(keyboardEvent("s"))).toBe(
      true,
    );
  });

  it("protects text entry while allowing modifier playback in content editors", () => {
    const { shortcuts } = renderShortcutsStore();
    for (const target of [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
    ]) {
      document.body.append(target);
      const event = keyboardEvent(" ");
      Object.defineProperty(event, "target", { value: target });
      expect(shortcuts.isPlaybackShortcutAllowed(event)).toBe(false);
      expect(shortcuts.isPlaybackToggleAllowed(event)).toBe(false);
      target.remove();
    }

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const editorEvent = keyboardEvent("s");
    Object.defineProperty(editorEvent, "target", { value: editor });
    expect(shortcuts.isPlaybackShortcutAllowed(editorEvent)).toBe(true);
    expect(shortcuts.isPlaybackToggleAllowed(editorEvent)).toBe(false);

    expect(shortcuts.isPlaybackShortcutAllowed(keyboardEvent("s"))).toBe(true);
    expect(shortcuts.isPlaybackToggleAllowed(keyboardEvent(" "))).toBe(true);
  });

  it("allows playback from ordinary controls regardless of retained focus", () => {
    const { shortcuts } = renderShortcutsStore();
    const controls = [
      document.createElement("button"),
      document.createElement("button"),
      document.createElement("span"),
    ];
    controls[0].setAttribute("aria-expanded", "true");
    controls[1].setAttribute("role", "tab");
    controls[2].setAttribute("role", "slider");
    for (const control of controls) {
      document.body.append(control);
      const event = keyboardEvent(" ");
      Object.defineProperty(event, "target", { value: control });
      expect(shortcuts.isPlaybackShortcutAllowed(event)).toBe(true);
      expect(shortcuts.isPlaybackToggleAllowed(event)).toBe(true);
      control.remove();
    }

    const tooltip = document.createElement("div");
    tooltip.setAttribute("role", "tooltip");
    document.body.append(tooltip);
    expect(shortcuts.isPlaybackToggleAllowed(keyboardEvent(" "))).toBe(true);
  });

  it("blocks playback while a dialog or menu-like popup is open", () => {
    const { shortcuts } = renderShortcutsStore();
    for (const role of ["dialog", "alertdialog", "menu", "listbox"]) {
      const surface = document.createElement("div");
      surface.setAttribute("role", role);
      document.body.append(surface);
      expect(shortcuts.isPlaybackShortcutAllowed(keyboardEvent(" "))).toBe(
        false,
      );
      expect(shortcuts.isPlaybackToggleAllowed(keyboardEvent(" "))).toBe(
        false,
      );
      surface.remove();
    }

    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    expect(shortcuts.isPlaybackToggleAllowed(keyboardEvent(" "))).toBe(false);
  });

  it("ignores closed popup surfaces and their descendants", () => {
    const { shortcuts } = renderShortcutsStore();
    const closedSurface = document.createElement("div");
    closedSurface.setAttribute("data-closed", "");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    closedSurface.append(menu);
    document.body.append(closedSurface);

    expect(shortcuts.isPlaybackShortcutAllowed(keyboardEvent(" "))).toBe(true);
    expect(shortcuts.isPlaybackToggleAllowed(keyboardEvent(" "))).toBe(true);
  });

  it("allows playback when a synthetic event has no DOM target", () => {
    const { shortcuts } = renderShortcutsStore();
    Object.defineProperty(document, "activeElement", {
      configurable: true,
      value: null,
    });
    try {
      expect(shortcuts.isPlaybackShortcutAllowed(keyboardEvent(" "))).toBe(
        true,
      );
      expect(shortcuts.isPlaybackToggleAllowed(keyboardEvent(" "))).toBe(
        true,
      );
    } finally {
      delete (document as unknown as { activeElement?: Element }).activeElement;
    }
  });

  it("uses the event target rather than the active element", () => {
    const { shortcuts } = renderShortcutsStore();
    const input = document.createElement("input");
    const button = document.createElement("button");
    document.body.append(input, button);
    input.focus();

    const event = keyboardEvent(" ");
    Object.defineProperty(event, "target", { value: button });
    expect(shortcuts.isPlaybackToggleAllowed(event)).toBe(true);
  });
});
