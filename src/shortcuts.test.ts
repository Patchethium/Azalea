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

  it("blocks playback in dialogs and non-editor controls", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    expect(isPlaybackShortcutAllowed(keyboardEvent("s"))).toBe(false);
    expect(isPlaybackToggleAllowed(keyboardEvent(" "))).toBe(false);
    expect(isApplicationShortcutAllowed(keyboardEvent("s"))).toBe(true);
    dialog.remove();

    const input = document.createElement("input");
    document.body.append(input);
    const inputEvent = keyboardEvent("s");
    Object.defineProperty(inputEvent, "target", { value: input });
    expect(isPlaybackShortcutAllowed(inputEvent)).toBe(false);
    expect(isPlaybackToggleAllowed(inputEvent)).toBe(false);
    expect(isApplicationShortcutAllowed(inputEvent)).toBe(true);
  });

  it("allows playback shortcuts in editors and plain content", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const editorEvent = keyboardEvent("s");
    Object.defineProperty(editorEvent, "target", { value: editor });
    expect(isPlaybackShortcutAllowed(editorEvent)).toBe(true);
    expect(isPlaybackToggleAllowed(editorEvent)).toBe(false);

    expect(isPlaybackShortcutAllowed(keyboardEvent("s"))).toBe(true);
    expect(isPlaybackToggleAllowed(keyboardEvent(" "))).toBe(true);
  });

  it("allows playback toggling only on explicitly marked sliders", () => {
    const surface = document.createElement("div");
    const slider = document.createElement("span");
    slider.setAttribute("role", "slider");
    surface.append(slider);
    document.body.append(surface);
    const sliderEvent = keyboardEvent(" ");
    Object.defineProperty(sliderEvent, "target", { value: slider });

    expect(isPlaybackToggleAllowed(sliderEvent)).toBe(false);
    surface.setAttribute("data-playback-toggle", "allow");
    expect(isPlaybackToggleAllowed(sliderEvent)).toBe(true);
    expect(isPlaybackShortcutAllowed(sliderEvent)).toBe(false);

    const input = document.createElement("input");
    surface.append(input);
    const inputEvent = keyboardEvent(" ");
    Object.defineProperty(inputEvent, "target", { value: input });
    expect(isPlaybackToggleAllowed(inputEvent)).toBe(false);
  });

  it("ignores closed dialogs when evaluating playback shortcuts", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-closed", "");
    document.body.append(dialog);

    expect(isPlaybackShortcutAllowed(keyboardEvent(" "))).toBe(true);
  });
});
