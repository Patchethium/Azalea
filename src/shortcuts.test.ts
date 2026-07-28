import { afterEach, describe, expect, it } from "vitest";
import {
  defaultKeyboardShortcuts,
  formatShortcut,
  isShortcutAllowed,
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
        keyboardEvent("Enter", { shiftKey: true, repeat: true }),
        shortcut,
        "Linux",
      ),
    ).toBe(false);
  });
});

describe("focus safety", () => {
  it("blocks handled or repeated events and all shortcuts while a dialog exists", () => {
    const handled = keyboardEvent("s");
    handled.preventDefault();
    expect(isShortcutAllowed(handled)).toBe(false);
    expect(isShortcutAllowed(keyboardEvent("s", { repeat: true }))).toBe(false);

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    expect(isShortcutAllowed(keyboardEvent("s"))).toBe(false);
  });

  it("allows editors and plain content while excluding form controls", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.dispatchEvent(keyboardEvent("s"));
    const inputEvent = keyboardEvent("s");
    Object.defineProperty(inputEvent, "target", { value: input });
    expect(isShortcutAllowed(inputEvent)).toBe(false);

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const editorEvent = keyboardEvent("s");
    Object.defineProperty(editorEvent, "target", { value: editor });
    expect(isShortcutAllowed(editorEvent)).toBe(true);

    expect(isShortcutAllowed(keyboardEvent("s"))).toBe(true);
  });
});
