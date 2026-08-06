import { afterEach, describe, expect, it } from "vitest";
import {
  defaultKeyboardShortcuts,
  formatShortcut,
  isApplicationShortcutAllowed,
  isPlaybackShortcutAllowed,
  isPlaybackToggleAllowed,
  matchesShortcut,
  normalizeShortcutKey,
  resolveShortcut,
  shortcutFromKeyboardEvent,
  shortcutSignature,
} from "./shortcuts";

const keyboardEvent = (
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent =>
  new KeyboardEvent("keydown", { key, cancelable: true, ...init });

afterEach(() => {
  document.body.replaceChildren();
});

describe("shortcut normalization and display", () => {
  it.each([
    [" ", "Space"],
    ["Spacebar", "Space"],
    ["Esc", "Escape"],
    ["a", "A"],
    ["ArrowLeft", "ArrowLeft"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeShortcutKey(input)).toBe(expected);
  });

  it("uses defaults and normalizes configured keys", () => {
    expect(resolveShortcut(undefined, "save_project")).toBe(
      defaultKeyboardShortcuts.save_project,
    );
    expect(resolveShortcut(undefined, "toggle_playback")).toEqual({
      key: "Space",
      primary: false,
      secondary: false,
      shift: false,
      alt: false,
    });
    expect(
      resolveShortcut(
        { save_project: { key: "s", alt: true } },
        "save_project",
      ),
    ).toEqual({
      key: "S",
      primary: false,
      secondary: false,
      shift: false,
      alt: true,
    });
  });

  it("formats platform modifiers and canonical signatures", () => {
    const shortcut = {
      key: " ",
      primary: true,
      secondary: true,
      shift: true,
      alt: true,
    };
    expect(formatShortcut(shortcut, "MacOS")).toEqual([
      "Cmd",
      "Ctrl",
      "Option",
      "Shift",
      "Space",
    ]);
    expect(formatShortcut(shortcut, "Linux")).toEqual([
      "Ctrl",
      "Meta",
      "Alt",
      "Shift",
      "Space",
    ]);
    expect(shortcutSignature(shortcut)).toBe(
      "primary+secondary+alt+shift+Space",
    );
  });
});

describe("keyboard matching", () => {
  it("maps primary and secondary modifiers by operating system", () => {
    expect(
      shortcutFromKeyboardEvent(
        keyboardEvent("s", { metaKey: true, ctrlKey: false }),
        "MacOS",
      ),
    ).toMatchObject({ key: "S", primary: true, secondary: false });
    expect(
      shortcutFromKeyboardEvent(
        keyboardEvent("s", { metaKey: true, ctrlKey: false }),
        "Linux",
      ),
    ).toMatchObject({ key: "S", primary: false, secondary: true });
    expect(
      shortcutFromKeyboardEvent(keyboardEvent("Shift"), "Linux"),
    ).toBeNull();
  });

  it("requires an exact modifier match and ignores repeat", () => {
    const shortcut = defaultKeyboardShortcuts.play_next;
    expect(
      matchesShortcut(
        keyboardEvent("Enter", { shiftKey: true }),
        shortcut,
        "Linux",
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        keyboardEvent("Enter", { shiftKey: true, ctrlKey: true }),
        shortcut,
        "Linux",
      ),
    ).toBe(false);

    expect(
      matchesShortcut(
        keyboardEvent(" "),
        defaultKeyboardShortcuts.toggle_playback,
        "Linux",
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        keyboardEvent(" ", { ctrlKey: true }),
        defaultKeyboardShortcuts.toggle_playback,
        "Linux",
      ),
    ).toBe(false);
    expect(
      matchesShortcut(
        keyboardEvent("Enter", { shiftKey: true, repeat: true }),
        shortcut,
        "Linux",
      ),
    ).toBe(false);
  });
});

describe("focus safety", () => {
  it("blocks handled, repeated, and composing application shortcuts", () => {
    const handled = keyboardEvent("s");
    handled.preventDefault();
    expect(isApplicationShortcutAllowed(handled)).toBe(false);
    expect(
      isApplicationShortcutAllowed(keyboardEvent("s", { repeat: true })),
    ).toBe(false);
    expect(
      isApplicationShortcutAllowed(keyboardEvent("s", { isComposing: true })),
    ).toBe(false);
    expect(isApplicationShortcutAllowed(keyboardEvent("s"))).toBe(true);
  });

  it("protects text entry while allowing modifier playback in content editors", () => {
    for (const target of [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
    ]) {
      document.body.append(target);
      const event = keyboardEvent(" ");
      Object.defineProperty(event, "target", { value: target });
      expect(isPlaybackShortcutAllowed(event)).toBe(false);
      expect(isPlaybackToggleAllowed(event)).toBe(false);
      target.remove();
    }

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const editorEvent = keyboardEvent("s");
    Object.defineProperty(editorEvent, "target", { value: editor });
    expect(isPlaybackShortcutAllowed(editorEvent)).toBe(true);
    expect(isPlaybackToggleAllowed(editorEvent)).toBe(false);

    expect(isPlaybackShortcutAllowed(keyboardEvent("s"))).toBe(true);
    expect(isPlaybackToggleAllowed(keyboardEvent(" "))).toBe(true);
  });

  it("allows playback from ordinary controls regardless of retained focus", () => {
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
      expect(isPlaybackShortcutAllowed(event)).toBe(true);
      expect(isPlaybackToggleAllowed(event)).toBe(true);
      control.remove();
    }

    const tooltip = document.createElement("div");
    tooltip.setAttribute("role", "tooltip");
    document.body.append(tooltip);
    expect(isPlaybackToggleAllowed(keyboardEvent(" "))).toBe(true);
  });

  it("blocks playback while a dialog or menu-like popup is open", () => {
    for (const role of ["dialog", "alertdialog", "menu", "listbox"]) {
      const surface = document.createElement("div");
      surface.setAttribute("role", role);
      document.body.append(surface);
      expect(isPlaybackShortcutAllowed(keyboardEvent(" "))).toBe(false);
      expect(isPlaybackToggleAllowed(keyboardEvent(" "))).toBe(false);
      surface.remove();
    }

    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    expect(isPlaybackToggleAllowed(keyboardEvent(" "))).toBe(false);
  });

  it("ignores closed popup surfaces and their descendants", () => {
    const closedSurface = document.createElement("div");
    closedSurface.setAttribute("data-closed", "");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    closedSurface.append(menu);
    document.body.append(closedSurface);

    expect(isPlaybackShortcutAllowed(keyboardEvent(" "))).toBe(true);
    expect(isPlaybackToggleAllowed(keyboardEvent(" "))).toBe(true);
  });
});
