import { commands, events } from "$binding";
import { TEXT_HISTORY_DEBOUNCE_MS } from "@components/textBlock/AutogrowInput";
import {
  renderAutogrowInput,
  renderBlock,
} from "@components/textBlock/testUtils";
import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { produce } from "solid-js/store";
import { describe, expect, it, vi } from "vitest";
import { defaultKeyboardShortcuts } from "@contexts/shortcuts";
import { audioQuery, preset } from "../../test/fixtures";

vi.mock("@solid-primitives/scheduled", () => ({
  debounce: <Args extends unknown[]>(
    callback: (...args: Args) => void,
    wait: number,
  ) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const scheduled = (...args: Args) => {
      if (timeout !== undefined) clearTimeout(timeout);
      timeout = setTimeout(() => callback(...args), wait);
    };
    scheduled.clear = () => {
      if (timeout !== undefined) clearTimeout(timeout);
    };
    return scheduled;
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

describe("TextBlock", () => {
  it("marks synthesis text as Japanese", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    renderBlock(false);

    expect(await screen.findByLabelText("Text to synthesize")).toHaveAttribute(
      "lang",
      "ja",
    );
  });

  it("normalizes blank editable input without requiring a selection", () => {
    vi.spyOn(document, "getSelection").mockReturnValue(null);
    const setText = vi.fn();
    renderAutogrowInput({
      historyKey: "direct-editor",
      text: "",
      setText,
      focused: true,
      placeholder: "Placeholder",
      "aria-label": "Direct editor",
    });
    const editor = screen.getByLabelText("Direct editor");
    editor.innerText = "\n";
    fireEvent.input(editor);
    expect(setText).toHaveBeenCalledWith("");
  });

  it("blurs the editor when Escape is pressed", async () => {
    renderAutogrowInput({
      historyKey: "escape-editor",
      text: "hello",
      setText: vi.fn(),
      focused: true,
      placeholder: "Placeholder",
      "aria-label": "Escape editor",
    });
    const editor = screen.getByLabelText("Escape editor");
    await waitFor(() => expect(editor).toHaveFocus());

    fireEvent.keyDown(editor, { key: "Escape" });

    expect(editor).not.toHaveFocus();
  });

  it("reports caret offsets from selection and key events", () => {
    const onCaretChange = vi.fn();
    renderAutogrowInput({
      historyKey: "caret-editor",
      text: "hello",
      setText: vi.fn(),
      focused: false,
      placeholder: "Placeholder",
      "aria-label": "Caret editor",
      onCaretChange,
    });
    const editor = screen.getByLabelText("Caret editor");
    const textNode = editor.ownerDocument.createTextNode("hello");
    editor.appendChild(textNode);
    const selection = editor.ownerDocument.getSelection();
    const range = editor.ownerDocument.createRange();
    range.setStart(textNode, 2);
    range.collapse(true);
    selection!.removeAllRanges();
    selection!.addRange(range);
    fireEvent.keyUp(editor);
    expect(onCaretChange).toHaveBeenCalledWith(2);
  });

  it("ignores missing selections and selections outside the editor", () => {
    const onCaretChange = vi.fn();
    renderAutogrowInput({
      historyKey: "caret-editor-2",
      text: "hello",
      setText: vi.fn(),
      focused: false,
      placeholder: "Placeholder",
      "aria-label": "Caret editor 2",
      onCaretChange,
    });
    const editor = screen.getByLabelText("Caret editor 2");

    vi.spyOn(document, "getSelection").mockReturnValue(null);
    fireEvent.input(editor);
    expect(onCaretChange).not.toHaveBeenCalled();

    vi.spyOn(document, "getSelection").mockRestore();
    const outside = editor.ownerDocument.createElement("div");
    editor.ownerDocument.body.appendChild(outside);
    const selection = editor.ownerDocument.getSelection();
    const range = editor.ownerDocument.createRange();
    range.selectNodeContents(outside);
    selection!.removeAllRanges();
    selection!.addRange(range);
    fireEvent.mouseUp(editor);
    expect(onCaretChange).not.toHaveBeenCalled();
  });

  it("undoes and redoes whole-text snapshots at debounced boundaries", async () => {
    vi.useFakeTimers();
    const setText = vi.fn();
    renderAutogrowInput({
      historyKey: "history-editor",
      text: "hello",
      setText,
      focused: false,
      placeholder: "Placeholder",
      "aria-label": "History editor",
    });
    const editor = screen.getByLabelText("History editor");

    fireEvent.keyDown(editor, { key: "z" });
    fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
    expect(setText).not.toHaveBeenCalled();

    editor.innerText = "hello, ";
    fireEvent.input(editor);
    await vi.advanceTimersByTimeAsync(TEXT_HISTORY_DEBOUNCE_MS / 2);
    editor.innerText = "hello, world";
    fireEvent.input(editor);
    await vi.advanceTimersByTimeAsync(TEXT_HISTORY_DEBOUNCE_MS);
    editor.innerText = "hello, world!";
    fireEvent.input(editor);
    await vi.advanceTimersByTimeAsync(TEXT_HISTORY_DEBOUNCE_MS);

    fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
    expect(setText).toHaveBeenLastCalledWith("hello, world");
    expect(editor.innerText).toBe("hello, world");

    fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
    expect(setText).toHaveBeenLastCalledWith("hello");

    fireEvent.keyDown(editor, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(setText).toHaveBeenLastCalledWith("hello, world");

    fireEvent.keyDown(editor, { key: "z", ctrlKey: true, shiftKey: true });
    expect(setText).toHaveBeenLastCalledWith("hello, world!");
  });

  it("uses configured shortcuts, includes pending input, and clears redo", () => {
    vi.useFakeTimers();
    const setText = vi.fn();
    renderAutogrowInput(
      {
        historyKey: "pending-history-editor",
        text: "start",
        setText,
        focused: false,
        placeholder: "Placeholder",
        "aria-label": "Pending history editor",
      },
      {
        undo: {
          ...defaultKeyboardShortcuts.undo,
          key: "U",
        },
        redo: {
          ...defaultKeyboardShortcuts.redo,
          key: "R",
          shift: false,
        },
      },
    );
    const editor = screen.getByLabelText("Pending history editor");

    editor.innerText = "pending";
    fireEvent.input(editor);
    const pendingCallCount = setText.mock.calls.length;
    fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
    expect(setText).toHaveBeenCalledTimes(pendingCallCount);
    fireEvent.keyDown(editor, { key: "u", ctrlKey: true });
    expect(setText).toHaveBeenLastCalledWith("start");

    editor.innerText = "replacement";
    fireEvent.input(editor);
    const callCount = setText.mock.calls.length;
    fireEvent.keyDown(editor, { key: "r", ctrlKey: true });
    expect(setText).toHaveBeenCalledTimes(callCount);
  });

  it("places the caret at the end when another cell is focused programmatically", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const { getUiStore } = renderBlock(false, false, true);
    const editors = await screen.findAllByLabelText("Text to synthesize");

    getUiStore().setUIStore("selectedTextBlockIndex", 1);

    await waitFor(() => expect(editors[1]).toHaveFocus());
    const selection = editors[1].ownerDocument.getSelection();
    expect(selection?.rangeCount).toBe(1);
    const caret = selection!.getRangeAt(0);
    const textEnd = editors[1].ownerDocument.createRange();
    textEnd.selectNodeContents(editors[1]);
    textEnd.collapse(false);
    expect(caret.collapsed).toBe(true);
    expect(caret.compareBoundaryPoints(Range.START_TO_START, textEnd)).toBe(0);
  });

  it("moves the selection without focusing when no editor is focused", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const { getUiStore } = renderBlock(false, false, true);
    const editors = await screen.findAllByLabelText("Text to synthesize");
    await waitFor(() => expect(editors[0]).toHaveFocus());

    editors[0].blur();
    expect(editors[0]).not.toHaveFocus();

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(1);
    expect(editors[1]).not.toHaveFocus();

    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(0);
    expect(editors[0]).not.toHaveFocus();
  });

  it("navigates between blocks with ArrowUp and ArrowDown at block boundaries", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const { getUiStore } = renderBlock(false, false, true);
    const editors = await screen.findAllByLabelText("Text to synthesize");
    await waitFor(() => expect(editors[0]).toHaveFocus());

    const setCaret = (editor: HTMLElement, placement: "start" | "end") => {
      const range = editor.ownerDocument.createRange();
      range.selectNodeContents(editor);
      range.collapse(placement === "start");
      const selection = editor.ownerDocument.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    };
    const expectCaretAt = (editor: HTMLElement, placement: "start" | "end") => {
      const edge = editor.ownerDocument.createRange();
      edge.selectNodeContents(editor);
      edge.collapse(placement === "start");
      expect(
        editor.ownerDocument
          .getSelection()!
          .getRangeAt(0)
          .compareBoundaryPoints(Range.START_TO_START, edge),
      ).toBe(0);
    };
    editors[0].textContent = editors[0].innerText;
    editors[1].textContent = editors[1].innerText;

    setCaret(editors[0], "end");
    fireEvent.keyDown(editors[0], { key: "ArrowDown" });
    await waitFor(() => expect(editors[1]).toHaveFocus());
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(1);
    expectCaretAt(editors[1], "start");

    setCaret(editors[1], "end");
    fireEvent.keyDown(editors[1], { key: "ArrowUp" });
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(1);
    expect(editors[1]).toHaveFocus();

    setCaret(editors[1], "start");
    fireEvent.keyDown(editors[1], { key: "ArrowUp" });
    await waitFor(() => expect(editors[0]).toHaveFocus());
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(0);
    expectCaretAt(editors[0], "end");
  });

  it("navigates down from the end of a multi-line block", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const { getTextStore, getUiStore } = renderBlock(false, false, true);
    const editors = await screen.findAllByLabelText("Text to synthesize");
    await waitFor(() => expect(editors[0]).toHaveFocus());

    getTextStore().setTextStore(0, "text", "line1\nline2");
    const doc = editors[0].ownerDocument;
    const firstLine = doc.createTextNode("line1");
    const secondLine = doc.createTextNode("line2");
    editors[0].replaceChildren(firstLine, doc.createElement("br"), secondLine);
    const range = doc.createRange();
    range.setStart(secondLine, secondLine.length);
    range.collapse(true);
    const selection = doc.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.keyDown(editors[0], { key: "ArrowDown" });

    await waitFor(() => expect(editors[1]).toHaveFocus());
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(1);
  });

  it("focuses the selected block and restores the last caret on Enter", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    renderBlock(false, false, true);
    const editors = await screen.findAllByLabelText("Text to synthesize");
    await waitFor(() => expect(editors[0]).toHaveFocus());

    editors[0].textContent = "hello";
    const textNode = editors[0].firstChild!;
    const range = editors[0].ownerDocument.createRange();
    range.setStart(textNode, 2);
    range.collapse(true);
    const selection = editors[0].ownerDocument.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.keyUp(editors[0]);

    editors[0].blur();
    expect(editors[0]).not.toHaveFocus();

    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() => expect(editors[0]).toHaveFocus());
    const caret = editors[0].ownerDocument.getSelection()!.getRangeAt(0);
    const beforeCaret = caret.cloneRange();
    beforeCaret.selectNodeContents(editors[0]);
    beforeCaret.setEnd(caret.startContainer, caret.startOffset);
    expect(beforeCaret.toString()).toBe("he");
  });

  it("remembers the caret when the selection is cleared before blur", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    renderBlock(false, false, true);
    const editors = await screen.findAllByLabelText("Text to synthesize");
    await waitFor(() => expect(editors[0]).toHaveFocus());

    editors[0].textContent = "hello";
    const textNode = editors[0].firstChild!;
    const range = editors[0].ownerDocument.createRange();
    range.setStart(textNode, 3);
    range.collapse(true);
    const selection = editors[0].ownerDocument.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.keyUp(editors[0]);

    selection.removeAllRanges();
    editors[0].blur();

    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() => expect(editors[0]).toHaveFocus());
    const caret = editors[0].ownerDocument.getSelection()!.getRangeAt(0);
    const beforeCaret = caret.cloneRange();
    beforeCaret.selectNodeContents(editors[0]);
    beforeCaret.setEnd(caret.startContainer, caret.startOffset);
    expect(beforeCaret.toString()).toBe("hel");
  });

  it("focuses the selected block at the end when the saved caret is for another block", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    renderBlock(false, false, true);
    const editors = await screen.findAllByLabelText("Text to synthesize");
    await waitFor(() => expect(editors[0]).toHaveFocus());

    editors[1].textContent = "second";
    editors[0].blur();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() => expect(editors[1]).toHaveFocus());
    const caret = editors[1].ownerDocument.getSelection()!.getRangeAt(0);
    const endRange = editors[1].ownerDocument.createRange();
    endRange.selectNodeContents(editors[1]);
    endRange.collapse(false);
    expect(caret.compareBoundaryPoints(Range.START_TO_START, endRange)).toBe(0);
  });

  it("focuses the last focused block with Enter after navigating away and back", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    renderBlock(false, false, true);
    const editors = await screen.findAllByLabelText("Text to synthesize");
    await waitFor(() => expect(editors[0]).toHaveFocus());

    editors[0].textContent = "hello";
    editors[1].textContent = "second";
    const setCaret = (editor: HTMLElement, placement: "start" | "end") => {
      const range = editor.ownerDocument.createRange();
      range.selectNodeContents(editor);
      range.collapse(placement === "start");
      const selection = editor.ownerDocument.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    };

    setCaret(editors[0], "end");
    fireEvent.keyDown(editors[0], { key: "ArrowDown" });
    await waitFor(() => expect(editors[1]).toHaveFocus());

    setCaret(editors[1], "start");
    fireEvent.keyDown(editors[1], { key: "ArrowUp" });
    await waitFor(() => expect(editors[0]).toHaveFocus());

    editors[0].blur();
    expect(editors[0]).not.toHaveFocus();

    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() => expect(editors[0]).toHaveFocus());
  });

  it("falls back to the end when the saved caret offset is past the block", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const { getTextStore, getUiStore } = renderBlock(false, false, true);
    const editors = await screen.findAllByLabelText("Text to synthesize");
    await waitFor(() => expect(editors[0]).toHaveFocus());

    editors[0].textContent = "hello";
    editors[0].blur();
    getUiStore().setUIStore("lastFocusedCaret", {
      blockId: getTextStore().textStore[0].id,
      offset: 100,
    });

    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() => expect(editors[0]).toHaveFocus());
    const caret = editors[0].ownerDocument.getSelection()!.getRangeAt(0);
    const endRange = editors[0].ownerDocument.createRange();
    endRange.selectNodeContents(editors[0]);
    endRange.collapse(false);
    expect(caret.compareBoundaryPoints(Range.START_TO_START, endRange)).toBe(0);
  });

  it("ignores Enter when there is no text block to focus", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const { getTextStore } = renderBlock(false, false, true);
    await screen.findAllByLabelText("Text to synthesize");

    getTextStore().setTextStore([]);

    expect(() => fireEvent.keyDown(window, { key: "Enter" })).not.toThrow();
    expect(
      screen.queryByLabelText("Text to synthesize"),
    ).not.toBeInTheDocument();
  });

  it("refreshes queries after editing and reflects buffered synthesis state", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const query = vi
      .spyOn(commands, "audioQuery")
      .mockImplementation(async (text) => ({
        status: "ok",
        data: audioQuery({ speedScale: text === "changed" ? 1.2 : 1 }),
      }));

    const { getTextStore, getConfigStore } = renderBlock(true);
    await waitFor(() => expect(query).toHaveBeenCalledWith("hello", 1));
    const status = screen.getByRole("status", { name: "Queued" });
    expect(status).toBeInTheDocument();
    fireEvent.pointerEnter(status.parentElement!, { pointerType: "mouse" });
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Queued");

    const editor = screen.getByLabelText("Text to synthesize");
    editor.innerText = "changed";
    fireEvent.input(editor);
    await waitFor(() => expect(query).toHaveBeenCalledWith("changed", 1), {
      timeout: 1_500,
    });
    await waitFor(() =>
      expect(getTextStore().textStore[0].query?.speedScale).toBe(1.2),
    );
    expect(getTextStore().textStore[0].query_is_modified).toBe(false);

    getConfigStore().setConfig("ui", "buffer_render", false);
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );

    query.mockResolvedValueOnce({ status: "error", error: "query failed" });
    editor.innerText = "broken";
    fireEvent.input(editor);
    await waitFor(
      () => expect(consoleError).toHaveBeenCalledWith("query failed"),
      { timeout: 1_500 },
    );
  });

  it("preserves a loaded query override until its source text changes", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const query = vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery({ speedScale: 1.4 }),
    });
    const { getTextStore } = renderBlock(false, true);

    await screen.findByLabelText("Text to synthesize");
    expect(query).not.toHaveBeenCalled();
    expect(getTextStore().textStore[0].query_is_modified).toBe(true);

    const editor = screen.getByLabelText("Text to synthesize");
    editor.innerText = "changed";
    fireEvent.input(editor);
    await waitFor(() => expect(query).toHaveBeenCalledWith("changed", 1), {
      timeout: 1_500,
    });
    await waitFor(() =>
      expect(getTextStore().textStore[0].query_is_modified).toBe(false),
    );
  });

  it("adds and removes blocks while preserving the final-block invariant", async () => {
    mockIPC((cmd) => (cmd === "audio_query" ? audioQuery() : null), {
      shouldMockEvents: true,
    });
    const { getTextStore } = renderBlock(false);

    const addButton = await screen.findByRole("button", {
      name: "Add text cell below",
    });
    expect(
      screen.getByRole("button", { name: "Save audio" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Move text cell up" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Move text cell down" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete text cell" }),
    ).toBeInTheDocument();
    fireEvent.click(addButton);
    expect(getTextStore().textStore).toHaveLength(2);
    expect(getTextStore().textStore[0].id).toBe("text-block");
    expect(getTextStore().textStore[1]).toMatchObject({
      text: "",
      preset_id: "preset-1",
      query: null,
      query_is_modified: false,
    });
    expect(getTextStore().textStore[1].id).not.toBe("text-block");

    fireEvent.focus(screen.getByLabelText("Text to synthesize"));
    fireEvent.click(screen.getByRole("button", { name: "Delete text cell" }));
    expect(getTextStore().textStore).toHaveLength(1);
    expect(getTextStore().textStore[0].text).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Delete text cell" }));
    expect(getTextStore().textStore).toHaveLength(1);
    expect(getTextStore().textStore[0]).toMatchObject({ text: "" });
  });

  it("splits a text cell at the caret position into the cell below", async () => {
    mockIPC((cmd) => (cmd === "audio_query" ? audioQuery() : null), {
      shouldMockEvents: true,
    });
    const { getTextStore, getUiStore } = renderBlock(false);
    const editor = await screen.findByLabelText("Text to synthesize");
    const splitButton = screen.getByRole("button", {
      name: "Split text cell",
    });
    expect(splitButton).toBeDisabled();

    const textNode = editor.ownerDocument.createTextNode("hello");
    editor.appendChild(textNode);
    const selection = editor.ownerDocument.getSelection();
    const range = editor.ownerDocument.createRange();
    range.setStart(textNode, 2);
    range.collapse(true);
    selection!.removeAllRanges();
    selection!.addRange(range);
    fireEvent.select(editor);

    expect(splitButton).toBeEnabled();
    fireEvent.click(splitButton);

    expect(getTextStore().textStore.map((block) => block.text)).toEqual([
      "he",
      "llo",
    ]);
    expect(getTextStore().textStore[1]).toMatchObject({
      preset_id: "preset-1",
      query: null,
      query_is_modified: false,
    });
    expect(getTextStore().textStore[1].id).not.toBe("text-block");
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(1);
  });

  it("keeps the split button disabled when the caret cannot split any text", async () => {
    mockIPC((cmd) => (cmd === "audio_query" ? audioQuery() : null), {
      shouldMockEvents: true,
    });
    const { getTextStore } = renderBlock(false);
    const editor = await screen.findByLabelText("Text to synthesize");
    const splitButton = screen.getByRole("button", {
      name: "Split text cell",
    });

    const textNode = editor.ownerDocument.createTextNode("hello");
    editor.appendChild(textNode);
    const placeCaret = (offset: number) => {
      const selection = editor.ownerDocument.getSelection();
      const range = editor.ownerDocument.createRange();
      range.setStart(textNode, offset);
      range.collapse(true);
      selection!.removeAllRanges();
      selection!.addRange(range);
      fireEvent.select(editor);
    };

    placeCaret(0);
    expect(splitButton).toBeDisabled();
    placeCaret(editor.innerText.length);
    expect(splitButton).toBeDisabled();

    getTextStore().setTextStore(0, "text", "");
    expect(splitButton).toBeDisabled();
  });

  it("submits buffered synthesis, filters stale events, and cancels on disable", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const synthesize = vi
      .spyOn(commands, "synthesize")
      .mockResolvedValue({ status: "ok", data: null });
    const cancel = vi.spyOn(commands, "cancelSynthesis").mockResolvedValue({
      status: "error",
      error: "cancel failed",
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { getConfigStore } = renderBlock(true);
    await waitFor(() => expect(synthesize).toHaveBeenCalledOnce());
    const request = synthesize.mock.calls[0][0];

    await events.synthesisJobEvent.emit({
      blockId: request.blockId,
      generationId: request.generationId,
      hash: "stale-hash",
      state: "Running",
      error: null,
    });
    expect(screen.getByRole("status", { name: "Queued" })).toBeInTheDocument();

    await events.synthesisJobEvent.emit({
      blockId: request.blockId,
      generationId: request.generationId,
      hash: request.hash,
      state: "Running",
      error: null,
    });
    expect(
      await screen.findByRole("status", { name: "In Progress" }),
    ).toBeInTheDocument();

    await events.synthesisJobEvent.emit({
      blockId: request.blockId,
      generationId: request.generationId,
      hash: request.hash,
      state: "Failed",
      error: "synthesis failed",
    });
    expect(
      await screen.findByRole("status", { name: "Failed" }),
    ).toBeInTheDocument();

    for (const [state, label, icon] of [
      ["Completed", "Completed", "i-lucide:check"],
      ["Cancelled", "Cancelled", "i-lucide:circle-slash"],
      ["Evicted", "No Longer Buffered", "i-lucide:archive-restore"],
    ] as const) {
      await events.synthesisJobEvent.emit({
        blockId: request.blockId,
        generationId: request.generationId,
        hash: request.hash,
        state,
        error: null,
      });
      expect(
        await screen.findByRole("status", { name: label }),
      ).toContainElement(
        document.querySelector(`.${icon.replace(":", "\\:")}`),
      );
    }

    await events.synthesisJobEvent.emit({
      blockId: "wrong-block",
      generationId: request.generationId,
      hash: request.hash,
      state: "Running",
      error: null,
    });
    await events.synthesisJobEvent.emit({
      blockId: request.blockId,
      generationId: request.generationId + 1,
      hash: request.hash,
      state: "Running",
      error: null,
    });
    expect(
      screen.getByRole("status", { name: "No Longer Buffered" }),
    ).toBeInTheDocument();

    getConfigStore().setConfig("ui", "buffer_render", false);
    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith(
        request.blockId,
        request.generationId,
      ),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith(
      "Failed to cancel synthesis for block",
      0,
      ":",
      "cancel failed",
    );

    await events.synthesisJobEvent.emit({
      blockId: request.blockId,
      generationId: request.generationId,
      hash: request.hash,
      state: "Running",
      error: null,
    });
  });

  it("reports queue failures", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const synthesize = vi.spyOn(commands, "synthesize").mockResolvedValue({
      status: "error",
      error: "queue failed",
    });
    renderBlock(true);

    await waitFor(() => expect(synthesize).toHaveBeenCalledOnce());
    expect(
      await screen.findByRole("status", { name: "Failed" }),
    ).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith(
      "Failed to queue synthesis for block",
      0,
      ":",
      "queue failed",
    );
  });

  it("uses the experimental nonblocking command only when enabled", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const blocking = vi
      .spyOn(commands, "synthesize")
      .mockResolvedValue({ status: "ok", data: null });
    const nonblocking = vi
      .spyOn(commands, "synthesizeNonblocking")
      .mockResolvedValue({ status: "ok", data: null });

    renderBlock(true, false, false, { nonblocking_synthesis: true });

    await waitFor(() => expect(nonblocking).toHaveBeenCalledOnce());
    expect(blocking).not.toHaveBeenCalled();
  });

  it("cancels active synthesis immediately before queuing a newer generation", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const synthesize = vi
      .spyOn(commands, "synthesize")
      .mockResolvedValue({ status: "ok", data: null });
    const cancel = vi
      .spyOn(commands, "cancelSynthesis")
      .mockResolvedValue({ status: "ok", data: null });
    const { getTextStore } = renderBlock(true);
    await waitFor(() => expect(synthesize).toHaveBeenCalledOnce());

    getTextStore().replaceTextBlocks([
      {
        ...getTextStore().textStore[0],
        query: audioQuery({ outputStereo: true }),
      },
    ]);

    await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(2));
    expect(cancel).toHaveBeenCalledWith(
      synthesize.mock.calls[0][0].blockId,
      synthesize.mock.calls[0][0].generationId,
    );
    expect(synthesize.mock.calls[1][0].blockId).toBe(
      synthesize.mock.calls[0][0].blockId,
    );
    expect(synthesize.mock.calls[1][0].generationId).toBeGreaterThan(
      synthesize.mock.calls[0][0].generationId,
    );
  });

  it("cancels a stale same-block request again when its delayed IPC response arrives", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    let resolveFirst!: (
      result: Awaited<ReturnType<typeof commands.synthesizeNonblocking>>,
    ) => void;
    const firstResult = new Promise<
      Awaited<ReturnType<typeof commands.synthesizeNonblocking>>
    >((resolve) => {
      resolveFirst = resolve;
    });
    let resolveSecond!: (
      result: Awaited<ReturnType<typeof commands.synthesizeNonblocking>>,
    ) => void;
    const secondResult = new Promise<
      Awaited<ReturnType<typeof commands.synthesizeNonblocking>>
    >((resolve) => {
      resolveSecond = resolve;
    });
    const synthesize = vi
      .spyOn(commands, "synthesizeNonblocking")
      .mockReturnValueOnce(firstResult)
      .mockReturnValueOnce(secondResult)
      .mockResolvedValue({ status: "ok", data: null });
    const cancel = vi
      .spyOn(commands, "cancelSynthesis")
      .mockResolvedValue({ status: "ok", data: null });
    const { getTextStore } = renderBlock(true, false, false, {
      nonblocking_synthesis: true,
    });
    await waitFor(() => expect(synthesize).toHaveBeenCalledOnce());
    const firstRequest = synthesize.mock.calls[0][0];

    getTextStore().setTextStore(0, "query", "outputStereo", true);
    await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(2));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenLastCalledWith(
      firstRequest.blockId,
      firstRequest.generationId,
    );

    resolveFirst({ status: "ok", data: null });
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
    expect(cancel).toHaveBeenLastCalledWith(
      firstRequest.blockId,
      firstRequest.generationId,
    );

    const secondRequest = synthesize.mock.calls[1][0];
    getTextStore().setTextStore(0, "query", "outputSamplingRate", 48_000);
    await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(3));
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(cancel).toHaveBeenLastCalledWith(
      secondRequest.blockId,
      secondRequest.generationId,
    );

    resolveSecond({ status: "error", error: "stale queue failure" });
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(
      screen.queryByRole("status", { name: "Failed" }),
    ).not.toBeInTheDocument();
  });

  it("resubmits buffered synthesis after nested audio query edits", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const synthesize = vi
      .spyOn(commands, "synthesize")
      .mockResolvedValue({ status: "ok", data: null });
    const { getTextStore } = renderBlock(true);
    await waitFor(() => expect(synthesize).toHaveBeenCalledOnce());

    const phrase = audioQuery().accent_phrases[0];
    getTextStore().setTextStore(
      0,
      "query",
      "accent_phrases",
      produce((phrases) => {
        phrases.splice(0, 1, { ...phrase }, { ...phrase });
      }),
    );

    await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(2));
    expect(synthesize.mock.calls[1][0].audioQuery.accent_phrases).toHaveLength(
      2,
    );

    getTextStore().setTextStore(
      0,
      "query",
      "accent_phrases",
      1,
      "moras",
      0,
      "pitch",
      5.8,
    );

    await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(3));
    expect(
      synthesize.mock.calls[2][0].audioQuery.accent_phrases[1].moras[0].pitch,
    ).toBe(5.8);
  });

  it("cancels a successful synthesis response that finishes after unmount", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    type SynthesisResult = Awaited<ReturnType<typeof commands.synthesize>>;
    let resolveSynthesis!: (result: SynthesisResult) => void;
    const synthesize = vi.spyOn(commands, "synthesize").mockReturnValue(
      new Promise((resolve) => {
        resolveSynthesis = resolve;
      }),
    );
    const cancel = vi
      .spyOn(commands, "cancelSynthesis")
      .mockResolvedValue({ status: "ok", data: null });
    const { unmount } = renderBlock(true);

    await waitFor(() => expect(synthesize).toHaveBeenCalledOnce());
    unmount();
    resolveSynthesis({ status: "ok", data: null });
    await waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it("reports missing queries and unknown synthesis states", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const synthesize = vi
      .spyOn(commands, "synthesize")
      .mockResolvedValue({ status: "ok", data: null });
    const { getTextStore, getConfigStore } = renderBlock(true);
    await waitFor(() => expect(synthesize).toHaveBeenCalledOnce());

    getTextStore().setTextStore(0, "query", null);
    expect(
      await screen.findByRole("status", { name: "No Query" }),
    ).toBeInTheDocument();

    getConfigStore().setConfig("ui", "synthesis_delay_ms", undefined);
    getTextStore().setTextStore(0, "query", audioQuery({ speedScale: 1.1 }));
    await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(2), {
      timeout: 1_500,
    });
    const request = synthesize.mock.calls[1][0];
    await events.synthesisJobEvent.emit({
      blockId: request.blockId,
      generationId: request.generationId,
      hash: request.hash,
      state: "Unknown" as never,
      error: null,
    });
    expect(
      await screen.findByRole("status", { name: "No Query" }),
    ).toContainElement(document.querySelector(".i-lucide\\:circle-dashed"));
  });

  it("normalizes audio export paths and remembers the export directory", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    vi.spyOn(commands, "joinPath").mockResolvedValue("/exports/hello");
    vi.mocked(saveDialog).mockResolvedValue("/exports/rendered");
    const saveAudio = vi
      .spyOn(commands, "saveAudio")
      .mockResolvedValue({ status: "ok", data: "/exports/rendered.wav" });
    vi.spyOn(commands, "parentPath").mockResolvedValue("/exports");

    const { getConfigStore } = renderBlock(false);
    const saveButton = await screen.findByRole("button", {
      name: "Save audio",
    });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(saveAudio).toHaveBeenCalledOnce());
    expect(saveAudio.mock.calls[0]).toMatchObject([
      "/exports/rendered.wav",
      {
        prePhonemeLength: 0.1,
        postPhonemeLength: 0.2,
      },
      1,
      false,
    ]);
    await waitFor(() =>
      expect(getConfigStore().config.ui.last_exported_dir).toBe("/exports"),
    );
    const successToast = await screen.findByRole("status", {
      name: "Audio exported successfully",
    });
    expect(successToast).toHaveClass(
      "rounded-lg",
      "border",
      "border-slate-2",
      "shadow-lg",
    );
    const progressTrack = successToast.querySelector('[role="presentation"]');
    expect(progressTrack).toHaveClass("bg-primary-2");
    expect(progressTrack?.firstElementChild).toHaveClass("bg-primary-5");
    fireEvent.click(screen.getByRole("button", { name: "Close notification" }));
    expect(successToast).toHaveAttribute("data-closed");
  });

  it("exports the selected text cell with Ctrl+E", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    vi.spyOn(commands, "joinPath").mockResolvedValue("/exports/hello");
    vi.mocked(saveDialog).mockResolvedValue("/exports/rendered.wav");
    const saveAudio = vi
      .spyOn(commands, "saveAudio")
      .mockResolvedValue({ status: "ok", data: "/exports/rendered.wav" });
    vi.spyOn(commands, "parentPath").mockResolvedValue("/exports");

    renderBlock(false);
    const editor = await screen.findByLabelText("Text to synthesize");
    fireEvent.focus(editor);
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });

    await waitFor(() => expect(saveAudio).toHaveBeenCalledOnce());
    expect(saveAudio).toHaveBeenCalledWith(
      "/exports/rendered.wav",
      expect.any(Object),
      1,
      false,
    );
  });

  it("prefers the pinned default export directory over the last exported one", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const joinPath = vi
      .spyOn(commands, "joinPath")
      .mockResolvedValue("/pinned/hello");
    vi.mocked(saveDialog).mockResolvedValue("/pinned/rendered.wav");
    const saveAudio = vi
      .spyOn(commands, "saveAudio")
      .mockResolvedValue({ status: "ok", data: "/pinned/rendered.wav" });
    vi.spyOn(commands, "parentPath").mockResolvedValue("/pinned");

    const { getConfigStore } = renderBlock(false);
    const saveButton = await screen.findByRole("button", {
      name: "Save audio",
    });
    await waitFor(() => expect(saveButton).toBeEnabled());
    getConfigStore().setConfig("ui", "default_export_dir", "/pinned");
    getConfigStore().setConfig("ui", "default_export_dir_enabled", true);
    getConfigStore().setConfig("ui", "last_exported_dir", "/last");
    fireEvent.click(saveButton);

    await waitFor(() => expect(saveAudio).toHaveBeenCalledOnce());
    expect(joinPath).toHaveBeenCalledWith("/pinned", "hello");
    expect(saveAudio.mock.calls[0]).toMatchObject([
      "/pinned/rendered.wav",
      expect.any(Object),
      1,
      false,
    ]);
  });

  it("silently saves with the default name and forwards overwrite prevention", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const joinPath = vi
      .spyOn(commands, "joinPath")
      .mockResolvedValue("/pinned/hello");
    const saveAudio = vi
      .spyOn(commands, "saveAudio")
      .mockResolvedValueOnce({ status: "ok", data: "/pinned/hello.wav" })
      .mockResolvedValueOnce({ status: "ok", data: "/pinned/hello(2).wav" });
    const parentPath = vi
      .spyOn(commands, "parentPath")
      .mockResolvedValue("/pinned");

    const { getConfigStore } = renderBlock(false);
    const saveButton = await screen.findByRole("button", {
      name: "Save audio",
    });
    await waitFor(() => expect(saveButton).toBeEnabled());
    getConfigStore().setConfig("ui", "default_export_dir", "/pinned");
    getConfigStore().setConfig("ui", "default_export_dir_enabled", true);
    getConfigStore().setConfig("ui", "silent_save", true);
    fireEvent.click(saveButton);

    await waitFor(() => expect(saveAudio).toHaveBeenCalledOnce());
    expect(saveDialog).not.toHaveBeenCalled();
    expect(joinPath).toHaveBeenCalledWith("/pinned", "hello");
    expect(saveAudio).toHaveBeenNthCalledWith(
      1,
      "/pinned/hello.wav",
      expect.any(Object),
      1,
      false,
    );

    getConfigStore().setConfig("ui", "prevent_overwrite", true);
    fireEvent.click(saveButton);

    await waitFor(() => expect(saveAudio).toHaveBeenCalledTimes(2));
    expect(saveAudio).toHaveBeenNthCalledWith(
      2,
      "/pinned/hello.wav",
      expect.any(Object),
      1,
      true,
    );
    expect(parentPath).toHaveBeenCalledWith("/pinned/hello(2).wav");
  });

  it("uses the save dialog and overwrite prevention when the default directory is off", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const joinPath = vi
      .spyOn(commands, "joinPath")
      .mockResolvedValue("/last/hello");
    const resolveAudioSavePath = vi
      .spyOn(commands, "resolveAudioSavePath")
      .mockResolvedValue({ status: "ok", data: "/last/hello(2).wav" });
    vi.mocked(saveDialog).mockResolvedValue("/last/hello.wav");
    const saveAudio = vi
      .spyOn(commands, "saveAudio")
      .mockResolvedValue({ status: "ok", data: "/last/hello.wav" });
    vi.spyOn(commands, "parentPath").mockResolvedValue("/last");

    const { getConfigStore } = renderBlock(false);
    const saveButton = await screen.findByRole("button", {
      name: "Save audio",
    });
    await waitFor(() => expect(saveButton).toBeEnabled());
    getConfigStore().setConfig("ui", "default_export_dir", "/pinned");
    getConfigStore().setConfig("ui", "default_export_dir_enabled", false);
    getConfigStore().setConfig("ui", "silent_save", true);
    getConfigStore().setConfig("ui", "prevent_overwrite", true);
    getConfigStore().setConfig("ui", "last_exported_dir", "/last");
    fireEvent.click(saveButton);

    await waitFor(() => expect(saveAudio).toHaveBeenCalledOnce());
    expect(joinPath).toHaveBeenCalledWith("/last", "hello");
    expect(resolveAudioSavePath).toHaveBeenCalledWith("/last/hello.wav");
    expect(saveDialog).toHaveBeenCalledWith({
      title: "Save Audio",
      filters: [{ name: "Audio", extensions: ["wav"] }],
      defaultPath: "/last/hello(2).wav",
    });
    expect(saveDialog).toHaveBeenCalledOnce();
    expect(saveAudio.mock.calls[0]).toMatchObject([
      "/last/hello.wav",
      expect.any(Object),
      1,
      false,
    ]);
  });

  it("falls back to the home directory when no export directory is configured", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const homeDir = vi
      .spyOn(commands, "homeDir")
      .mockResolvedValue("/home/user");
    const joinPath = vi
      .spyOn(commands, "joinPath")
      .mockResolvedValue("/home/user/hello");
    vi.mocked(saveDialog).mockResolvedValue("/home/user/rendered.wav");
    const saveAudio = vi
      .spyOn(commands, "saveAudio")
      .mockResolvedValue({ status: "ok", data: "/home/user/rendered.wav" });
    vi.spyOn(commands, "parentPath").mockResolvedValue("/home/user");

    const { getConfigStore } = renderBlock(false);
    const saveButton = await screen.findByRole("button", {
      name: "Save audio",
    });
    await waitFor(() => expect(saveButton).toBeEnabled());
    expect(getConfigStore().config.ui.last_exported_dir).toBeNull();
    expect(getConfigStore().config.ui.default_export_dir).toBeNull();
    fireEvent.click(saveButton);

    await waitFor(() => expect(saveAudio).toHaveBeenCalledOnce());
    expect(homeDir).toHaveBeenCalledOnce();
    expect(joinPath).toHaveBeenCalledWith("/home/user", "hello");
    expect(saveAudio.mock.calls[0]).toMatchObject([
      "/home/user/rendered.wav",
      expect.any(Object),
      1,
      false,
    ]);
  });

  it("handles export cancellation, existing extensions, and backend errors", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const joinPath = vi
      .spyOn(commands, "joinPath")
      .mockResolvedValue("/custom/hello");
    const resolveAudioSavePath = vi
      .spyOn(commands, "resolveAudioSavePath")
      .mockResolvedValue({
        status: "error",
        error: "path resolution failed",
      });
    vi.mocked(saveDialog)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("/custom/rendered.wav");
    const saveAudio = vi.spyOn(commands, "saveAudio").mockResolvedValue({
      status: "error",
      error: "export failed",
    });
    const { getConfigStore } = renderBlock(false);
    const saveButton = await screen.findByRole("button", {
      name: "Save audio",
    });
    await waitFor(() => expect(saveButton).toBeEnabled());

    getConfigStore().setConfig("ui", "last_exported_dir", "/custom");
    getConfigStore().setConfig("ui", "prevent_overwrite", true);
    getConfigStore().setConfig("ui", "name_truncation_len", 4);
    fireEvent.click(saveButton);
    await waitFor(() => expect(saveDialog).toHaveBeenCalledOnce());
    expect(saveAudio).not.toHaveBeenCalled();

    getConfigStore().setConfig("ui", "name_truncation_len", 10);
    fireEvent.click(saveButton);
    await waitFor(() => expect(saveAudio).toHaveBeenCalledOnce());
    expect(joinPath).toHaveBeenLastCalledWith("/custom", "hello");
    expect(resolveAudioSavePath).toHaveBeenLastCalledWith("/custom/hello.wav");
    expect(saveDialog).toHaveBeenLastCalledWith({
      title: "Save Audio",
      filters: [{ name: "Audio", extensions: ["wav"] }],
      defaultPath: "/custom/hello.wav",
    });
    expect(saveAudio).toHaveBeenCalledWith(
      "/custom/rendered.wav",
      expect.any(Object),
      1,
      false,
    );
    expect(console.error).toHaveBeenCalledWith("path resolution failed");
    expect(console.error).toHaveBeenCalledWith("export failed");
    expect(
      screen.queryByRole("status", {
        name: "Audio exported successfully",
      }),
    ).not.toBeInTheDocument();
  });

  it("moves and removes cells while keeping selection on the same content", async () => {
    mockIPC((cmd) => (cmd === "audio_query" ? audioQuery() : null), {
      shouldMockEvents: true,
    });
    const { getTextStore, getUiStore } = renderBlock(false, false, true);
    const editors = await screen.findAllByLabelText("Text to synthesize");

    fireEvent.click(
      screen.getByRole("button", { name: "Move text cell down" }),
    );
    expect(getTextStore().textStore.map((block) => block.id)).toEqual([
      "second-text-block",
      "text-block",
    ]);
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Move text cell up" }));
    expect(getTextStore().textStore.map((block) => block.id)).toEqual([
      "text-block",
      "second-text-block",
    ]);

    getUiStore().setUIStore("selectedTextBlockIndex", 1);
    fireEvent.mouseEnter(
      editors[0].parentElement!.parentElement!.parentElement!,
    );
    const deleteButtons = screen.getAllByRole("button", {
      name: "Delete text cell",
    });
    fireEvent.click(deleteButtons[0]);
    expect(getTextStore().textStore).toHaveLength(1);
    expect(getTextStore().textStore[0].id).toBe("second-text-block");
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(0);

    getTextStore().setProjectPresetStore([]);
    expect(await screen.findByText("No Preset Selected")).toBeInTheDocument();
    const editor = screen.getByLabelText("Text to synthesize");
    editor.innerText = "";
    fireEvent.input(editor);
    expect(getTextStore().textStore[0].query).toBeNull();
    expect(screen.getByRole("button", { name: "Save audio" })).toBeDisabled();
    getTextStore().setProjectPresetStore([preset()]);
  });

  it("does not let a stale query response replace newer text", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    type QueryResult = Awaited<ReturnType<typeof commands.audioQuery>>;
    let resolveHello!: (value: QueryResult) => void;
    let resolveChanged!: (value: QueryResult) => void;
    const hello = new Promise<QueryResult>((resolve) => {
      resolveHello = resolve;
    });
    const changed = new Promise<QueryResult>((resolve) => {
      resolveChanged = resolve;
    });
    const query = vi
      .spyOn(commands, "audioQuery")
      .mockImplementation((text) => (text === "hello" ? hello : changed));

    const { getTextStore } = renderBlock(false);
    await waitFor(() => expect(query).toHaveBeenCalledWith("hello", 1));
    const editor = screen.getByLabelText("Text to synthesize");
    editor.innerText = "changed";
    fireEvent.input(editor);
    await waitFor(() => expect(query).toHaveBeenCalledWith("changed", 1), {
      timeout: 1_500,
    });

    resolveChanged({
      status: "ok",
      data: audioQuery({ speedScale: 1.5 }),
    });
    await waitFor(() =>
      expect(getTextStore().textStore[0].query?.speedScale).toBe(1.5),
    );
    resolveHello({
      status: "ok",
      data: audioQuery({ speedScale: 0.5 }),
    });
    await Promise.resolve();
    expect(getTextStore().textStore[0].query?.speedScale).toBe(1.5);
  });
});
