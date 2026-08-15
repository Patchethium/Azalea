import { commands } from "$binding";
import {
  renderCanvas,
  renderPanel,
  renderPlaybackHook,
  renderTuningHook,
} from "@layout/bottomPanel/testUtils";
import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vitest";
import { audioQuery, mora, preset, spectrogram } from "../../test/fixtures";

describe("SpectrogramCanvas", () => {
  it("crops configured silence while retaining timeline display width", () => {
    const { container } = renderCanvas({
      values: [0, 64, 128, 255, 255, 128, 64, 0],
      frameCount: 4,
      melBins: 2,
      durationSeconds: 4,
    });
    const canvas = container.querySelector("canvas")!;

    expect(canvas.width).toBe(2);
    expect(canvas.height).toBe(2);
    expect(canvas.style.width).toBe("120px");
    expect(canvas.style.height).toBe("calc(100% - 3rem)");
    expect(canvas).not.toHaveClass("opacity-55");
  });

  it("grays stale previews and clears invalid payloads", () => {
    const { container } = renderCanvas(
      {
        values: [1],
        frameCount: 2,
        melBins: 2,
        durationSeconds: 0,
      },
      true,
    );
    const canvas = container.querySelector("canvas")!;

    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(canvas).toHaveClass("opacity-55");
    expect(canvas.style.filter).toBe("grayscale(1)");
  });

  it("rejects every malformed canvas shape and tolerates a missing context", () => {
    for (const preview of [
      {
        values: [],
        frameCount: 0,
        melBins: 2,
        durationSeconds: 1,
      },
      {
        values: [],
        frameCount: 2,
        melBins: 0,
        durationSeconds: 1,
      },
      {
        values: [1],
        frameCount: 2,
        melBins: 2,
        durationSeconds: 1,
      },
    ]) {
      const { container, unmount } = renderCanvas(preview);
      expect(container.querySelector("canvas")).toHaveAttribute("width", "0");
      unmount();
    }

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { container } = renderCanvas(spectrogram);
    expect(container.querySelector("canvas")).toHaveAttribute("width", "1");
  });
});

