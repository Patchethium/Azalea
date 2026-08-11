import { commands } from "@binding";
import { renderCanvas, renderPanel } from "@layout/bottomPanel/testUtils";
import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vitest";
import { audioQuery, preset, spectrogram } from "../../test/fixtures";

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
});

describe("BottomPanel playback", () => {
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
