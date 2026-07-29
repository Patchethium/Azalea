import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { batch, type Component, onMount } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { commands } from "../binding";
import { ConfigProvider, useConfigStore } from "../contexts/config";
import { i18nProvider } from "../contexts/i18n";
import { MetaProvider, useMetaStore } from "../contexts/meta";
import { SpectrogramProvider } from "../contexts/spectrogram";
import { SystemProvider } from "../contexts/system";
import { TextProvider, useTextStore } from "../contexts/text";
import { UIProvider, useUIStore } from "../contexts/ui";
import {
  audioQuery,
  config,
  metas,
  preset,
  spectrogram,
} from "../test/fixtures";
import { BottomPanel, SpectrogramCanvas } from "./BottomPanel";

const renderCanvas = (
  preview: Parameters<typeof SpectrogramCanvas>[0]["preview"],
  stale = false,
) =>
  render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, null],
      ]}
    >
      <SpectrogramCanvas
        preview={preview}
        width={120}
        preSilence={1}
        postSilence={1}
        stale={stale}
      />
    </MultiProvider>
  ));

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

const renderPanel = (
  configOverrides: Partial<ReturnType<typeof config>["ui_config"]> = {},
) => {
  let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
  let text!: NonNullable<ReturnType<typeof useTextStore>>;
  let ui!: NonNullable<ReturnType<typeof useUIStore>>;
  const Harness: Component = () => {
    appConfig = useConfigStore()!;
    text = useTextStore()!;
    ui = useUIStore()!;
    const meta = useMetaStore()!;
    onMount(() => {
      batch(() => {
        meta.setMetas(metas);
        appConfig.setConfig(config(configOverrides));
        appConfig.setRange({ 1: [4, 6] });
        text.setProjectPresetStore([preset()]);
        text.replaceTextBlocks([
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
        ]);
      });
    });
    return (
      <main>
        <BottomPanel />
      </main>
    );
  };
  const result = render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [SpectrogramProvider, null],
        [ConfigProvider, null],
        [SystemProvider, null],
        [i18nProvider, null],
        [TextProvider, null],
      ]}
    >
      <Harness />
    </MultiProvider>
  ));
  return {
    ...result,
    getConfigStore: () => appConfig,
    getTextStore: () => text,
    getUiStore: () => ui,
  };
};

describe("BottomPanel playback", () => {
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

  it("honors play-and-advance and stop keyboard shortcuts", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const play = vi
      .spyOn(commands, "playAudio")
      .mockResolvedValue({ status: "ok", data: null });
    const stop = vi
      .spyOn(commands, "stopAudio")
      .mockResolvedValue({ status: "ok", data: null });
    const { getUiStore } = renderPanel();
    await screen.findByRole("button", { name: "Play selected cell" });

    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(getUiStore().uiStore.selectedTextBlockIndex).toBe(1),
    );

    fireEvent.keyDown(window, { key: " ", ctrlKey: true });
    await waitFor(() => expect(stop).toHaveBeenCalledOnce());
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
    const editor = await screen.findByRole("textbox");
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

  it("edits pitch and duration on the tuning timeline", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const { getTextStore } = renderPanel({ spectrogram_preview: false });

    fireEvent.click(await screen.findByRole("tab", { name: "Tuning" }));
    const consonant = await screen.findByText("k");
    const timeline = consonant.parentElement!.parentElement!.parentElement!;
    fireEvent.mouseDown(consonant, { clientX: 100 });
    fireEvent.mouseMove(timeline, { clientX: 136 });
    fireEvent.mouseUp(timeline, { clientX: 136 });
    expect(
      getTextStore().textStore[0].query?.accent_phrases[0].moras[0]
        .consonant_length,
    ).toBeCloseTo(0.18);

    const pitch = screen
      .getAllByRole("slider")
      .find((slider) => slider.getAttribute("aria-orientation") === "vertical");
    expect(pitch).toBeDefined();
    fireEvent.keyDown(pitch!, { key: "ArrowUp" });
    await waitFor(() =>
      expect(
        getTextStore().textStore[0].query?.accent_phrases[0].moras[0].pitch,
      ).toBeCloseTo(5.41),
    );
    expect(getTextStore().textStore[0].query_is_modified).toBe(true);
  });
});
