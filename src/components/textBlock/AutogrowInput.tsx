import { debounce } from "@solid-primitives/scheduled";
import { createEffect, JSX, on, onCleanup, Show, splitProps } from "solid-js";
import { useShortcutsStore } from "@contexts/shortcuts";

export const TEXT_HISTORY_DEBOUNCE_MS = 500;

interface AutogrowInputProps extends JSX.HTMLAttributes<HTMLDivElement> {
  historyKey: string;
  text: string;
  setText: (text: string) => void;
  focused: boolean;
  placeholder: string;
  onCaretChange?: (offset: number) => void;
  onNavigate?: (direction: "up" | "down") => void;
  focusPlacement?: "start" | "end" | null;
  onFocusPlacementConsumed?: () => void;
}

export function AutogrowInput(props: AutogrowInputProps) {
  const { isApplicationShortcutAllowed, matchesShortcut } =
    useShortcutsStore()!;
  const [local, inputProps] = splitProps(props, [
    "historyKey",
    "text",
    "setText",
    "focused",
    "placeholder",
    "onCaretChange",
    "onNavigate",
    "focusPlacement",
    "onFocusPlacementConsumed",
  ]);
  let inputRef: HTMLDivElement | undefined;
  let trackedHistoryKey = local.historyKey;
  let trackedText = local.text;
  const undoStack = [local.text];
  const redoStack: string[] = [];
  let pendingSnapshot: string | null = null;

  const commitPendingSnapshot = () => {
    if (pendingSnapshot === null) return;
    const snapshot = pendingSnapshot;
    pendingSnapshot = null;
    if (undoStack[undoStack.length - 1] !== snapshot) undoStack.push(snapshot);
  };

  const commitDebouncedSnapshot = debounce(
    commitPendingSnapshot,
    TEXT_HISTORY_DEBOUNCE_MS,
  );

  const resetHistory = (historyKey: string, text: string) => {
    commitDebouncedSnapshot.clear();
    trackedHistoryKey = historyKey;
    trackedText = text;
    pendingSnapshot = null;
    undoStack.splice(0, undoStack.length, text);
    redoStack.length = 0;
  };

  onCleanup(() => commitDebouncedSnapshot.clear());

  const caretOffset = (element: HTMLDivElement) => {
    const selection = element.ownerDocument.getSelection();
    if (selection === null || selection.rangeCount === 0) return undefined;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer)) return undefined;
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length;
  };

  // `caretOffset` relies on `Range.toString()`, which does not count line breaks
  // the way `innerText` does. Compare against the element edges instead so
  // multi-line blocks still detect the caret at the very start/end.
  const caretAtStart = (element: HTMLDivElement) => {
    const selection = element.ownerDocument.getSelection();
    if (selection === null || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer)) return false;
    const beforeCaret = range.cloneRange();
    beforeCaret.setStart(element, 0);
    return beforeCaret.toString() === "";
  };

  const caretAtEnd = (element: HTMLDivElement) => {
    const selection = element.ownerDocument.getSelection();
    if (selection === null || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer)) return false;
    const afterCaret = range.cloneRange();
    afterCaret.setEnd(element, element.childNodes.length);
    return afterCaret.toString() === "";
  };

  const reportCaret = (element: HTMLDivElement) => {
    if (local.onCaretChange === undefined) return;
    const offset = caretOffset(element);
    if (offset !== undefined) local.onCaretChange(offset);
  };

  createEffect(
    on([() => local.historyKey, () => local.text], ([historyKey, text]) => {
      if (historyKey !== trackedHistoryKey || text !== trackedText) {
        resetHistory(historyKey, text);
      }
      if (inputRef !== undefined && local.text !== inputRef.innerText) {
        inputRef.innerText = local.text;
      }
    }),
  );

  createEffect(() => {
    if (
      local.focused &&
      inputRef !== undefined &&
      inputRef.ownerDocument.activeElement !== inputRef
    ) {
      const placement = local.focusPlacement ?? "end";
      inputRef.focus();
      placeCaret(inputRef, placement);
      local.onFocusPlacementConsumed?.();
    }
  });

  const placeCaret = (element: HTMLDivElement, placement: "start" | "end") => {
    const selection = element.ownerDocument.getSelection();
    if (selection === null) return;
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    range.collapse(placement === "start");
    selection.removeAllRanges();
    selection.addRange(range);
    reportCaret(element);
  };

  const moveCaretToEnd = (element: HTMLDivElement) =>
    placeCaret(element, "end");

  const applyHistoryText = (text: string) => {
    trackedText = text;
    if (inputRef !== undefined) {
      inputRef.innerText = text;
      moveCaretToEnd(inputRef);
    }
    local.setText(text);
  };

  const undo = () => {
    commitDebouncedSnapshot.clear();
    commitPendingSnapshot();
    if (undoStack.length <= 1) return;
    redoStack.push(undoStack.pop()!);
    applyHistoryText(undoStack[undoStack.length - 1]);
  };

  const redo = () => {
    commitDebouncedSnapshot.clear();
    commitPendingSnapshot();
    const text = redoStack.pop();
    if (text === undefined) return;
    undoStack.push(text);
    applyHistoryText(text);
  };

  const handleInput = () => {
    if (inputRef !== undefined) {
      const text = inputRef.innerText === "\n" ? "" : inputRef.innerText;
      trackedText = text;
      pendingSnapshot = text;
      redoStack.length = 0;
      commitDebouncedSnapshot();
      local.setText(text);
      reportCaret(inputRef);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!isApplicationShortcutAllowed(event)) return;
    if (event.key === "Escape") {
      inputRef?.blur();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (inputRef === undefined || local.onNavigate === undefined) return;
      const atBoundary =
        event.key === "ArrowUp" ? caretAtStart(inputRef) : caretAtEnd(inputRef);
      if (!atBoundary) return;
      event.preventDefault();
      local.onNavigate(event.key === "ArrowUp" ? "up" : "down");
      return;
    }
    const isUndo = matchesShortcut(event, "undo");
    const isRedo = matchesShortcut(event, "redo");
    if (!isUndo && !isRedo) return;
    event.preventDefault();
    if (isUndo) undo();
    else redo();
  };

  return (
    <div class="relative w-full">
      <Show when={local.text === ""}>
        <span
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 text-slate-4 dark:text-slate-5"
        >
          {local.placeholder}
        </span>
      </Show>
      <div
        contentEditable="plaintext-only"
        class="relative min-h-6 w-full outline-none"
        {...inputProps}
        ref={(element) => {
          inputRef = element;
        }}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => reportCaret(event.currentTarget)}
        onMouseUp={(event) => reportCaret(event.currentTarget)}
        onSelect={(event) => reportCaret(event.currentTarget)}
      />
    </div>
  );
}
