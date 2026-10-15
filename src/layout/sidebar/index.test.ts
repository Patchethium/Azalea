import {
  type AzaleaConfig,
  type CharacterMeta,
  commands,
  events,
  type TextBlockProps,
} from "$binding";
import { renderSidebar, renderSidebarHook } from "@layout/sidebar/testUtils";
import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import userEvent from "@testing-library/user-event";
import { batch } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { useConfigStore } from "@contexts/config";
import { useTextStore } from "@contexts/text";
import { audioQuery, config, metas, preset } from "../../test/fixtures";

const secondSpeaker: CharacterMeta = {
  name: "Second Speaker",
  speaker_uuid: "speaker-2",
  version: "1.0.0",
  order: 1,
  styles: [
    { id: 10, name: "Normal", order: 0, type: "talk" },
    { id: 11, name: "Happy", order: 1, type: "talk" },
  ],
};

const dialogs = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => dialogs);
vi.mock("@components/tooltip", () => ({
  Tooltip: (props: { children: unknown }) => props.children,
}));

describe("Sidebar project lifecycle", () => {
  it("saves the live project, loads replacement data, and autosaves edits", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const invocations: Array<{ cmd: string; args: Record<string, unknown> }> =
      [];
    mockIPC((cmd, args) => {
      invocations.push({ cmd, args: args as Record<string, unknown> });
      if (cmd === "get_os") return "Linux";
      if (cmd === "load_project") {
        if ((args as { path?: string }).path === "/tmp/rejected.azp") {
          throw "unsupported project schema";
        }
        return {
          blocks: [
            {
              id: "loaded-block",
              text: "Loaded block",
              query: audioQuery({ speedScale: 1.2 }),
              pitch_is_modified: true,
              pitch_noise_seed: 0,
              preset_id: "preset-1",
            },
          ],
          presets: [preset({ name: "Loaded preset" })],
        };
      }
      return null;
    });
    dialogs.save.mockResolvedValue("/tmp/current.azp");
    dialogs.open
      .mockResolvedValueOnce("/tmp/loaded.azp")
      .mockResolvedValueOnce("/tmp/rejected.azp");
    let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
    let text!: NonNullable<ReturnType<typeof useTextStore>>;
    renderSidebar(({ config: configStore, meta, text: textStore }) => {
      appConfig = configStore;
      text = textStore;
      batch(() => {
        appConfig.setConfig(config({ auto_save: false }));
        meta.setMetas(metas);
        text.setProjectPresetStore([preset()]);
        text.replaceTextBlocks([
          {
            id: "current-block",
            text: "Current block",
            query: audioQuery(),
            pitch_noise_seed: 0,
            preset_id: "preset-1",
          },
        ]);
      });
    });

    await screen.findByText("Default");
    fireEvent.keyDown(window, { key: "S", ctrlKey: true });
    await waitFor(() =>
      expect(
        invocations.filter(({ cmd }) => cmd === "save_project"),
      ).toHaveLength(1),
    );
    const firstSave = invocations.find(({ cmd }) => cmd === "save_project")!;
    expect(firstSave.args).toMatchObject({
      path: "/tmp/current.azp",
      allowCreate: true,
      project: {
        blocks: [
          {
            id: "current-block",
            text: "Current block",
            preset_id: "preset-1",
          },
        ],
        presets: [{ id: "preset-1", name: "Default" }],
      },
    });
    expect(
      (firstSave.args.project as { blocks: unknown[] }).blocks[0],
    ).toHaveProperty("id", "current-block");

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "S", ctrlKey: true });
    await waitFor(() =>
      expect(
        invocations.filter(({ cmd }) => cmd === "save_project"),
      ).toHaveLength(2),
    );

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    fireEvent.keyDown(window, { key: "S", ctrlKey: true });
    await waitFor(() =>
      expect(
        invocations.filter(({ cmd }) => cmd === "save_project"),
      ).toHaveLength(3),
    );
    dialog.remove();
    input.remove();

    await user.click(
      await screen.findByRole("button", { name: "Project actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Load Project" }),
    );
    expect(dialogs.open).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Load Project" }),
    );
    await waitFor(() => expect(text.textStore[0].text).toBe("Loaded block"));
    expect(text.projectPresetStore[0].name).toBe("Loaded preset");
    expect(text.projectPath()).toBe("/tmp/loaded.azp");

    const savesBeforeAutosave = invocations.filter(
      ({ cmd }) => cmd === "save_project",
    ).length;
    appConfig.setConfig("ui", "auto_save", true);
    text.setTextStore(0, "text", "Autosaved edit");
    await waitFor(
      () =>
        expect(
          invocations.filter(({ cmd }) => cmd === "save_project").length,
        ).toBeGreaterThan(savesBeforeAutosave),
      { timeout: 2_000 },
    );
    const saves = invocations.filter(({ cmd }) => cmd === "save_project");
    const lastSave = saves[saves.length - 1];
    expect(lastSave.args).toMatchObject({
      path: "/tmp/loaded.azp",
      project: { blocks: [{ id: "loaded-block", text: "Autosaved edit" }] },
    });

    await user.click(
      await screen.findByRole("button", { name: "Project actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Load Project" }),
    );
    await waitFor(() =>
      expect(
        invocations.filter(
          ({ cmd, args }) =>
            cmd === "load_project" && args.path === "/tmp/rejected.azp",
        ),
      ).toHaveLength(1),
    );
    expect(text.projectPath()).toBe("/tmp/loaded.azp");
    expect(text.textStore[0].text).toBe("Autosaved edit");
  });
});

