import type { KeyboardShortcut, KeyboardShortcuts, OS } from "$binding";
import { createContextProvider } from "@solid-primitives/context";
import { useConfigStore } from "@contexts/config";
import { useSystemStore } from "@contexts/system";

export const shortcutActions = [
  "undo",
  "redo",
  "save_project",
  "export_audio",
  "toggle_playback",
  "play_current",
  "play_next",
] as const;

export type ShortcutAction = (typeof shortcutActions)[number];

export type ResolvedKeyboardShortcut = {
  key: string;
  primary: boolean;
  secondary: boolean;
  shift: boolean;
  alt: boolean;
};

export const defaultKeyboardShortcuts: Record<
  ShortcutAction,
  ResolvedKeyboardShortcut
> = {
  undo: {
    key: "Z",
    primary: true,
    secondary: false,
    shift: false,
    alt: false,
  },
  redo: {
    key: "Z",
    primary: true,
    secondary: false,
    shift: true,
    alt: false,
  },
  save_project: {
    key: "S",
    primary: true,
    secondary: false,
    shift: false,
    alt: false,
  },
  export_audio: {
    key: "E",
    primary: true,
    secondary: false,
    shift: false,
    alt: false,
  },
  toggle_playback: {
    key: "Space",
    primary: false,
    secondary: false,
    shift: false,
    alt: false,
  },
  play_current: {
    key: "Enter",
    primary: true,
    secondary: false,
    shift: false,
    alt: false,
  },
  play_next: {
    key: "Enter",
    primary: false,
    secondary: false,
    shift: true,
    alt: false,
  },
};

const keyAliases: Record<string, string> = {
  " ": "Space",
  Spacebar: "Space",
  Esc: "Escape",
  Del: "Delete",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  Up: "ArrowUp",
  Down: "ArrowDown",
};

