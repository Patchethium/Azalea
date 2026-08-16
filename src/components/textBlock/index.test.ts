import { commands, events } from "$binding";
import { AutogrowInput } from "@components/textBlock/AutogrowInput";
import { renderBlock } from "@components/textBlock/testUtils";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { createComponent } from "solid-js";
import { describe, expect, it, vi } from "vitest";
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
  it("normalizes blank editable input without requiring a selection", () => {
    vi.spyOn(document, "getSelection").mockReturnValue(null);
    const setText = vi.fn();
    render(() =>
      createComponent(AutogrowInput, {
        text: "",
        setText,
        focused: true,
        placeholder: "Placeholder",
        "aria-label": "Direct editor",
      }),
    );
    const editor = screen.getByLabelText("Direct editor");
    editor.innerText = "\n";
    fireEvent.input(editor);
    expect(setText).toHaveBeenCalledWith("");
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

  it("refreshes queries after editing and reflects buffered synthesis state", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const query = vi
      .spyOn(commands, "audioQuery")
      .mockImplementation(async (text) => ({
        status: "ok",
        data: audioQuery({ speedScale: text === "changed" ? 1.2 : 1 }),
      }));

    const { getTextStore, getConfigStore } = renderBlock(true);
    await waitFor(() => expect(query).toHaveBeenCalledWith("hello", 1));
    expect(screen.getByRole("status", { name: "Queued" })).toBeInTheDocument();

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

    getConfigStore().setConfig("ui_config", "buffer_render", false);
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
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

    getConfigStore().setConfig("ui_config", "buffer_render", false);
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

    getConfigStore().setConfig("ui_config", "synthesis_delay_ms", undefined);
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
    ]);
    await waitFor(() =>
      expect(getConfigStore().config.ui_config.last_exported_dir).toBe(
        "/exports",
      ),
    );
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

    getConfigStore().setConfig("ui_config", "last_exported_dir", "/custom");
    getConfigStore().setConfig("ui_config", "name_truncation_len", 4);
    fireEvent.click(saveButton);
    await waitFor(() => expect(saveDialog).toHaveBeenCalledOnce());
    expect(saveAudio).not.toHaveBeenCalled();

    getConfigStore().setConfig("ui_config", "name_truncation_len", 10);
    fireEvent.click(saveButton);
    await waitFor(() => expect(saveAudio).toHaveBeenCalledOnce());
    expect(joinPath).toHaveBeenLastCalledWith("/custom", "hello");
    expect(saveAudio).toHaveBeenCalledWith(
      "/custom/rendered.wav",
      expect.any(Object),
      1,
    );
    expect(console.error).toHaveBeenCalledWith("export failed");
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