describe("Sidebar SRT import", () => {
  it("appends subtitle cues as text blocks, tolerating cancel and read errors", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockIPC((cmd, args) => {
      if (cmd === "get_os") return "Linux";
      if (cmd === "read_text_file") {
        if ((args as { path?: string }).path === "/tmp/missing.srt") {
          throw "file not found";
        }
        return "1\n00:00:00,000 --> 00:00:02,000\nFirst cue\n\n2\n00:00:02,500 --> 00:00:05,000\n<i>Second</i> cue";
      }
      return null;
    });
    dialogs.open
      .mockResolvedValueOnce("/tmp/subtitles.srt")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("/tmp/missing.srt");
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let text!: NonNullable<ReturnType<typeof useTextStore>>;
    renderSidebar(({ config: appConfig, meta, text: textStore }) => {
      text = textStore;
      batch(() => {
        appConfig.setConfig(config({ auto_save: false }));
        meta.setMetas(metas);
        text.setProjectPresetStore([preset()]);
        text.replaceTextBlocks([
          {
            id: "current-block",
            text: "Current block",
            query: audioQuery(),
            pitch_noise_seed: 0,
            preset_id: "preset-1",
          },
        ]);
      });
    });

    await screen.findByText("Default");
    await user.click(
      await screen.findByRole("button", { name: "Project actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Import SRT" }),
    );
    expect(dialogs.open).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Import SRT" }),
    );
    await waitFor(() => expect(text.textStore).toHaveLength(3));
    expect(text.textStore.map((block) => block.text)).toEqual([
      "Current block",
      "First cue",
      "Second cue",
    ]);
    expect(text.textStore[1].preset_id).toBe("preset-1");
    expect(text.selectedTextBlockIndex()).toBe(1);

    await user.click(
      await screen.findByRole("button", { name: "Project actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Import SRT" }),
    );
    expect(text.textStore).toHaveLength(3);

    await user.click(
      await screen.findByRole("button", { name: "Project actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Import SRT" }),
    );
    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith("file not found"),
    );
    expect(text.textStore).toHaveLength(3);
    errorSpy.mockRestore();
  });

  it("ignores empty files and resolves preset fallbacks without a selection", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "get_os") return "Linux";
      if (cmd === "read_text_file") {
        return (args as { path?: string }).path === "/tmp/empty.srt"
          ? ""
          : "1\n00:00:00,000 --> 00:00:02,000\nImported cue";
      }
      return null;
    });
    dialogs.open
      .mockResolvedValueOnce("/tmp/empty.srt")
      .mockResolvedValueOnce("/tmp/preset-fallback.srt")
      .mockResolvedValueOnce("/tmp/no-preset.srt");
    let text!: NonNullable<ReturnType<typeof useTextStore>>;
    const { getControls } = renderSidebarHook(
      ({ config: appConfig, meta, text: textStore }) => {
        text = textStore;
        batch(() => {
          appConfig.setConfig(config());
          meta.setMetas(metas);
          text.setProjectPresetStore([preset()]);
          text.setTextStore([]);
        });
      },
    );
    await Promise.resolve();
    const controls = getControls();

    await controls.importSrt();
    expect(text.textStore).toHaveLength(0);

    await controls.importSrt();
    expect(text.textStore).toHaveLength(1);
    expect(text.textStore[0]).toMatchObject({
      text: "Imported cue",
      preset_id: "preset-1",
    });

    text.setTextStore([]);
    text.setProjectPresetStore([]);
    await controls.importSrt();
    expect(text.textStore).toHaveLength(1);
    expect(text.textStore[0]).toMatchObject({
      text: "Imported cue",
      preset_id: null,
    });
  });

  it("shows an error toast when the subtitle file cannot be read", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    vi.spyOn(commands, "readTextFile").mockResolvedValue({
      status: "error",
      error: "permission denied",
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    dialogs.open.mockResolvedValueOnce("/tmp/locked.srt");
    let text!: NonNullable<ReturnType<typeof useTextStore>>;
    const { getControls } = renderSidebarHook(
      ({ config: appConfig, meta, text: textStore }) => {
        text = textStore;
        batch(() => {
          appConfig.setConfig(config());
          meta.setMetas(metas);
          text.setProjectPresetStore([preset()]);
          text.setTextStore([]);
        });
      },
    );
    await Promise.resolve();

    await getControls().importSrt();
    expect(text.textStore).toHaveLength(0);
    expect(
      await screen.findByRole("status", {
        name: "Couldn't import the subtitles from /tmp/locked.srt",
      }),
    ).toHaveAccessibleDescription("permission denied");
  });
});