const keyLabels: Record<string, string> = {
  Space: "Space",
  Escape: "Esc",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

const modifierKeys = new Set(["Alt", "AltGraph", "Control", "Meta", "Shift"]);

const normalizeShortcutKey = (key: string) => {
  const normalized = keyAliases[key] ?? key;
  return normalized.length === 1 ? normalized.toUpperCase() : normalized;
};

const resolveConfiguredShortcut = (
  shortcuts: KeyboardShortcuts | undefined,
  action: ShortcutAction,
): ResolvedKeyboardShortcut => {
  const configured = shortcuts?.[action];
  const fallback = defaultKeyboardShortcuts[action];
  if (configured === undefined) return fallback;
  return {
    key: normalizeShortcutKey(configured.key),
    primary: configured.primary ?? false,
    secondary: configured.secondary ?? false,
    shift: configured.shift ?? false,
    alt: configured.alt ?? false,
  };
};

const modifierState = (event: KeyboardEvent, os: OS) => {
  const primary = os === "MacOS" ? event.metaKey : event.ctrlKey;
  const secondary = os === "MacOS" ? event.ctrlKey : event.metaKey;
  return {
    primary,
    secondary,
    shift: event.shiftKey,
    alt: event.altKey,
  };
};

const resolvedShortcutFromKeyboardEvent = (
  event: KeyboardEvent,
  os: OS,
): ResolvedKeyboardShortcut | null => {
  if (modifierKeys.has(event.key)) return null;
  return {
    key: normalizeShortcutKey(event.key),
    ...modifierState(event, os),
  };
};

const eventMatchesShortcut = (
  event: KeyboardEvent,
  shortcut: KeyboardShortcut | ResolvedKeyboardShortcut,
  os: OS,
) => {
  if (event.repeat) return false;
  const modifiers = modifierState(event, os);
  return (
    normalizeShortcutKey(event.key) === normalizeShortcutKey(shortcut.key) &&
    modifiers.primary === (shortcut.primary ?? false) &&
    modifiers.secondary === (shortcut.secondary ?? false) &&
    modifiers.shift === (shortcut.shift ?? false) &&
    modifiers.alt === (shortcut.alt ?? false)
  );
};

const shortcutSignature = (shortcut: ResolvedKeyboardShortcut) =>
  [
    shortcut.primary ? "primary" : "",
    shortcut.secondary ? "secondary" : "",
    shortcut.alt ? "alt" : "",
    shortcut.shift ? "shift" : "",
    normalizeShortcutKey(shortcut.key),
  ].join("+");

const formatResolvedShortcut = (
  shortcut: KeyboardShortcut | ResolvedKeyboardShortcut,
  os: OS,
) => {
  const keys: string[] = [];
  if (shortcut.primary) keys.push(os === "MacOS" ? "Cmd" : "Ctrl");
  if (shortcut.secondary) keys.push(os === "MacOS" ? "Ctrl" : "Meta");
  if (shortcut.alt) keys.push(os === "MacOS" ? "Option" : "Alt");
  if (shortcut.shift) keys.push("Shift");
  const key = normalizeShortcutKey(shortcut.key);
  keys.push(keyLabels[key] ?? key);
  return keys;
};

const formTextEntrySelector = [
  "input",
  "textarea",
  "select",
  '[role="textbox"]',
].join(",");

const textEditorSelector = '[contenteditable]:not([contenteditable="false"])';
const playbackBlockingSurfaceSelector = [
  '[role="dialog"]:not(dialog)',
  '[role="alertdialog"]',
  "dialog[open]",
  '[role="menu"]',
  '[role="listbox"]',
].join(",");
const closedSurfaceSelector = '[data-closed], [aria-hidden="true"], [hidden]';

const shortcutTarget = (event: KeyboardEvent) => {
  if (event.target instanceof Element) return event.target;
  return document.activeElement instanceof Element
    ? document.activeElement
    : null;
};

const isApplicationShortcutAllowed = (event: KeyboardEvent) =>
  !event.defaultPrevented && !event.repeat && !event.isComposing;

const hasOpenPlaybackBlockingSurface = () =>
  Array.from(document.querySelectorAll(playbackBlockingSurfaceSelector)).some(
    (surface) => surface.closest(closedSurfaceSelector) === null,
  );

const isPlaybackContextAllowed = (event: KeyboardEvent) =>
  isApplicationShortcutAllowed(event) && !hasOpenPlaybackBlockingSurface();

const isPlaybackShortcutAllowed = (event: KeyboardEvent) => {
  if (!isPlaybackContextAllowed(event)) return false;

  const target = shortcutTarget(event);
  if (target === null) return true;
  if (target.closest(textEditorSelector) !== null) return true;
  return target.closest(formTextEntrySelector) === null;
};

const isPlaybackToggleAllowed = (event: KeyboardEvent) => {
  if (!isPlaybackContextAllowed(event)) return false;
  const target = shortcutTarget(event);
  if (target === null) return true;
  if (target.closest(textEditorSelector) !== null) return false;
  return target.closest(formTextEntrySelector) === null;
};

const [ShortcutsProvider, useShortcutsStore] = createContextProvider(() => {
  const { config, setConfig } = useConfigStore()!;
  const { systemStore } = useSystemStore()!;

  const getShortcut = (action: ShortcutAction) =>
    resolveConfiguredShortcut(config.ui.shortcuts, action);
  const matchesShortcut = (event: KeyboardEvent, action: ShortcutAction) =>
    eventMatchesShortcut(event, getShortcut(action), systemStore.os);
  const formatShortcut = (action: ShortcutAction) =>
    formatResolvedShortcut(getShortcut(action), systemStore.os);
  const shortcutFromKeyboardEvent = (event: KeyboardEvent) =>
    resolvedShortcutFromKeyboardEvent(event, systemStore.os);
  const isDefaultShortcut = (action: ShortcutAction) =>
    shortcutSignature(getShortcut(action)) ===
    shortcutSignature(defaultKeyboardShortcuts[action]);

  const assignShortcut = (
    action: ShortcutAction,
    shortcut: ResolvedKeyboardShortcut,
  ) => {
    const duplicate = shortcutActions.some(
      (candidate) =>
        candidate !== action &&
        shortcutSignature(getShortcut(candidate)) ===
          shortcutSignature(shortcut),
    );
    if (duplicate) return false;
    setConfig("ui", "shortcuts", {
      ...config.ui.shortcuts,
      [action]: shortcut,
    });
    return true;
  };
  const resetShortcut = (action: ShortcutAction) =>
    assignShortcut(action, defaultKeyboardShortcuts[action]);
  const resetAllShortcuts = () => {
    setConfig("ui", "shortcuts", { ...defaultKeyboardShortcuts });
  };

  return {
    getShortcut,
    matchesShortcut,
    formatShortcut,
    shortcutFromKeyboardEvent,
    assignShortcut,
    resetShortcut,
    resetAllShortcuts,
    isDefaultShortcut,
    isApplicationShortcutAllowed,
    isPlaybackShortcutAllowed,
    isPlaybackToggleAllowed,
  };
});

export { ShortcutsProvider, useShortcutsStore };
