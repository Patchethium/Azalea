import { type CharacterMeta, commands } from "@binding";
import { renderSidebar, renderSidebarHook } from "@layout/sidebar/testUtils";
import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import userEvent from "@testing-library/user-event";
import { batch } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { useConfigStore } from "../../contexts/config";
import { useTextStore } from "../../contexts/text";
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
              query_is_modified: true,
              preset_id: 0,
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
            query_is_modified: false,
            preset_id: 0,
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
        blocks: [{ id: "current-block", text: "Current block", preset_id: 0 }],
        presets: [{ name: "Default" }],
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
    appConfig.setConfig("ui_config", "auto_save", true);
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
              query_is_modified: true,
              preset_id: 0,
            },
            {
              id: "second",
              text: "Second",
              query: audioQuery(),
              query_is_modified: true,
              preset_id: 1,
            },
            {
              id: "unassigned",
              text: "Unassigned",
              query: null,
              query_is_modified: false,
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
    expect(text.textStore[0].query_is_modified).toBe(true);
    controls.setStyleByName("Happy");
    expect(text.projectPresetStore[0]).toMatchObject({
      style_id: 2,
      speaker_uuid: "speaker-1",
      style_name: "Happy",
    });
    expect(text.textStore[0].query_is_modified).toBe(false);

    text.setTextStore(0, "query_is_modified", true);
    controls.setTextPresetIdx(1);
    expect(text.textStore[0]).toMatchObject({
      preset_id: 1,
      query_is_modified: false,
    });
    text.setTextStore(0, "query_is_modified", true);
    controls.setTextPresetIdx(1);
    expect(text.textStore[0].query_is_modified).toBe(true);

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

    controls.movePreset(-1, 1);
    controls.movePreset(1, 1);
    controls.movePreset(1, -1);
    expect(text.textStore.map((block) => block.preset_id)).toEqual([
      0,
      0,
      null,
    ]);

    controls.createPreset();
    expect(text.projectPresetStore).toHaveLength(3);
    expect(text.textStore[0].preset_id).toBe(2);
    controls.removePreset();
    expect(text.projectPresetStore).toHaveLength(2);
    expect(text.textStore[0].preset_id).toBe(1);

    controls.finishPresetPanelResize();
    controls.setResizingPresetPanel(true);
    controls.setExpanded([]);
    controls.finishPresetPanelResize();
    controls.setResizingPresetPanel(true);
    controls.setExpanded(["preset"]);
    controls.setPresetPanelSizes([0.25, 0.75]);
    controls.finishPresetPanelResize();
    expect(controls.presetPanelSize()).toBe(0.75);
    controls.collapsePresetPanel();
    controls.setPresetPanelContent(document.createElement("div"));

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
        return this.hasAttribute("data-preset-editor-content") ? 600 : 0;
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
            query_is_modified: true,
            preset_id: 0,
          },
          {
            id: "related-block",
            text: "Related block",
            query: audioQuery(),
            query_is_modified: true,
            preset_id: 0,
          },
        ]);
      });
    });

    await screen.findByRole("button", { name: "Create preset" });
    const resizeHandle = screen.getByRole("separator", { name: "Preset" });
    const presetPanel = resizeHandle.nextElementSibling as HTMLElement;
    const presetToggle = screen.getByRole("button", { name: "Preset" });
    expect(resizeHandle).toHaveAttribute("aria-orientation", "vertical");
    await waitFor(() =>
      expect(parseFloat(presetPanel.style.flexBasis)).toBeCloseTo(63.61, 2),
    );
    expect((parseFloat(presetPanel.style.flexBasis) / 100) * 992).toBeCloseTo(
      631,
    );
    fireEvent.keyDown(resizeHandle, { key: "ArrowDown" });
    expect(parseFloat(presetPanel.style.flexBasis)).toBeCloseTo(53.61, 2);
    fireEvent.keyDown(resizeHandle, { key: "ArrowUp" });
    expect(parseFloat(presetPanel.style.flexBasis)).toBeCloseTo(63.61, 2);
    fireEvent.keyDown(resizeHandle, { key: "ArrowUp" });
    expect(parseFloat(presetPanel.style.flexBasis)).toBeCloseTo(63.61, 2);
    await user.click(presetToggle);
    await waitFor(() =>
      expect(presetToggle).toHaveAttribute("aria-expanded", "false"),
    );
    expect(resizeHandle).toHaveAttribute("data-collapsed");
    expect(resizeHandle).toBeDisabled();
    expect(presetPanel.style.flexBasis).toBe("3%");
    await user.click(presetToggle);
    await waitFor(() =>
      expect(presetToggle).toHaveAttribute("aria-expanded", "true"),
    );
    expect(resizeHandle).not.toHaveAttribute("data-collapsed");
    expect(resizeHandle).not.toBeDisabled();
    expect(parseFloat(presetPanel.style.flexBasis)).toBeCloseTo(63.61, 2);
    fireEvent.keyDown(resizeHandle, { key: "ArrowDown" });
    expect(resizeHandle).toHaveAttribute("data-resizing");
    fireEvent.keyDown(resizeHandle, { key: "ArrowDown" });
    fireEvent.keyDown(resizeHandle, { key: "ArrowDown" });
    fireEvent.keyDown(resizeHandle, { key: "ArrowDown" });
    fireEvent.keyDown(resizeHandle, { key: "ArrowDown" });
    await waitFor(() =>
      expect(presetToggle).toHaveAttribute("aria-expanded", "false"),
    );
    expect(resizeHandle).toBeDisabled();
    expect(resizeHandle).not.toHaveAttribute("data-resizing");
    expect(presetPanel.style.flexBasis).toBe("3%");
    await user.click(presetToggle);
    await waitFor(() =>
      expect(presetToggle).toHaveAttribute("aria-expanded", "true"),
    );
    expect(parseFloat(presetPanel.style.flexBasis)).toBeCloseTo(63.61, 2);
    expect(
      screen.getByRole("button", { name: "Move preset up" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Move preset down" }),
    ).toBeInTheDocument();
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
    expect(text.textStore.map((block) => block.query_is_modified)).toEqual([
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
    expect(text.textStore[0].preset_id).toBe(1);
    const moveUp = screen.getByRole("button", { name: "Move preset up" });
    const moveDown = screen.getByRole("button", { name: "Move preset down" });
    expect(moveUp).not.toBeDisabled();
    expect(moveDown).toBeDisabled();
    await user.click(moveUp);
    expect(text.textStore[0].preset_id).toBe(0);
    expect(moveUp).toBeDisabled();
    expect(moveDown).not.toBeDisabled();
    await user.click(moveDown);
    expect(text.textStore[0].preset_id).toBe(1);

    await user.click(screen.getByText("Edited"));
    expect(text.textStore[0].preset_id).toBe(0);
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