describe("Sidebar controls", () => {
  it("handles preset controller edge cases", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    dialogs.open.mockResolvedValue(null);
    dialogs.save.mockResolvedValue(null);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const loadProject = vi.spyOn(commands, "loadProject");
    const saveProject = vi.spyOn(commands, "saveProject").mockResolvedValue({
      status: "error",
      error: "save failed",
    });
    let text!: NonNullable<ReturnType<typeof useTextStore>>;
    const { getControls } = renderSidebarHook(
      ({ config: appConfig, meta, text: textStore }) => {
        text = textStore;
        batch(() => {
          appConfig.setConfig(config());
          meta.setMetas([...metas, secondSpeaker]);
          text.setProjectPresetStore([
            preset(),
            preset({
              id: "preset-2",
              name: "Second",
              style_id: 10,
              speaker_uuid: "speaker-2",
            }),
          ]);
          text.replaceTextBlocks([
            {
              id: "first",
              text: "First",
              query: audioQuery(),
              pitch_is_modified: true,
              pitch_noise_seed: 0,
              preset_id: "preset-1",
            },
            {
              id: "second",
              text: "Second",
              query: audioQuery(),
              pitch_is_modified: true,
              pitch_noise_seed: 0,
              preset_id: "preset-2",
            },
            {
              id: "unassigned",
              text: "Unassigned",
              query: null,
              pitch_noise_seed: 0,
              preset_id: null,
            },
          ]);
        });
      },
    );
    await Promise.resolve();
    const controls = getControls();

    controls.setStyleId(999);
    controls.selectSpeakerByName("Missing");
    controls.setStyleByName("Missing");
    controls.setStyleId(1);
    expect(text.textStore[0].pitch_is_modified).toBe(true);
    controls.selectSpeakerByName("Speaker");
    controls.setStyleByName("Happy");
    expect(text.projectPresetStore[0]).toMatchObject({
      style_id: 2,
      speaker_uuid: "speaker-1",
      style_name: "Happy",
    });
    expect(text.textStore[0].pitch_is_modified).toBe(false);

    text.setTextStore(0, "pitch_is_modified", true);
    controls.setTextPresetIdx(1);
    expect(text.textStore[0]).toMatchObject({
      preset_id: "preset-2",
      pitch_is_modified: false,
      pitch_noise_seed: 0,
    });
    text.setTextStore(0, "pitch_is_modified", true);
    controls.setTextPresetIdx(1);
    expect(text.textStore[0].pitch_is_modified).toBe(true);

    controls.setPresetName("Renamed");
    controls.setPitch(0.2);
    controls.setSpeed(125);
    controls.setIntonation(1.2);
    controls.setVolume(0.8);
    controls.setStartSli(300);
    controls.setEndSli(400);
    expect(text.projectPresetStore[1]).toMatchObject({
      name: "Renamed",
      pitch: 0.2,
      speed: 125,
      intonation: 1.2,
      volume: 0.8,
      start_slience: 300,
      end_slience: 400,
    });

    controls.movePreset(-1, 0);
    controls.movePreset(1, 2);
    controls.movePreset(1, 1);
    controls.movePreset(1, 0);
    expect(text.textStore.map((block) => block.preset_id)).toEqual([
      "preset-2",
      "preset-2",
      null,
    ]);

    controls.createPreset();
    expect(text.projectPresetStore).toHaveLength(3);
    expect(text.textStore[0].preset_id).toBe(text.projectPresetStore[2].id);
    controls.removePreset();
    expect(text.projectPresetStore).toHaveLength(2);
    expect(text.textStore[0].preset_id).toBe("preset-1");

    text.setTextStore([]);
    text.setProjectPresetStore([]);
    controls.setStyleId(1);
    controls.setPresetName("Ignored");
    controls.setPitch(1);
    controls.setTextPresetIdx(0);
    controls.removePreset();
    expect(controls.currentPreset()).toBeNull();
    expect(controls.curMeta()).toBeUndefined();
    expect(controls.curStyle()).toBeUndefined();
    expect(controls.availableStyleNames()).toEqual([]);
    controls.createPreset();
    expect(text.projectPresetStore[0]).toMatchObject({
      name: "New Preset",
      speed: 100,
      style_id: 1,
    });
    controls.createPreset();
    controls.createPreset();
    expect(text.projectPresetStore.map((preset) => preset.name)).toEqual([
      "New Preset",
      "New Preset (1)",
      "New Preset (2)",
    ]);
    text.setTextStore([
      {
        id: "renamed",
        text: "Renamed",
        query: null,
        pitch_noise_seed: 0,
        preset_id: text.projectPresetStore[1].id ?? null,
      },
    ]);
    controls.setPresetName("New Preset");
    expect(text.projectPresetStore[1].name).toBe("New Preset");
    text.setTextStore([]);

    await controls.loadProject();
    await controls.saveProject();
    expect(loadProject).not.toHaveBeenCalled();
    expect(saveProject).not.toHaveBeenCalled();

    text.setProjectPath("/tmp/existing.azp");
    await controls.saveProject();
    expect(console.error).toHaveBeenCalledWith("save failed");
  });

  it("resizes the preset editor and applies speaker changes after selection", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    const resizeObservers: ResizeObserverTestMock[] = [];
    class ResizeObserverTestMock {
      private readonly elements: Element[] = [];

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        resizeObservers.push(this);
      }

      private readonly callback: ResizeObserverCallback;

      observe(element: Element) {
        this.elements.push(element);
      }
      unobserve() {}
      disconnect() {}

      notify() {
        this.callback(
          this.elements.map((target) => ({ target }) as ResizeObserverEntry),
          this as unknown as ResizeObserver,
        );
      }
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: ResizeObserverTestMock,
    });
    let contentHeight = 600;
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        if (this.hasAttribute("data-corvu-resizable-root")) return 1_000;
        if (this.hasAttribute("data-preset-editor-resize-handle")) return 8;
        if (this.hasAttribute("data-preset-editor-header")) return 28;
        return 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.hasAttribute("data-preset-editor-content")
          ? contentHeight
          : 0;
      },
    );
    let text!: NonNullable<ReturnType<typeof useTextStore>>;

    renderSidebar(({ meta, text: textStore }) => {
      text = textStore;
      batch(() => {
        meta.setMetas([...metas, secondSpeaker]);
        text.setProjectPresetStore([preset()]);
        text.replaceTextBlocks([
          {
            id: "current-block",
            text: "Current block",
            query: audioQuery(),
            pitch_is_modified: true,
            pitch_noise_seed: 0,
            preset_id: "preset-1",
          },
          {
            id: "related-block",
            text: "Related block",
            query: audioQuery(),
            pitch_is_modified: true,
            pitch_noise_seed: 0,
            preset_id: "preset-1",
          },
        ]);
      });
    });

    await screen.findByRole("button", { name: "Create preset" });
    const resizeHandle = screen.getByRole("separator", { name: "Preset" });
    const presetPanel = resizeHandle.nextElementSibling as HTMLElement;
    expect(resizeHandle).toHaveAttribute("aria-orientation", "vertical");
    expect(screen.getByRole("heading", { name: "Preset" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Preset" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(parseFloat(presetPanel.style.flexBasis)).toBeCloseTo(63.61, 2),
    );
    expect((parseFloat(presetPanel.style.flexBasis) / 100) * 992).toBeCloseTo(
      631,
    );
    contentHeight = 500;
    for (const observer of resizeObservers) observer.notify();
    await waitFor(() =>
      expect(parseFloat(presetPanel.style.flexBasis)).toBeCloseTo(53.53, 2),
    );
    contentHeight = 600;
    for (const observer of resizeObservers) observer.notify();
    await waitFor(() =>
      expect(parseFloat(presetPanel.style.flexBasis)).toBeCloseTo(63.61, 2),
    );
    fireEvent.keyDown(resizeHandle, { key: "ArrowDown" });
    expect(parseFloat(presetPanel.style.flexBasis)).toBeCloseTo(53.61, 2);
    fireEvent.keyDown(resizeHandle, { key: "ArrowUp" });
    expect(parseFloat(presetPanel.style.flexBasis)).toBeCloseTo(63.61, 2);
    fireEvent.keyDown(resizeHandle, { key: "ArrowUp" });
    expect(parseFloat(presetPanel.style.flexBasis)).toBeCloseTo(63.61, 2);

    const drag = (fromY: number, toY: number) => {
      resizeHandle.setPointerCapture = vi.fn();
      resizeHandle.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          clientX: 0,
          clientY: fromY,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", {
          bubbles: true,
          clientX: 0,
          clientY: toY,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("pointerup", {
          bubbles: true,
          clientX: 0,
          clientY: toY,
        }),
      );
    };
    drag(200, 1_000);
    expect(presetPanel).toHaveAttribute("data-collapsed");
    expect(resizeHandle).toBeInTheDocument();
    drag(1_000, 700);
    expect(presetPanel).not.toHaveAttribute("data-collapsed");
    expect(
      screen.queryByRole("button", { name: "Move preset up" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", {
        name: "Drag to reorder preset",
      }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Manage presets" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete preset" }),
    ).toBeInTheDocument();
    const increaseStartSilence = screen.getByRole("button", {
      name: "Increase Start Sli.",
    });
    expect(
      screen.getByRole("button", { name: "Decrease Start Sli." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Increase End Sli." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Decrease End Sli." }),
    ).toBeInTheDocument();
    await user.click(increaseStartSilence);
    expect(text.projectPresetStore[0].start_slience).toBe(200);
    expect(
      screen
        .getByRole("button", { name: "Speaker Speaker" })
        .querySelector('[lang="ja"]'),
    ).toHaveTextContent("Speaker");
    expect(
      screen
        .getByRole("button", { name: "Style Normal" })
        .querySelector('[lang="ja"]'),
    ).toHaveTextContent("Normal");

    const browseSpeakers = await screen.findByRole("button", {
      name: "Browse speakers",
    });
    await user.click(browseSpeakers);

    const dialog = await screen.findByRole("dialog", {
      name: "Select Speaker",
    });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Speaker" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Second Speaker" }),
    ).toHaveAttribute("aria-pressed", "false");

    await user.click(
      screen.getByRole("button", { name: "Close speaker selection" }),
    );
    expect(text.projectPresetStore[0]).toMatchObject({
      style_id: 1,
      speaker_uuid: "speaker-1",
      style_name: "Normal",
    });

    await user.click(browseSpeakers);
    await user.click(
      await screen.findByRole("button", { name: "Second Speaker" }),
    );

    expect(text.projectPresetStore[0]).toMatchObject({
      style_id: 10,
      speaker_uuid: "speaker-2",
      style_name: "Normal",
    });
    expect(text.textStore.map((block) => block.pitch_is_modified)).toEqual([
      false,
      false,
    ]);
    expect(dialog).toHaveAttribute("data-closed");
    expect(
      screen.getByRole("button", { name: "Speaker Second Speaker" }),
    ).toHaveTextContent("Second Speaker");
    expect(
      screen.getByRole("button", { name: "Style Normal" }),
    ).toHaveTextContent("Normal");

    const name = screen.getByRole("textbox");
    await user.clear(name);
    expect(screen.getByPlaceholderText("Untitled Preset")).toHaveValue("");
    expect(screen.getByText("Untitled Preset")).toBeInTheDocument();
    await user.type(name, "Edited");
    expect(text.projectPresetStore[0].name).toBe("Edited");

    await user.click(screen.getByRole("button", { name: "Style Normal" }));
    await user.click(await screen.findByRole("option", { name: "Happy" }));
    expect(text.projectPresetStore[0]).toMatchObject({
      style_id: 11,
      style_name: "Happy",
    });

    await user.click(screen.getByRole("button", { name: "Create preset" }));
    expect(text.projectPresetStore).toHaveLength(2);
    const createdPresetId = text.projectPresetStore[1].id;
    expect(text.textStore[0].preset_id).toBe(createdPresetId);
    const presetIds = () => text.projectPresetStore.map((item) => item.id);
    const createdHandle = screen.getAllByRole("button", {
      name: "Drag to reorder preset",
    })[1];
    expect(createdHandle).toHaveClass("opacity-0");
    await user.hover(createdHandle);
    expect(createdHandle).not.toHaveClass("opacity-0");
    await user.unhover(createdHandle);
    expect(createdHandle).toHaveClass("opacity-0");
    // Drag the created preset above the first one.
    vi.stubGlobal(
      "PointerEvent",
      class extends MouseEvent {
        readonly pointerId = 1;
      },
    );
    screen
      .getAllByRole("button", { name: "Drag to reorder preset" })
      .forEach((grip, index) => {
        grip.closest<HTMLElement>(".relative")!.getBoundingClientRect = () =>
          ({ top: index * 40, height: 40 }) as DOMRect;
      });
    fireEvent.pointerDown(createdHandle, { button: 0, clientY: 60 });
    fireEvent.pointerMove(createdHandle, { clientY: 5 });
    fireEvent.pointerUp(createdHandle, { clientY: 5 });
    vi.unstubAllGlobals();
    expect(presetIds()).toEqual([createdPresetId, "preset-1"]);
    expect(text.textStore[0].preset_id).toBe(createdPresetId);
    // The grip must not select its preset when clicked.
    await user.click(
      screen.getAllByRole("button", { name: "Drag to reorder preset" })[1],
    );
    expect(text.textStore[0].preset_id).toBe(createdPresetId);

    await user.click(screen.getByText("Edited"));
    expect(text.textStore[0].preset_id).toBe("preset-1");
    await user.click(screen.getByRole("button", { name: "Manage presets" }));
    expect(
      await screen.findByRole("dialog", { name: "Preset Manager" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Close preset manager" }),
    );

    const remove = screen.getByRole("button", { name: "Delete preset" });
    await user.click(remove);
    await user.click(remove);
    expect(text.projectPresetStore).toHaveLength(0);
    expect(
      screen.getByText("Create a new preset to get started"),
    ).toBeInTheDocument();
    expect(remove).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Create preset" }));
    expect(text.projectPresetStore).toHaveLength(1);
  });
});

