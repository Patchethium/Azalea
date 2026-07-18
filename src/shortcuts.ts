import { OS } from "./binding";

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

export const isPrimaryShortcut = (
  event: KeyboardEvent,
  key: string,
  os: OS,
) => {
  const primaryPressed = os === "MacOS" ? event.metaKey : event.ctrlKey;
  const otherPrimaryPressed = os === "MacOS" ? event.ctrlKey : event.metaKey;
  return (
    event.key.toLowerCase() === key.toLowerCase() &&
    primaryPressed &&
    !otherPrimaryPressed &&
    !event.altKey
  );
};

export const isPlaybackShortcutAllowed = (event: KeyboardEvent) => {
  if (event.repeat || document.querySelector('[role="dialog"]') !== null) {
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
