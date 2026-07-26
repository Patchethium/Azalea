import {
  type KeyboardShortcut,
  type KeyboardShortcuts,
  type OS,
} from "./binding";

export const shortcutActions = [
  "save_project",
  "play_current",
  "play_next",
  "stop_playback",
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
  save_project: {
    key: "S",
    primary: true,
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
  stop_playback: {
    key: "Space",
    primary: true,
    secondary: false,
    shift: false,
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

export const normalizeShortcutKey = (key: string) => {
  const normalized = keyAliases[key] ?? key;
  return normalized.length === 1 ? normalized.toUpperCase() : normalized;
};

export const resolveShortcut = (
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

export const shortcutFromKeyboardEvent = (
  event: KeyboardEvent,
  os: OS,
): ResolvedKeyboardShortcut | null => {
  if (modifierKeys.has(event.key)) return null;
  return {
    key: normalizeShortcutKey(event.key),
    ...modifierState(event, os),
  };
};

export const matchesShortcut = (
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

export const shortcutSignature = (shortcut: ResolvedKeyboardShortcut) =>
  [
    shortcut.primary ? "primary" : "",
    shortcut.secondary ? "secondary" : "",
    shortcut.alt ? "alt" : "",
    shortcut.shift ? "shift" : "",
    normalizeShortcutKey(shortcut.key),
  ].join("+");

export const formatShortcut = (
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

const nonEditorControlSelector = [
  "input",
  "textarea",
  "select",
  "button",
  '[role="button"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="slider"]',
].join(",");

export const isShortcutAllowed = (event: KeyboardEvent) => {
  if (
    event.defaultPrevented ||
    event.repeat ||
    document.querySelector('[role="dialog"]') !== null
  ) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof Element)) return true;
  if (
    target.closest(
      '[contenteditable="true"], [contenteditable="plaintext-only"]',
    )
  ) {
    return true;
  }
  return target.closest(nonEditorControlSelector) === null;
};