describe("Sidebar dictionary", () => {
  it("opens the dictionary manager from the footer button", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockIPC((cmd) => {
      if (cmd === "get_os") return "Linux";
      if (cmd === "get_dictionary_entries") return [];
      return null;
    });
    renderSidebar(({ config: appConfig, meta, text }) => {
      batch(() => {
        appConfig.setConfig(config());
        meta.setMetas(metas);
        text.setProjectPresetStore([preset()]);
      });
    });

    await user.click(
      await screen.findByRole("button", { name: "Manage user dictionary" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "User Dictionary",
    });
    expect(dialog).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Close user dictionary" }),
    );
    expect(dialog).toHaveAttribute("data-closed");
  });
});

describe("Sidebar unsaved changes", () => {
  const renderDirtySidebar = () => {
    let text!: NonNullable<ReturnType<typeof useTextStore>>;
    const result = renderSidebarHook(
      ({ config: appConfig, meta, text: textStore }) => {
        text = textStore;
        batch(() => {
          appConfig.setConfig(config({ auto_save: false }));
          meta.setMetas(metas);
          textStore.setProjectPresetStore([preset()]);
          textStore.replaceTextBlocks([
            {
              id: "block",
              text: "Original",
              query: audioQuery(),
              pitch_noise_seed: 0,
              preset_id: "preset-1",
            },
          ]);
        });
        textStore.markProjectSaved();
      },
    );
    return { ...result, getText: () => text };
  };

  it("keeps the project dirty after a failed save and records the path only after success", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    dialogs.save.mockResolvedValue("/tmp/unsaved.azp");
    const saveProject = vi
      .spyOn(commands, "saveProject")
      .mockResolvedValue({ status: "error", error: "disk full" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getControls, getText } = renderDirtySidebar();
    await Promise.resolve();
    const controls = getControls();
    const text = getText();

    expect(text.isProjectDirty()).toBe(false);
    text.setTextStore(0, "text", "Changed");
    expect(text.isProjectDirty()).toBe(true);

    expect(await controls.saveProject()).toBe(false);
    expect(text.projectPath()).toBeNull();
    expect(text.isProjectDirty()).toBe(true);
    expect(
      await screen.findByRole("status", {
        name: "Couldn't save the project to /tmp/unsaved.azp",
      }),
    ).toHaveAccessibleDescription("disk full");

    saveProject.mockResolvedValue({ status: "ok", data: null });
    expect(await controls.saveProject()).toBe(true);
    expect(text.projectPath()).toBe("/tmp/unsaved.azp");
    expect(text.isProjectDirty()).toBe(false);
  });

  it("prompts before replacing a dirty project and resolves save, discard, and cancel", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    const saveProject = vi
      .spyOn(commands, "saveProject")
      .mockResolvedValue({ status: "ok", data: null });
    dialogs.save.mockResolvedValue("/tmp/saved.azp");
    const { getControls, getText } = renderDirtySidebar();
    await Promise.resolve();
    const controls = getControls();
    const text = getText();

    text.setTextStore(0, "text", "Edited");
    text.setProjectPath("/tmp/saved.azp");

    controls.requestProjectAction("new");
    expect(controls.uiStore.pendingProjectAction).toBe("new");

    await controls.resolveProjectAction("cancel");
    expect(controls.uiStore.pendingProjectAction).toBeNull();
    expect(text.textStore[0].text).toBe("Edited");

    controls.requestProjectAction("new");
    await controls.resolveProjectAction("save");
    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(controls.uiStore.pendingProjectAction).toBeNull();
    expect(text.projectPath()).toBeNull();
    expect(text.textStore[0].text).not.toBe("Edited");
  });

  it("keeps the pending action and project when saving from the prompt fails", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    vi.spyOn(commands, "saveProject").mockResolvedValue({
      status: "error",
      error: "disk full",
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getControls, getText } = renderDirtySidebar();
    await Promise.resolve();
    const controls = getControls();
    const text = getText();

    text.setTextStore(0, "text", "Edited");
    text.setProjectPath("/tmp/saved.azp");

    controls.requestProjectAction("open");
    expect(controls.uiStore.pendingProjectAction).toBe("open");

    await controls.resolveProjectAction("save");
    expect(controls.uiStore.pendingProjectAction).toBe("open");
    expect(text.textStore[0].text).toBe("Edited");
    expect(text.isProjectDirty()).toBe(true);
  });

  it("shows the unsaved changes dialog from the project menu", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    let text!: NonNullable<ReturnType<typeof useTextStore>>;
    renderSidebar(({ config: appConfig, meta, text: textStore }) => {
      text = textStore;
      batch(() => {
        appConfig.setConfig(config({ auto_save: false }));
        meta.setMetas(metas);
        textStore.setProjectPresetStore([preset()]);
        textStore.replaceTextBlocks([
          {
            id: "block",
            text: "Original",
            query: audioQuery(),
            pitch_noise_seed: 0,
            preset_id: "preset-1",
          },
        ]);
      });
      textStore.markProjectSaved();
    });

    await screen.findByText("Default");
    text.setTextStore(0, "text", "Edited");
    await user.click(screen.getByRole("button", { name: "Project actions" }));
    await user.click(await screen.findByText("New Project"));
    expect(
      await screen.findByRole("dialog", { name: "Unsaved changes" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(text.textStore[0].text).not.toBe("Edited");
  });

  it("saves or cancels from the unsaved changes dialog", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    vi.spyOn(commands, "saveProject").mockResolvedValue({
      status: "ok",
      data: null,
    });
    dialogs.open.mockResolvedValue(null);
    dialogs.save.mockResolvedValue("/tmp/saved.azp");
    let text!: NonNullable<ReturnType<typeof useTextStore>>;
    renderSidebar(({ config: appConfig, meta, text: textStore }) => {
      text = textStore;
      batch(() => {
        appConfig.setConfig(config({ auto_save: false }));
        meta.setMetas(metas);
        textStore.setProjectPresetStore([preset()]);
        textStore.replaceTextBlocks([
          {
            id: "block",
            text: "Original",
            query: audioQuery(),
            pitch_noise_seed: 0,
            preset_id: "preset-1",
          },
        ]);
      });
      textStore.markProjectSaved();
    });

    await screen.findByText("Default");
    text.setTextStore(0, "text", "Edited");
    text.setProjectPath("/tmp/saved.azp");

    await user.click(screen.getByRole("button", { name: "Project actions" }));
    await user.click(await screen.findByText("New Project"));
    await screen.findByRole("dialog", { name: "Unsaved changes" });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(text.textStore[0].text).toBe("Edited");

    await user.click(screen.getByRole("button", { name: "Project actions" }));
    await user.click(await screen.findByText("Load Project"));
    await screen.findByRole("dialog", { name: "Unsaved changes" });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(commands.saveProject).toHaveBeenCalledTimes(1));
  });

  it("runs close and quit actions after discarding", async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      return cmd === "get_os" ? "Linux" : null;
    });
    mockWindows("main");
    const quit = vi.spyOn(commands, "quit").mockResolvedValue();
    const { getControls, getText } = renderDirtySidebar();
    await Promise.resolve();
    const controls = getControls();
    const text = getText();
    text.setTextStore(0, "text", "Edited");

    controls.setUIStore("pendingProjectAction", "quit");
    await controls.resolveProjectAction("discard");
    expect(quit).toHaveBeenCalledTimes(1);

    controls.setUIStore("pendingProjectAction", "close");
    await controls.resolveProjectAction("discard");
    expect(calls).toContain("plugin:window|destroy");
  });

  it("logs failures from project actions", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    mockWindows("main");
    vi.spyOn(commands, "quit").mockRejectedValue(new Error("denied"));
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { getControls, getText } = renderDirtySidebar();
    await Promise.resolve();
    const controls = getControls();
    getText().setTextStore(0, "text", "Edited");

    controls.setUIStore("pendingProjectAction", "quit");
    await controls.resolveProjectAction("discard");

    expect(error).toHaveBeenCalledWith(
      "Failed to run project action quit:",
      expect.any(Error),
    );
    expect(
      await screen.findByRole("status", {
        name: "Couldn't complete the project action",
      }),
    ).toHaveAccessibleDescription("denied");
  });
});