describe("BottomPanel playback", () => {
  it("handles playback controller boundaries and sequence races", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(commands, "playAudio").mockResolvedValue({
      status: "ok",
      data: null,
    });
    vi.spyOn(commands, "stopAudio")
      .mockResolvedValueOnce({ status: "error", error: "stop failed" })
      .mockResolvedValue({ status: "ok", data: null });
    type SequenceResult = Awaited<
      ReturnType<typeof commands.playAudioSequence>
    >;
    let resolveFirst!: (result: SequenceResult) => void;
    let resolveSecond!: (result: SequenceResult) => void;
    const first = new Promise<SequenceResult>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<SequenceResult>((resolve) => {
      resolveSecond = resolve;
    });
    const playSequence = vi
      .spyOn(commands, "playAudioSequence")
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockResolvedValue({ status: "error", error: "sequence failed" });
    const synthesized = vi.fn();
    const { getControls, getTextStore, getUiStore } =
      renderPlaybackHook(synthesized);
    await Promise.resolve();
    const controls = getControls();
    const text = getTextStore();
    const ui = getUiStore();

    controls.focusPrev();
    controls.focusNext("wrong-block");
    expect(ui.uiStore.selectedTextBlockIndex).toBe(0);
    controls.focusNext();
    expect(ui.uiStore.selectedTextBlockIndex).toBe(1);
    controls.focusNext(undefined, false);
    expect(text.textStore).toHaveLength(2);
    controls.focusNext(undefined, true);
    expect(text.textStore).toHaveLength(3);

    text.replaceTextBlocks(text.textStore.slice(0, 2));
    ui.setUIStore("selectedTextBlockIndex", 0);
    await controls.togglePlayback();
    expect(controls.isPlaying()).toBe(true);
    await controls.togglePlayback();
    expect(controls.isPlaying()).toBe(true);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to stop audio:",
      "stop failed",
    );
    await controls.togglePlayback();
    expect(controls.isPlaying()).toBe(false);
    synthesized.mockClear();

    text.setTextStore(0, "query", null);
    text.setTextStore(1, "query", null);
    await controls.speakAllFromSelection();
    expect(playSequence).not.toHaveBeenCalled();
    text.setTextStore(0, "query", audioQuery());
    text.setTextStore(1, "query", audioQuery({ speedScale: 1.1 }));

    await emit("audio-sequence-item-started", 0);
    const firstRun = controls.speakAllFromSelection();
    await waitFor(() => expect(playSequence).toHaveBeenCalledOnce());
    await controls.speakAllFromSelection();
    expect(playSequence).toHaveBeenCalledOnce();
    await emit("audio-sequence-item-started", Number.NaN);
    await emit("audio-sequence-item-started", -1);
    await emit("audio-sequence-item-started", 99);
    await emit("audio-sequence-item-started", 0);
    await emit("audio-sequence-item-started", 0);
    expect(synthesized).toHaveBeenCalledOnce();
    text.replaceTextBlocks([text.textStore[0]]);
    await emit("audio-sequence-item-started", 1);
    expect(synthesized).toHaveBeenCalledOnce();
    resolveFirst({ status: "ok", data: null });
    await firstRun;
    expect(controls.isPlaying()).toBe(true);

    await emit("audio-playback-finished");
    const secondRun = controls.speakAllFromSelection();
    await waitFor(() => expect(playSequence).toHaveBeenCalledTimes(2));
    await emit("audio-playback-finished");
    resolveSecond({ status: "error", error: "late failure" });
    await secondRun;

    await controls.speakAllFromSelection();
    expect(playSequence).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to play audio sequence:",
      "sequence failed",
    );
  });

  it("labels and navigates between adjacent text cells", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const { getUiStore } = renderPanel();

    const previous = await screen.findByRole("button", {
      name: "Select previous text cell",
    });
    const next = screen.getByRole("button", {
      name: "Select next text cell",
    });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();

    fireEvent.click(next);
    await waitFor(() =>
      expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(1),
    );
    expect(previous).toBeEnabled();
    expect(next).toBeDisabled();

    fireEvent.click(previous);
    await waitFor(() =>
      expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(0),
    );
  });

  it("plays, stops, reacts to completion, and builds a sequence from valid blocks", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const play = vi
      .spyOn(commands, "playAudio")
      .mockResolvedValue({ status: "ok", data: null });
    const stop = vi
      .spyOn(commands, "stopAudio")
      .mockResolvedValue({ status: "ok", data: null });
    const sequence = vi
      .spyOn(commands, "playAudioSequence")
      .mockResolvedValue({ status: "ok", data: null });

    renderPanel();
    const playButton = await screen.findByRole("button", {
      name: "Play selected cell",
    });
    fireEvent.click(playButton);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    expect(play.mock.calls[0]).toMatchObject([
      {
        prePhonemeLength: 0.1,
        postPhonemeLength: 0.2,
      },
      1,
    ]);

    const stopButton = await screen.findByRole("button", {
      name: "Stop playback",
    });
    fireEvent.click(stopButton);
    await waitFor(() => expect(stop).toHaveBeenCalledOnce());

    fireEvent.click(
      screen.getByRole("button", {
        name: "Play selected cell and all cells below",
      }),
    );
    await waitFor(() => expect(sequence).toHaveBeenCalledOnce());
    expect(sequence.mock.calls[0][0]).toHaveLength(2);

    await emit("audio-playback-finished");
    expect(
      await screen.findByRole("button", { name: "Play selected cell" }),
    ).toBeInTheDocument();
  });

  it("focuses each playable text cell as play-all advances", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    vi.spyOn(commands, "playAudioSequence").mockResolvedValue({
      status: "ok",
      data: null,
    });
    const { getTextStore, getUiStore } = renderPanel();
    await screen.findByRole("button", { name: "Play selected cell" });
    getTextStore().replaceTextBlocks([
      getTextStore().textStore[0],
      {
        ...getTextStore().textStore[1],
        query: null,
      },
      {
        id: "third-block",
        text: "third",
        query: audioQuery({ speedScale: 1.2 }),
        query_is_modified: false,
        preset_id: 0,
      },
    ]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Play selected cell and all cells below",
      }),
    );
    await waitFor(() =>
      expect(commands.playAudioSequence).toHaveBeenCalledOnce(),
    );
    expect(vi.mocked(commands.playAudioSequence).mock.calls[0][0]).toHaveLength(
      2,
    );
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(0);

    await emit("audio-sequence-item-started", 1);
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(2);

    await emit("audio-sequence-item-started", 0);
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(2);

    await emit("audio-playback-finished");
    await emit("audio-sequence-item-started", 0);
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(2);
  });

  it("honors play-and-advance shortcuts while editing text", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const play = vi
      .spyOn(commands, "playAudio")
      .mockResolvedValue({ status: "ok", data: null });
    const { getUiStore } = renderPanel();
    await screen.findByRole("button", { name: "Play selected cell" });

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "plaintext-only");
    document.body.append(editor);

    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(0);

    await emit("audio-playback-finished");
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(1),
    );

    editor.remove();
  });

  it("blocks playback in text fields, overlays, repeats, and IME composition", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const play = vi
      .spyOn(commands, "playAudio")
      .mockResolvedValue({ status: "ok", data: null });
    const stop = vi
      .spyOn(commands, "stopAudio")
      .mockResolvedValue({ status: "ok", data: null });
    renderPanel();
    await screen.findByRole("button", { name: "Play selected cell" });

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: " " });

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "plaintext-only");
    const editorChild = document.createElement("span");
    editor.append(editorChild);
    document.body.append(editor);
    expect(fireEvent.keyDown(editorChild, { key: " " })).toBe(true);

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    fireEvent.keyDown(window, { key: " " });
    dialog.remove();

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    fireEvent.keyDown(window, { key: " " });
    menu.remove();

    fireEvent.keyDown(window, {
      key: " ",
      repeat: true,
    });
    fireEvent.keyDown(window, {
      key: " ",
      isComposing: true,
    });
    await Promise.resolve();

    expect(play).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    input.remove();
    editor.remove();
  });

  it("shows loading while playback starts and toggles with bare Space", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    let resolvePlayback!: (
      result: Awaited<ReturnType<typeof commands.playAudio>>,
    ) => void;
    const pendingPlayback = new Promise<
      Awaited<ReturnType<typeof commands.playAudio>>
    >((resolve) => {
      resolvePlayback = resolve;
    });
    const play = vi
      .spyOn(commands, "playAudio")
      .mockReturnValue(pendingPlayback);
    const stop = vi
      .spyOn(commands, "stopAudio")
      .mockResolvedValue({ status: "ok", data: null });
    renderPanel();
    await screen.findByRole("button", { name: "Play selected cell" });

    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyDown(window, { key: " " });
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    expect(stop).not.toHaveBeenCalled();
    const loadingButton = screen.getByRole("button", { name: "Loading" });
    expect(loadingButton).toHaveAttribute("aria-busy", "true");
    expect(loadingButton.firstElementChild).toHaveClass(
      "i-lucide:loader-circle",
      "animate-spin",
    );

    resolvePlayback({ status: "ok", data: null });
    await pendingPlayback;
    expect(
      await screen.findByRole("button", { name: "Stop playback" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: " " });
    await waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("button", { name: "Play selected cell" }),
    ).toBeInTheDocument();

    expect(fireEvent.keyDown(window, { key: " ", ctrlKey: true })).toBe(true);
    expect(play).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("plays after tabs and sidebar controls retain focus unless a menu is open", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const play = vi
      .spyOn(commands, "playAudio")
      .mockResolvedValue({ status: "ok", data: null });
    renderPanel({}, true);
    await screen.findByRole("button", { name: "Create preset" });

    const playFrom = async (control: HTMLElement, expectedCalls: number) => {
      control.focus();
      expect(fireEvent.keyDown(control, { key: " " })).toBe(false);
      await waitFor(() => expect(play).toHaveBeenCalledTimes(expectedCalls));
      expect(control).toHaveAttribute("data-playback-shortcut-focus");
      await emit("audio-playback-finished");
    };

    const tuningTab = screen.getByRole("tab", { name: "Tuning" });
    fireEvent.click(tuningTab);
    await playFrom(tuningTab, 1);

    const accentTab = screen.getByRole("tab", { name: "Accent" });
    fireEvent.click(accentTab);
    await playFrom(accentTab, 2);
    expect(tuningTab).not.toHaveAttribute("data-playback-shortcut-focus");

    const presetToggle = screen.getByRole("button", { name: "Preset" });
    fireEvent.click(presetToggle);
    const presetExpanded = presetToggle.getAttribute("aria-expanded");
    await playFrom(presetToggle, 3);
    expect(presetToggle).toHaveAttribute("aria-expanded", presetExpanded);

    fireEvent.click(presetToggle);
    const speakerSelect = await screen.findByRole("button", {
      name: "Speaker Speaker",
    });
    await playFrom(speakerSelect, 4);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    const createPreset = screen.getByRole("button", {
      name: "Create preset",
    });
    fireEvent.click(createPreset);
    await playFrom(createPreset, 5);

    const menuTrigger = screen.getByRole("button", {
      name: "Project actions",
    });
    fireEvent.keyDown(menuTrigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(menuTrigger).not.toHaveAttribute("data-playback-shortcut-focus");
    expect(fireEvent.keyDown(window, { key: " " })).toBe(true);
    expect(play).toHaveBeenCalledTimes(5);

    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(menu).toHaveAttribute("data-closed"));
    await playFrom(menuTrigger, 6);
    expect(menu).toHaveAttribute("data-closed");
    fireEvent.keyDown(menuTrigger, { key: "A" });
    expect(menuTrigger).not.toHaveAttribute("data-playback-shortcut-focus");
  });

  it("honors a configured playback-toggle shortcut", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const play = vi
      .spyOn(commands, "playAudio")
      .mockResolvedValue({ status: "ok", data: null });
    renderPanel({
      shortcuts: {
        toggle_playback: { key: "P", alt: true },
      },
    });
    await screen.findByRole("button", { name: "Play selected cell" });

    expect(fireEvent.keyDown(window, { key: " " })).toBe(true);
    expect(play).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "P", altKey: true });
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
  });

  it("advances only after playable audio starts and creates after the final cell", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const play = vi
      .spyOn(commands, "playAudio")
      .mockResolvedValueOnce({ status: "error", error: "playback failed" })
      .mockResolvedValue({ status: "ok", data: null });
    const { getTextStore, getUiStore } = renderPanel();
    await screen.findByRole("button", { name: "Play selected cell" });

    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(0);

    getTextStore().setTextStore(0, "query", null);
    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    expect(play).toHaveBeenCalledOnce();
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(0);
    expect(getTextStore().textStore).toHaveLength(2);

    getTextStore().setTextStore(0, "query", audioQuery());
    getTextStore().setProjectPresetStore([]);
    fireEvent.keyDown(window, { key: " " });
    expect(play).toHaveBeenCalledOnce();

    getTextStore().setProjectPresetStore([preset()]);
    getUiStore().setUIStore("selectedTextBlockIndex", 1);
    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getTextStore().textStore).toHaveLength(3));
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(2);
    expect(getTextStore().textStore[2]).toMatchObject({
      text: "",
      preset_id: 0,
      query: null,
      query_is_modified: false,
    });
    expect(getTextStore().textStore[2].id).not.toBe("first-block");
    expect(getTextStore().textStore[2].id).not.toBe("second-block");
  });

  it("does not create or move after selection changes during playback startup", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    let resolvePlayback!: (
      result: Awaited<ReturnType<typeof commands.playAudio>>,
    ) => void;
    const pendingPlayback = new Promise<
      Awaited<ReturnType<typeof commands.playAudio>>
    >((resolve) => {
      resolvePlayback = resolve;
    });
    const play = vi
      .spyOn(commands, "playAudio")
      .mockReturnValue(pendingPlayback);
    const { getTextStore, getUiStore } = renderPanel();
    await screen.findByRole("button", { name: "Play selected cell" });
    getTextStore().replaceTextBlocks([
      {
        id: "first-block",
        text: "first",
        query: audioQuery(),
        query_is_modified: false,
        preset_id: 0,
      },
      {
        id: "second-block",
        text: "second",
        query: audioQuery({ speedScale: 1.1 }),
        query_is_modified: false,
        preset_id: 0,
      },
      {
        id: "third-block",
        text: "third",
        query: audioQuery({ speedScale: 1.2 }),
        query_is_modified: false,
        preset_id: 0,
      },
    ]);

    getUiStore().setUIStore("selectedTextBlockIndex", 2);
    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(2);

    getUiStore().setUIStore("selectedTextBlockIndex", 1);
    resolvePlayback({ status: "ok", data: null });
    await pendingPlayback;
    await Promise.resolve();
    expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(1);
    expect(getTextStore().textStore).toHaveLength(3);
  });

  it("refreshes after playback without buffering, preserves stale previews, and clears when disabled", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    vi.spyOn(commands, "playAudio").mockResolvedValue({
      status: "ok",
      data: null,
    });
    let resolveReplacement!: (
      value: Awaited<ReturnType<typeof commands.getSpectrogramPreview>>,
    ) => void;
    const replacement = new Promise<
      Awaited<ReturnType<typeof commands.getSpectrogramPreview>>
    >((resolve) => {
      resolveReplacement = resolve;
    });
    const getPreview = vi
      .spyOn(commands, "getSpectrogramPreview")
      .mockResolvedValueOnce({ status: "ok", data: spectrogram })
      .mockReturnValueOnce(replacement);
    const { container, getConfigStore, getTextStore } = renderPanel({
      buffer_render: false,
    });

    fireEvent.click(await screen.findByRole("tab", { name: "Tuning" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Play selected cell" }),
    );
    await waitFor(() => expect(getPreview).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(container.querySelector("canvas")).toBeInTheDocument(),
    );
    expect(container.querySelector("canvas")).not.toHaveClass("opacity-55");

    await emit("audio-playback-finished");
    getTextStore().setTextStore(0, "query", "speedScale", 1.25);
    fireEvent.click(
      await screen.findByRole("button", { name: "Play selected cell" }),
    );
    await waitFor(() => expect(getPreview).toHaveBeenCalledTimes(2));
    expect(container.querySelector("canvas")).toHaveClass("opacity-55");

    resolveReplacement({
      status: "ok",
      data: {
        ...spectrogram,
        values: [255, 128, 64, 0],
      },
    });
    await waitFor(() =>
      expect(container.querySelector("canvas")).not.toHaveClass("opacity-55"),
    );

    getConfigStore().setSpectrogramPreviewEnabled(false);
    await waitFor(() =>
      expect(container.querySelector("canvas")).not.toBeInTheDocument(),
    );
  });

  it("refreshes with buffering and rejects an older async preview", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    type PreviewResult = Awaited<
      ReturnType<typeof commands.getSpectrogramPreview>
    >;
    let resolveFirst!: (value: PreviewResult) => void;
    let resolveSecond!: (value: PreviewResult) => void;
    const first = new Promise<PreviewResult>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<PreviewResult>((resolve) => {
      resolveSecond = resolve;
    });
    const getPreview = vi
      .spyOn(commands, "getSpectrogramPreview")
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const { container, getTextStore } = renderPanel({
      buffer_render: true,
      synthesis_delay_ms: 0,
    });

    fireEvent.click(await screen.findByRole("tab", { name: "Tuning" }));
    await waitFor(() => expect(getPreview).toHaveBeenCalledOnce());
    getTextStore().setTextStore(0, "query", "speedScale", 1.25);
    await waitFor(() => expect(getPreview).toHaveBeenCalledTimes(2));

    resolveSecond({
      status: "ok",
      data: {
        values: [0, 64, 128, 128, 192, 255],
        frameCount: 3,
        melBins: 2,
        durationSeconds: 1,
      },
    });
    await waitFor(() =>
      expect(container.querySelector("canvas")?.width).toBe(3),
    );

    resolveFirst({
      status: "ok",
      data: {
        values: [255, 0],
        frameCount: 1,
        melBins: 2,
        durationSeconds: 1,
      },
    });
    await Promise.resolve();
    expect(container.querySelector("canvas")?.width).toBe(3);
  });

  it("updates an edited accent phrase through the backend", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const replacement = structuredClone(audioQuery().accent_phrases[0]);
    replacement.moras[0].text = "サ";
    const replaceAccent = vi
      .spyOn(commands, "accentPhrases")
      .mockResolvedValue({ status: "ok", data: [replacement] });
    const { getTextStore } = renderPanel();

    fireEvent.click(await screen.findByText("コ"));
    const editor = (await screen.findByRole("textbox")) as HTMLInputElement;
    await waitFor(() => {
      expect(editor).toHaveFocus();
      expect(editor.selectionStart).toBe(0);
      expect(editor.selectionEnd).toBe(editor.value.length);
    });
    fireEvent.input(editor, { target: { value: "サ" } });
    fireEvent.click(editor.parentElement!.parentElement!);

    await waitFor(() => expect(replaceAccent).toHaveBeenCalledWith("サ", 1));
    await waitFor(() =>
      expect(
        getTextStore().textStore[0].query?.accent_phrases[0].moras[0].text,
      ).toBe("サ"),
    );
    expect(getTextStore().textStore[0].query_is_modified).toBe(true);
  });

  it("does not append the following phrase when editing phonemes", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const firstPhrase = structuredClone(audioQuery().accent_phrases[0]);
    const secondPhrase = structuredClone(firstPhrase);
    secondPhrase.moras[0].text = "エ";
    const replaceAccent = vi
      .spyOn(commands, "accentPhrases")
      .mockImplementation(async (text) => ({
        status: "ok",
        data: [
          {
            ...structuredClone(firstPhrase),
            moras: Array.from(text, (character) => ({
              ...firstPhrase.moras[0],
              text: character,
            })),
          },
        ],
      }));
    const { getTextStore } = renderPanel();

    await screen.findByText("コ");
    getTextStore().setTextStore(0, "query", "accent_phrases", [
      firstPhrase,
      secondPhrase,
    ]);
    fireEvent.click(await screen.findByText("コ"));
    const editor = await screen.findByRole("textbox");
    fireEvent.input(editor, { target: { value: "サ" } });
    fireEvent.click(editor.parentElement!.parentElement!);

    await waitFor(() => expect(replaceAccent).toHaveBeenCalledWith("サ", 1));
    await waitFor(() =>
      expect(
        getTextStore().textStore[0].query?.accent_phrases.map((phrase) =>
          phrase.moras.map((mora) => mora.text).join(""),
        ),
      ).toEqual(["サ", "エ"]),
    );
  });

  it("shows normalized mora text after a mixed-kana edit", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const replacement = structuredClone(audioQuery().accent_phrases[0]);
    replacement.moras = Array.from("コンニチワ", (character) => ({
      ...replacement.moras[0],
      text: character,
    }));
    const replaceAccent = vi
      .spyOn(commands, "accentPhrases")
      .mockResolvedValue({ status: "ok", data: [replacement] });
    const { getTextStore } = renderPanel();

    fireEvent.click(await screen.findByText("コ"));
    const editor = await screen.findByRole("textbox");
    fireEvent.input(editor, { target: { value: "コンニちは" } });
    fireEvent.click(editor.parentElement!.parentElement!);

    await waitFor(() =>
      expect(replaceAccent).toHaveBeenCalledWith("コンニちは", 1),
    );
    await waitFor(() =>
      expect(
        getTextStore()
          .textStore[0].query?.accent_phrases[0].moras.map((mora) => mora.text)
          .join(""),
      ).toBe("コンニチワ"),
    );

    fireEvent.click(screen.getByText("コ"));
    expect(await screen.findByRole("textbox")).toHaveValue("コンニチワ");
  });

  it("splits, combines, and adds a pause to accent phrases", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const replaceMora = vi
      .spyOn(commands, "replaceMora")
      .mockImplementation(async (phrases) => ({
        status: "ok",
        data: JSON.parse(JSON.stringify(phrases)),
      }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getTextStore } = renderPanel();
    await screen.findByText("コ");
    getTextStore().setTextStore(0, "query", "accent_phrases", [
      {
        moras: [
          { ...mora },
          {
            ...mora,
            text: "ン",
            consonant: "n",
            vowel: "N",
          },
        ],
        accent: 2,
        pause_mora: null,
        is_interrogative: false,
      },
    ]);

    const connection = await screen.findByLabelText("Accent connection line");
    fireEvent.mouseEnter(connection.parentElement!);
    expect(connection.firstElementChild).toHaveAttribute(
      "stroke-dasharray",
      "4 2",
    );
    fireEvent.click(connection.parentElement!);
    expect(getTextStore().textStore[0].query?.accent_phrases).toHaveLength(2);
    await waitFor(() => expect(replaceMora).toHaveBeenCalledOnce());

    const firstMora = screen.getByText("コ");
    const combineTarget = firstMora.nextElementSibling as HTMLElement;
    fireEvent.click(combineTarget);
    expect(getTextStore().textStore[0].query?.accent_phrases).toHaveLength(1);

    const lastMora = screen.getByText("ン");
    const pauseTarget = lastMora.nextElementSibling!.firstElementChild!;
    fireEvent.mouseEnter(pauseTarget);
    fireEvent.click(pauseTarget);
    expect(
      getTextStore().textStore[0].query?.accent_phrases[0].pause_mora?.vowel,
    ).toBe("pau");

    const accentSlider = screen
      .getAllByRole("slider")
      .find((element) => element.tagName === "SPAN")!;
    fireEvent.keyDown(accentSlider, { key: "ArrowLeft" });
    expect(getTextStore().textStore[0].query?.accent_phrases[0].accent).toBe(1);

    fireEvent.click(screen.getByText("コ"));
    const staleEditor = await screen.findByRole("textbox");
    getTextStore().setTextStore([]);
    document.body.append(
      staleEditor,
      connection.parentElement!,
      combineTarget,
      accentSlider,
    );
    fireEvent.input(staleEditor, { target: { value: "stale" } });
    fireEvent.keyDown(staleEditor, { key: "Enter" });
    fireEvent.click(connection.parentElement!);
    fireEvent.click(combineTarget);
    fireEvent.keyDown(accentSlider, { key: "ArrowRight" });
    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith("No accent phrases to split"),
    );
    expect(console.error).toHaveBeenCalledWith("No accent phrases to combine");
    expect(
      await screen.findByText("No text cell selected"),
    ).toBeInTheDocument();
    staleEditor.remove();
    connection.parentElement?.remove();
    combineTarget.remove();
    accentSlider.remove();
  });

  it("rejects invalid phrase edits and stale backend replacements", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(commands, "replaceMora").mockResolvedValue({
      status: "error",
      error: "replace failed",
    });
    type AccentResult = Awaited<ReturnType<typeof commands.accentPhrases>>;
    let resolveStale!: (result: AccentResult) => void;
    const stale = new Promise<AccentResult>((resolve) => {
      resolveStale = resolve;
    });
    const accentPhrases = vi
      .spyOn(commands, "accentPhrases")
      .mockResolvedValueOnce({ status: "error", error: "invalid" })
      .mockResolvedValueOnce({ status: "ok", data: [] })
      .mockReturnValueOnce(stale);
    const { getTextStore } = renderPanel();
    await screen.findByText("コ");

    const edit = async (value: string) => {
      fireEvent.click(screen.getByText("コ"));
      const editor = await screen.findByRole("textbox");
      fireEvent.input(editor, { target: { value } });
      fireEvent.keyDown(editor, { key: "Enter" });
    };
    await edit("エラー");
    await waitFor(() => expect(accentPhrases).toHaveBeenCalledTimes(1));
    await edit("空");
    await waitFor(() => expect(accentPhrases).toHaveBeenCalledTimes(2));

    await edit("古い");
    await waitFor(() => expect(accentPhrases).toHaveBeenCalledTimes(3));
    getTextStore().setTextStore(0, {
      ...getTextStore().textStore[0],
      text: "replacement block",
    });
    resolveStale({
      status: "ok",
      data: [structuredClone(audioQuery().accent_phrases[0])],
    });
    await stale;
    expect(getTextStore().textStore[0].text).toBe("replacement block");

    getTextStore().setProjectPresetStore([]);
    await edit("プリセットなし");
    await Promise.resolve();
    expect(accentPhrases).toHaveBeenCalledTimes(3);

    getTextStore().setProjectPresetStore([preset()]);
    const moraElement = screen.getByText("コ");
    fireEvent.click(moraElement.nextElementSibling!);
    await waitFor(() => expect(commands.replaceMora).toHaveBeenCalledOnce());
    expect(console.error).toHaveBeenCalledWith(
      "Invalid accent phrase index to combine",
    );
  });

  it("updates tuning values and zoom through the panel controller", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const {
      container,
      getConfigStore,
      getPanel,
      getTextStore,
      getUiStore,
      unmount,
    } = renderTuningHook({ spectrogram_preview: false });
    await Promise.resolve();
    const panel = getPanel();
    const text = getTextStore();
    text.setTextStore(
      0,
      "query",
      audioQuery({
        accent_phrases: [
          {
            moras: [
              { ...mora },
              {
                ...mora,
                text: "ア",
                consonant: null,
                consonant_length: null,
                vowel: "a",
                vowel_length: 0.2,
                pitch: 0,
              },
            ],
            accent: 1,
            pause_mora: {
              text: "、",
              consonant: null,
              consonant_length: null,
              vowel: "pau",
              vowel_length: 0.3,
              pitch: 0,
            },
            is_interrogative: false,
          },
        ],
      }),
    );

    expect(panel.queryExists()).toBe(true);
    expect(panel.timelineDuration()).toBeCloseTo(0.7);
    expect(panel.minPitch()).toBeCloseTo(3.4);
    expect(panel.maxPitch()).toBe(6.5);

    panel.setDraggingData({
      apIndex: 0,
      moraIndex: 0,
      originData: 0.08,
      mode: "consonant",
    });
    panel.setStartX(100);
    panel.handleDragging(new MouseEvent("mousemove", { clientX: 136 }));
    expect(
      text.textStore[0].query?.accent_phrases[0].moras[0].consonant_length,
    ).toBeCloseTo(0.18);

    panel.setDraggingData({
      apIndex: 0,
      moraIndex: 1,
      originData: 0.2,
      mode: "vowel",
    });
    panel.handleDragging(new MouseEvent("mousemove", { clientX: -1000 }));
    expect(
      text.textStore[0].query?.accent_phrases[0].moras[1].vowel_length,
    ).toBe(0.01);

    panel.setDraggingData({
      apIndex: 0,
      moraIndex: -1,
      originData: 0.3,
      mode: "pause",
    });
    panel.handleDragging(new MouseEvent("mousemove", { clientX: -1000 }));
    expect(
      text.textStore[0].query?.accent_phrases[0].pause_mora?.vowel_length,
    ).toBe(0);
    panel.setPitch(0, 0, 5.8);
    expect(text.textStore[0].query?.accent_phrases[0].moras[0].pitch).toBe(5.8);
    expect(text.textStore[0].query_is_modified).toBe(true);

    panel.handleDragFinish();
    panel.handleDragging(new MouseEvent("mousemove", { clientX: 200 }));
    const plainWheel = new WheelEvent("wheel", { deltaY: 1 });
    panel.handleWheel(plainWheel);
    expect(panel.scale()).toBe(360);
    const zoomOut = new WheelEvent("wheel", {
      ctrlKey: true,
      deltaY: 1,
      cancelable: true,
    });
    panel.handleWheel(zoomOut);
    expect(zoomOut.defaultPrevented).toBe(true);
    expect(panel.scale()).toBe(310);
    panel.handleWheel(new WheelEvent("wheel", { ctrlKey: true, deltaY: -1 }));
    expect(panel.scale()).toBe(360);
    panel.setScale(451.9);
    expect(panel.scale()).toBe(451);

    getConfigStore().setRange(null);
    expect(panel.minPitch()).toBe(0);
    expect(panel.maxPitch()).toBe(0);
    text.setTextStore([]);
    expect(panel.queryExists()).toBe(false);
    panel.setPitch(0, 0, 1);
    panel.setPauseLength(0, 1);

    Object.defineProperty(container.firstElementChild!, "scrollLeft", {
      configurable: true,
      value: 77,
    });
    unmount();
    expect(getUiStore().uiStore.bottom_scroll_pos).toBe(77);
  });

  it("renders consonantless and pause tuning items", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const { container, getConfigStore, getTextStore } = renderPanel({
      spectrogram_preview: false,
    });
    await screen.findByText("コ");
    getConfigStore().setConfig("ui_config", "bottom_scale", undefined);
    getTextStore().setTextStore(
      0,
      "query",
      audioQuery({
        accent_phrases: [
          {
            moras: [
              {
                ...mora,
                text: "ア",
                consonant: null,
                consonant_length: null,
                vowel: "a",
                pitch: 0,
              },
            ],
            accent: 1,
            pause_mora: {
              text: "、",
              consonant: null,
              consonant_length: null,
              vowel: "pau",
              vowel_length: 0.3,
              pitch: 0,
            },
            is_interrogative: false,
          },
        ],
      }),
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Tuning" }));
    expect(await screen.findAllByText("ア")).toHaveLength(2);
    const durationTargets = container.querySelectorAll("div.invisible");
    expect(durationTargets).toHaveLength(2);
    fireEvent.mouseDown(durationTargets[0], { clientX: 10 });
    fireEvent.mouseDown(durationTargets[1], { clientX: 20 });
    expect(container.querySelectorAll('[role="slider"]')).toHaveLength(2);
  });

  it("handles spectrogram failures and playback-triggered refreshes", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const getPreview = vi
      .spyOn(commands, "getSpectrogramPreview")
      .mockResolvedValueOnce({ status: "error", error: "preview failed" })
      .mockRejectedValueOnce(new Error("preview threw"))
      .mockResolvedValue({ status: "ok", data: spectrogram });
    const { getConfigStore, getTextStore, setNotice } = renderTuningHook({
      buffer_render: true,
      synthesis_delay_ms: -10,
    });

    await waitFor(() => expect(getPreview).toHaveBeenCalledOnce());
    expect(console.error).toHaveBeenCalledWith(
      "Failed to create spectrogram preview:",
      "preview failed",
    );
    getTextStore().setTextStore(0, "query", "speedScale", 1.25);
    await waitFor(() => expect(getPreview).toHaveBeenCalledTimes(2));
    expect(console.error).toHaveBeenCalledWith(
      "Failed to create spectrogram preview:",
      expect.any(Error),
    );

    getConfigStore().setConfig("ui_config", "buffer_render", false);
    setNotice({
      blockId: "first-block",
      audioQuery: audioQuery(),
      speakerId: 1,
    });
    await waitFor(() => expect(getPreview).toHaveBeenCalledTimes(3));
    getConfigStore().setSpectrogramPreviewEnabled(false);
    setNotice({
      blockId: "first-block",
      audioQuery: audioQuery({ speedScale: 1.5 }),
      speakerId: 1,
    });
    await Promise.resolve();
    expect(getPreview).toHaveBeenCalledTimes(3);
  });

  it("edits pitch and duration and plays while the pitch slider stays focused", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const play = vi
      .spyOn(commands, "playAudio")
      .mockResolvedValue({ status: "ok", data: null });
    const stop = vi
      .spyOn(commands, "stopAudio")
      .mockResolvedValue({ status: "ok", data: null });
    const { getTextStore } = renderPanel({ spectrogram_preview: false });

    fireEvent.click(await screen.findByRole("tab", { name: "Tuning" }));
    const consonant = await screen.findByText("k");
    const timeline = consonant.parentElement!.parentElement!.parentElement!;

    const pitch = screen
      .getAllByRole("slider")
      .find((slider) => slider.getAttribute("aria-orientation") === "vertical");
    expect(pitch).toBeDefined();
    pitch!.focus();
    fireEvent.keyDown(pitch!, { key: "ArrowUp" });
    await waitFor(() =>
      expect(
        getTextStore().textStore[0].query?.accent_phrases[0].moras[0].pitch,
      ).toBeCloseTo(5.41),
    );
    expect(getTextStore().textStore[0].query_is_modified).toBe(true);

    fireEvent.keyDown(pitch!, { key: " " });
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    expect(play.mock.calls[0][0].accent_phrases[0].moras[0].pitch).toBeCloseTo(
      5.41,
    );

    await emit("audio-playback-finished");
    fireEvent.mouseDown(consonant, { clientX: 100 });
    fireEvent.mouseMove(timeline, { clientX: 136 });
    fireEvent.mouseUp(timeline, { clientX: 136 });
    expect(
      getTextStore().textStore[0].query?.accent_phrases[0].moras[0]
        .consonant_length,
    ).toBeCloseTo(0.18);
    expect(pitch).toHaveFocus();
    fireEvent.keyDown(pitch!, { key: " " });
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(
      play.mock.calls[1][0].accent_phrases[0].moras[0].consonant_length,
    ).toBeCloseTo(0.18);

    await emit("audio-playback-finished");
    const zoom = screen
      .getAllByRole("slider")
      .find(
        (slider) => slider.getAttribute("aria-orientation") === "horizontal",
      );
    expect(zoom).toBeDefined();
    zoom!.focus();
    expect(fireEvent.keyDown(zoom!, { key: " " })).toBe(false);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(3));
    expect(stop).not.toHaveBeenCalled();
  });
});
