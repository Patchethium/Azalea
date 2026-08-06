import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { batch, type Component, onMount } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { commands, events } from "../binding";
import { ConfigProvider, useConfigStore } from "../contexts/config";
import { i18nProvider } from "../contexts/i18n";
import { MetaProvider, useMetaStore } from "../contexts/meta";
import { SpectrogramProvider } from "../contexts/spectrogram";
import { TextProvider, useTextStore } from "../contexts/text";
import { UIProvider } from "../contexts/ui";
import { audioQuery, config, metas, preset } from "../test/fixtures";
import TextBlock from "./TextBlock";

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

type TextStore = NonNullable<ReturnType<typeof useTextStore>>;
type ConfigStore = NonNullable<ReturnType<typeof useConfigStore>>;

const renderBlock = (bufferRender: boolean, queryIsModified = false) => {
  let text!: TextStore;
  let appConfig!: ConfigStore;
  const Harness: Component = () => {
    const meta = useMetaStore()!;
    appConfig = useConfigStore()!;
    text = useTextStore()!;
    onMount(() => {
      batch(() => {
        meta.setMetas(metas);
        appConfig.setConfig(
          config({
            buffer_render: bufferRender,
            synthesis_delay_ms: 0,
          }),
        );
        text.setProjectPresetStore([preset()]);
        text.replaceTextBlocks([
          {
            id: "text-block",
            text: "hello",
            query: audioQuery(),
            query_is_modified: queryIsModified,
            preset_id: 0,
          },
        ]);
      });
    });
    return <TextBlock index={0} />;
  };

  const result = render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [SpectrogramProvider, null],
        [ConfigProvider, null],
        [i18nProvider, null],
        [TextProvider, null],
      ]}
    >
      <Harness />
    </MultiProvider>
  ));
  return {
    ...result,
    getTextStore: () => text,
    getConfigStore: () => appConfig,
  };
};

describe("TextBlock", () => {
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
      preset_id: 0,
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
    const cancel = vi
      .spyOn(commands, "cancelSynthesis")
      .mockResolvedValue({ status: "ok", data: null });

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

    getConfigStore().setConfig("ui_config", "buffer_render", false);
    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith(
        request.blockId,
        request.generationId,
      ),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