describe("Sidebar export all", () => {
  const renderExportSidebar = (
    ui: Partial<AzaleaConfig["ui"]>,
    blocks: TextBlockProps[],
  ) => {
    let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
    let text!: NonNullable<ReturnType<typeof useTextStore>>;
    renderSidebar(({ config: configStore, meta, text: textStore }) => {
      appConfig = configStore;
      text = textStore;
      batch(() => {
        configStore.setConfig(config({ auto_save: false, ...ui }));
        meta.setMetas(metas);
        textStore.setProjectPresetStore([preset()]);
        textStore.replaceTextBlocks(blocks);
      });
    });
    return { getConfig: () => appConfig, getText: () => text };
  };

  const openExportAll = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(
      await screen.findByRole("button", { name: "Project actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Export all" }),
    );
  };

  it("exports every non-empty block in order and remembers the output folder", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    vi.spyOn(commands, "homeDir").mockResolvedValue("/home/user");
    const audioExportPath = vi
      .spyOn(commands, "audioExportPath")
      .mockImplementation(
        async (dir: string, name: string) => `${dir}/${name}.wav`,
      );
    const saveAudio = vi
      .spyOn(commands, "saveAudio")
      .mockImplementation(async (path: string) => ({
        status: "ok" as const,
        data: path,
      }));
    const parentPath = vi
      .spyOn(commands, "parentPath")
      .mockResolvedValue("/exports");
    dialogs.open.mockResolvedValue("/exports");

    const { getConfig } = renderExportSidebar({}, [
      {
        id: "first",
        text: "First block",
        query: audioQuery(),
        pitch_noise_seed: 0,
        preset_id: "preset-1",
      },
      {
        id: "empty",
        text: "",
        query: null,
        pitch_noise_seed: 0,
        preset_id: "preset-1",
      },
      {
        id: "second",
        text: "Second block",
        query: audioQuery(),
        pitch_is_modified: true,
        pitch_noise_seed: 0,
        preset_id: "preset-1",
      },
    ]);

    await screen.findByText("Default");
    await openExportAll(user);

    await waitFor(() => expect(saveAudio).toHaveBeenCalledTimes(2));
    expect(dialogs.open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Export all",
      defaultPath: "/home/user",
    });
    expect(audioExportPath.mock.calls).toEqual([
      ["/exports", "First block"],
      ["/exports", "Second block"],
    ]);
    expect(saveAudio.mock.calls[0][0]).toBe("/exports/First block.wav");
    expect(saveAudio.mock.calls[1][0]).toBe("/exports/Second block.wav");
    expect(saveAudio.mock.calls[0][3]).toBe(false);
    await waitFor(() =>
      expect(getConfig().config.ui.last_exported_dir).toBe("/exports"),
    );
    expect(parentPath).toHaveBeenCalledWith("/exports/First block.wav");
    expect(
      await screen.findByText("Exported 2 of 2 files"),
    ).toBeInTheDocument();
    expect(screen.getByText("/exports")).toBeInTheDocument();
  });

  it("writes silently to the pinned directory and forwards overwrite prevention", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    const audioExportPath = vi
      .spyOn(commands, "audioExportPath")
      .mockResolvedValue("/pinned/hello.wav");
    const saveAudio = vi
      .spyOn(commands, "saveAudio")
      .mockResolvedValue({ status: "ok", data: "/pinned/hello(2).wav" });
    const parentPath = vi
      .spyOn(commands, "parentPath")
      .mockResolvedValue("/pinned");

    const { getConfig } = renderExportSidebar(
      {
        default_export_dir: "/pinned",
        default_export_dir_enabled: true,
        silent_save: true,
        prevent_overwrite: true,
        export_text: true,
      },
      [
        {
          id: "first",
          text: "hello",
          query: audioQuery(),
          pitch_noise_seed: 0,
          preset_id: "preset-1",
        },
      ],
    );

    await screen.findByText("Default");
    await openExportAll(user);

    await waitFor(() => expect(saveAudio).toHaveBeenCalledOnce());
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(audioExportPath).toHaveBeenCalledWith("/pinned", "hello");
    expect(saveAudio).toHaveBeenCalledWith(
      "/pinned/hello.wav",
      expect.any(Object),
      1,
      true,
      { text: "hello", lab: false },
    );
    expect(parentPath).toHaveBeenCalledWith("/pinned/hello(2).wav");
    await waitFor(() =>
      expect(getConfig().config.ui.last_exported_dir).toBe("/pinned"),
    );
    expect(
      await screen.findByText("Exported 1 of 1 files"),
    ).toBeInTheDocument();
  });

  it("generates missing queries and reports failed blocks with their errors", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    vi.spyOn(commands, "audioExportPath").mockImplementation(
      async (dir: string, name: string) => `${dir}/${name}.wav`,
    );
    const audioQueryCommand = vi
      .spyOn(commands, "audioQuery")
      .mockImplementation(async (text: string) =>
        text === "Delta"
          ? { status: "error" as const, error: "engine down" }
          : { status: "ok" as const, data: audioQuery() },
      );
    const saveAudio = vi
      .spyOn(commands, "saveAudio")
      .mockImplementation(async (path: string) =>
        path.endsWith("Beta.wav")
          ? { status: "error" as const, error: "disk full" }
          : { status: "ok" as const, data: path },
      );
    vi.spyOn(commands, "parentPath").mockResolvedValue("/exports");
    dialogs.open.mockResolvedValue("/exports");

    renderExportSidebar({}, [
      {
        id: "a",
        text: "Alpha",
        query: audioQuery(),
        pitch_noise_seed: 0,
        preset_id: "preset-1",
      },
      {
        id: "b",
        text: "Beta",
        query: null,
        pitch_noise_seed: 0,
        preset_id: "preset-1",
      },
      {
        id: "c",
        text: "Gamma",
        query: audioQuery(),
        pitch_noise_seed: 0,
        preset_id: null,
      },
      {
        id: "d",
        text: "Delta",
        query: null,
        pitch_noise_seed: 0,
        preset_id: "preset-1",
      },
    ]);

    await screen.findByText("Default");
    await openExportAll(user);

    expect(
      await screen.findByText("Exported 1 of 4 files"),
    ).toBeInTheDocument();
    expect(saveAudio).toHaveBeenCalledTimes(2);
    expect(audioQueryCommand).toHaveBeenCalledWith("Beta", 1, 0);
    expect(audioQueryCommand).toHaveBeenCalledWith("Delta", 1, 0);
    expect(screen.getByText("Failed blocks")).toBeInTheDocument();
    expect(screen.getByText("disk full")).toBeInTheDocument();
    expect(
      screen.getByText("No preset is assigned to this text cell."),
    ).toBeInTheDocument();
    expect(screen.getByText("engine down")).toBeInTheDocument();
  });

  it("records unexpected command failures and falls back when resolving the folder fails", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(commands, "audioExportPath").mockImplementation(
      async (dir: string, name: string) => {
        if (name.startsWith("Broken")) throw new Error("ipc down");
        return `${dir}/${name}.wav`;
      },
    );
    const saveAudio = vi
      .spyOn(commands, "saveAudio")
      .mockImplementation(async (path: string) => ({
        status: "ok" as const,
        data: path,
      }));
    vi.spyOn(commands, "parentPath").mockRejectedValue(
      new Error("parent failed"),
    );
    dialogs.open.mockResolvedValue("/exports");

    const { getConfig } = renderExportSidebar({}, [
      {
        id: "broken",
        text: "Broken block",
        query: audioQuery(),
        pitch_noise_seed: 0,
        preset_id: "preset-1",
      },
      {
        id: "working",
        text: "Working block",
        query: audioQuery(),
        pitch_noise_seed: 0,
        preset_id: "preset-1",
      },
    ]);

    await screen.findByText("Default");
    await openExportAll(user);

    expect(
      await screen.findByText("Exported 1 of 2 files"),
    ).toBeInTheDocument();
    expect(screen.getByText("ipc down")).toBeInTheDocument();
    expect(saveAudio).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
    await waitFor(() =>
      expect(getConfig().config.ui.last_exported_dir).toBe("/exports"),
    );
  });

  it("stops after the running block when cancelled", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    vi.spyOn(commands, "audioExportPath").mockImplementation(
      async (dir: string, name: string) => `${dir}/${name}.wav`,
    );
    let resolveFirst!: (value: { status: "ok"; data: string }) => void;
    const saveAudio = vi.spyOn(commands, "saveAudio").mockReturnValueOnce(
      new Promise<{ status: "ok"; data: string }>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    vi.spyOn(commands, "parentPath").mockResolvedValue("/exports");
    dialogs.open.mockResolvedValue("/exports");

    renderExportSidebar({}, [
      {
        id: "first",
        text: "First block",
        query: audioQuery(),
        pitch_noise_seed: 0,
        preset_id: "preset-1",
      },
      {
        id: "second",
        text: "Second block",
        query: audioQuery(),
        pitch_noise_seed: 0,
        preset_id: "preset-1",
      },
    ]);

    await screen.findByText("Default");
    await openExportAll(user);

    const dialog = await screen.findByRole("dialog", { name: "Export all" });
    const progress = screen.getByRole("progressbar", {
      name: "Export progress",
    });
    expect(progress).toHaveAttribute("aria-valuenow", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "2");
    await user.click(
      screen.getByRole("button", { name: "Close export dialog" }),
    );
    expect(dialog).not.toHaveAttribute("data-closed");
    expect(await screen.findByText("Cancelling…")).toBeInTheDocument();
    resolveFirst({ status: "ok", data: "/exports/First block.wav" });

    expect(
      await screen.findByText("Exported 1 of 2 files"),
    ).toBeInTheDocument();
    expect(screen.getByText("Export cancelled")).toBeInTheDocument();
    expect(saveAudio).toHaveBeenCalledOnce();

    await user.click(
      screen.getByRole("button", { name: "Close export dialog" }),
    );
    expect(dialog).toHaveAttribute("data-closed");
  });

  it("reports an empty project without opening the directory picker", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    const saveAudio = vi.spyOn(commands, "saveAudio");

    renderExportSidebar({}, [
      {
        id: "empty",
        text: "",
        query: null,
        pitch_noise_seed: 0,
        preset_id: null,
      },
    ]);

    await screen.findByText("Default");
    await openExportAll(user);

    const dialog = await screen.findByRole("dialog", { name: "Export all" });
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByText("There are no text cells to export."),
    ).toBeInTheDocument();
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(saveAudio).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(dialog).toHaveAttribute("data-closed");
  });
});

describe("Sidebar recent projects", () => {
  const loadedProject = {
    blocks: [
      {
        id: "loaded-block",
        text: "Loaded block",
        query: null,
        pitch_noise_seed: 0,
        preset_id: "preset-1",
      },
    ],
    presets: [preset({ name: "Loaded preset" })],
  };

  const renderRecentSidebar = (recent: string[]) => {
    let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
    let text!: NonNullable<ReturnType<typeof useTextStore>>;
    const result = renderSidebarHook(
      ({ config: configStore, meta, text: textStore }) => {
        appConfig = configStore;
        text = textStore;
        batch(() => {
          configStore.setConfig(
            config({ auto_save: false, recent_projects: recent }),
          );
          meta.setMetas(metas);
          textStore.setProjectPresetStore([preset()]);
          textStore.replaceTextBlocks([
            {
              id: "block",
              text: "Original",
              query: audioQuery(),
              pitch_noise_seed: 0,
              preset_id: "preset-1",
            },
          ]);
        });
        textStore.markProjectSaved();
      },
    );
    return {
      ...result,
      getRecent: () => appConfig.config.ui.recent_projects,
      getText: () => text,
    };
  };

  it("records saved and loaded projects, most recent first", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    vi.spyOn(commands, "saveProject").mockResolvedValue({
      status: "ok",
      data: null,
    });
    vi.spyOn(commands, "loadProject").mockResolvedValue({
      status: "ok",
      data: loadedProject,
    });
    dialogs.save.mockResolvedValueOnce("/tmp/saved.azp");
    dialogs.open.mockResolvedValueOnce("/tmp/opened.azp");
    const { getControls, getRecent } = renderRecentSidebar(["/tmp/old.azp"]);
    await Promise.resolve();
    const controls = getControls();

    expect(await controls.saveProject()).toBe(true);
    expect(getRecent()).toEqual(["/tmp/saved.azp", "/tmp/old.azp"]);

    await controls.loadProject();
    expect(getRecent()).toEqual([
      "/tmp/opened.azp",
      "/tmp/saved.azp",
      "/tmp/old.azp",
    ]);
  });

  it("opens the previous project other than the current one and removes failed entries", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    const loadProject = vi
      .spyOn(commands, "loadProject")
      .mockResolvedValue({ status: "ok", data: loadedProject });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getControls, getRecent, getText } = renderRecentSidebar([
      "/tmp/current.azp",
      "/tmp/previous.azp",
      "/tmp/missing.azp",
    ]);
    await Promise.resolve();
    const controls = getControls();
    const text = getText();
    text.setProjectPath("/tmp/current.azp");

    expect(controls.previousProject()).toBe("/tmp/previous.azp");
    controls.openPreviousProject();
    await waitFor(() => expect(text.projectPath()).toBe("/tmp/previous.azp"));
    expect(loadProject).toHaveBeenCalledWith("/tmp/previous.azp");
    expect(text.textStore[0].text).toBe("Loaded block");
    expect(text.isProjectDirty()).toBe(false);
    expect(getRecent()).toEqual([
      "/tmp/previous.azp",
      "/tmp/current.azp",
      "/tmp/missing.azp",
    ]);
    expect(controls.previousProject()).toBe("/tmp/current.azp");

    loadProject.mockResolvedValueOnce({
      status: "error",
      error: "file not found",
    });
    controls.openRecentProject("/tmp/missing.azp");
    await waitFor(() =>
      expect(getRecent()).toEqual(["/tmp/previous.azp", "/tmp/current.azp"]),
    );
    expect(
      await screen.findByRole("status", {
        name: "Couldn't open the project /tmp/missing.azp",
      }),
    ).toHaveAccessibleDescription("file not found");
    expect(text.projectPath()).toBe("/tmp/previous.azp");

    controls.clearRecentProjects();
    expect(getRecent()).toEqual([]);
    expect(controls.previousProject()).toBeNull();
    loadProject.mockClear();
    controls.openPreviousProject();
    expect(loadProject).not.toHaveBeenCalled();
  });

  it("asks about unsaved changes before opening a recent project", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    const loadProject = vi
      .spyOn(commands, "loadProject")
      .mockResolvedValue({ status: "ok", data: loadedProject });
    const { getControls, getText } = renderRecentSidebar(["/tmp/recent.azp"]);
    await Promise.resolve();
    const controls = getControls();
    const text = getText();
    text.setTextStore(0, "text", "Edited");

    controls.openRecentProject("/tmp/recent.azp");
    expect(controls.uiStore.pendingProjectAction).toEqual({
      kind: "open_recent",
      path: "/tmp/recent.azp",
    });
    await controls.resolveProjectAction("cancel");
    expect(loadProject).not.toHaveBeenCalled();
    expect(text.textStore[0].text).toBe("Edited");

    controls.openRecentProject("/tmp/recent.azp");
    await controls.resolveProjectAction("discard");
    expect(loadProject).toHaveBeenCalledWith("/tmp/recent.azp");
    expect(text.projectPath()).toBe("/tmp/recent.azp");
    expect(text.textStore[0].text).toBe("Loaded block");
  });

  it("opens a project forwarded from a second launch", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const loadProject = vi
      .spyOn(commands, "loadProject")
      .mockResolvedValue({ status: "ok", data: loadedProject });
    const { getControls, getRecent, getText } = renderRecentSidebar([
      "/tmp/old.azp",
    ]);
    await Promise.resolve();
    await Promise.resolve();
    const text = getText();

    await events.openProjectRequested.emit({ path: "/tmp/forwarded.azp" });
    await waitFor(() => expect(text.projectPath()).toBe("/tmp/forwarded.azp"));
    expect(loadProject).toHaveBeenCalledWith("/tmp/forwarded.azp");
    expect(text.textStore[0].text).toBe("Loaded block");
    expect(getRecent()).toEqual(["/tmp/forwarded.azp", "/tmp/old.azp"]);

    text.setTextStore(0, "text", "Edited");
    loadProject.mockClear();
    await events.openProjectRequested.emit({ path: "/tmp/other.azp" });
    expect(getControls().uiStore.pendingProjectAction).toEqual({
      kind: "open_recent",
      path: "/tmp/other.azp",
    });
    expect(loadProject).not.toHaveBeenCalled();
    await getControls().resolveProjectAction("cancel");
    expect(text.textStore[0].text).toBe("Edited");
  });

  it("shows an error toast when a forwarded project cannot be opened", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    vi.spyOn(commands, "loadProject").mockResolvedValue({
      status: "error",
      error: "file not found",
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getText } = renderRecentSidebar([]);
    await Promise.resolve();
    await Promise.resolve();

    await events.openProjectRequested.emit({ path: "/tmp/stale.azp" });
    expect(
      await screen.findByRole("status", {
        name: "Couldn't open the project /tmp/stale.azp",
      }),
    ).toHaveAccessibleDescription("file not found");
    expect(getText().projectPath()).toBeNull();
    expect(getText().textStore[0].text).toBe("Original");
  });

  it("stops listening for forwarded projects after unmounting", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    const loadProject = vi
      .spyOn(commands, "loadProject")
      .mockResolvedValue({ status: "ok", data: loadedProject });

    const mounted = renderRecentSidebar([]);
    await waitFor(async () => {
      await events.openProjectRequested.emit({ path: "/tmp/first.azp" });
      expect(loadProject).toHaveBeenCalledTimes(1);
    });
    mounted.unmount();
    await events.openProjectRequested.emit({ path: "/tmp/after.azp" });

    // Unmounting before the listener registers must also release it.
    renderRecentSidebar([]).unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await events.openProjectRequested.emit({ path: "/tmp/late.azp" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadProject).toHaveBeenCalledTimes(1);
    expect(loadProject).toHaveBeenCalledWith("/tmp/first.azp");
  });

  it("logs when listening for forwarded projects fails", async () => {
    mockIPC((cmd) => {
      if (cmd === "plugin:event|listen") throw "listen unavailable";
      return cmd === "get_os" ? "Linux" : null;
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    renderRecentSidebar([]);
    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        "Failed to listen for open project requests:",
        "listen unavailable",
      ),
    );
  });

  it("lists recent projects in the project menu", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const loaded: string[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "get_os") return "Linux";
      if (cmd === "load_project") {
        loaded.push((args as { path: string }).path);
        return loadedProject;
      }
      return null;
    });
    let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
    renderSidebar(({ config: configStore, meta, text }) => {
      appConfig = configStore;
      batch(() => {
        configStore.setConfig(
          config({
            recent_projects: ["/home/user/first.azp", "C:\\work\\second.azp"],
          }),
        );
        meta.setMetas(metas);
        text.setProjectPresetStore([preset()]);
      });
      text.markProjectSaved();
    });

    await user.click(
      await screen.findByRole("button", { name: "Project actions" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Open Previous Project" }),
    ).not.toHaveAttribute("data-disabled");
    const recent = screen.getByRole("menuitem", { name: "Open Recent" });
    await user.click(recent);
    expect(await screen.findByText("second.azp")).toBeInTheDocument();
    expect(screen.getByText("C:\\work\\second.azp")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /first\.azp/ }));
    await waitFor(() => expect(loaded).toEqual(["/home/user/first.azp"]));
    await waitFor(() =>
      expect(appConfig.config.ui.recent_projects).toEqual([
        "/home/user/first.azp",
        "C:\\work\\second.azp",
      ]),
    );

    await user.click(screen.getByRole("button", { name: "Project actions" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Open Recent" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Clear Recent Projects" }),
    );
    expect(appConfig.config.ui.recent_projects).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Project actions" }));
    expect(
      await screen.findByRole("menuitem", { name: "Open Recent" }),
    ).toHaveAttribute("data-disabled");
    expect(
      screen.getByRole("menuitem", { name: "Open Previous Project" }),
    ).toHaveAttribute("data-disabled");
  });
});
