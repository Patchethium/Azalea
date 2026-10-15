import { commands, events } from "$binding";
import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { ConfigProvider, useConfigStore } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider } from "@contexts/meta";
import { ShortcutsProvider } from "@contexts/shortcuts";
import { SpectrogramProvider } from "@contexts/spectrogram";
import { SystemProvider } from "@contexts/system";
import { TextProvider, useTextStore } from "@contexts/text";
import { UIProvider } from "@contexts/ui";
import { audioQuery, config, metas, pitchRange } from "./test/fixtures";

const renderApp = () => {
  let text!: NonNullable<ReturnType<typeof useTextStore>>;
  let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
  const Harness = () => {
    text = useTextStore()!;
    appConfig = useConfigStore()!;
    return <App />;
  };
  const result = render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [SpectrogramProvider, null],
        [ConfigProvider, null],
        [SystemProvider, null],
        [ShortcutsProvider, null],
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

async function openConfigSection(name: string) {
  const tab = await screen.findByRole("tab", { name });
  // Synchronous events keep the surrounding async timing unchanged.
  fireEvent.pointerDown(tab, { pointerType: "mouse", button: 0 });
  fireEvent.pointerUp(tab, { pointerType: "mouse", button: 0 });
  fireEvent.click(tab);
}

describe("App initialization", () => {
  it("opens Config on the voice section from the empty state and manages downloads inside it", async () => {
    mockIPC(
      (command) => {
        if (command === "get_download_setup")
          return {
            directory: "/data/voicevox",
            core_config: null,
            components: [
              { id: "0.vvm", bytes: 1024, installed: false, entries: [] },
            ],
          };
        if (command.includes("theme")) return "light";
        return null;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    const view = renderApp();
    await events.initializationEvent.emit({
      config: config(),
      core_initialized: false,
      metas: null,
      range: [],
      error: null,
    });
    await screen.findByRole("heading", { name: "No voices set up" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Choose VOICEVOX folder" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Open config" })[1]);
    expect(await screen.findByRole("dialog", { name: "Config" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Voice" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await screen.findByRole("button", { name: "Choose VOICEVOX folder" });
    expect(
      screen.queryByRole("heading", { name: "Manage models" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Azalea-managed models" }),
    );
    expect(
      await screen.findByRole("checkbox", { name: /^0\.vvm/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("heading", { name: "Manage models" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Available downloads (0.16.4)" }),
    ).toBeInTheDocument();
    expect(view.getConfigStore().setupSource()).toBe("Downloaded");
    fireEvent.click(await screen.findByRole("button", { name: "VOICEVOX" }));
    expect(view.getConfigStore().setupSource()).toBe("ExistingInstallation");
    expect(
      screen.getByRole("button", { name: "Choose VOICEVOX folder" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("heading", { name: "Manage models" }),
    ).not.toBeInTheDocument();
    await openConfigSection("Interface");
    fireEvent.click(screen.getByRole("button", { name: "Close config" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Config" })).toHaveAttribute(
        "data-closed",
      ),
    );
    // The empty state always reopens Config on the voice section.
    fireEvent.click(screen.getAllByRole("button", { name: "Open config" })[1]);
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Voice" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.getByRole("dialog", { name: "Config" })).not.toHaveAttribute(
      "data-closed",
    );
  });
  it.each([
    ["ExistingInstallation", false],
    ["Downloaded", false],
    ["Downloaded", true],
  ] as const)(
    "shows an empty workspace for %s without voices (core ready: %s)",
    async (source, ready) => {
      mockIPC((command) => (command.includes("theme") ? "light" : null), {
        shouldMockEvents: true,
      });
      mockWindows("main");
      const view = renderApp();
      await events.initializationEvent.emit({
        config: { ...config(), setup_source: source },
        core_initialized: ready,
        metas: [],
        range: [],
        error: null,
      });
      await screen.findByRole("heading", { name: "No voices set up" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText("Text to synthesize"),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Accent" })).toBeDisabled();
      expect(screen.getByRole("tab", { name: "Tuning" })).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Create preset" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Manage presets" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Play selected cell" }),
      ).toBeDisabled();
      const previousButton = screen.getByRole("button", {
        name: "Select previous text cell",
      });
      expect(previousButton).toBeDisabled();
      expect(previousButton.className).toContain(
        "disabled:(cursor-not-allowed text-slate-3)",
      );
      expect(
        screen.getAllByRole("separator", { name: "Resize Handle" }),
      ).toHaveLength(2);
      expect(
        screen.getByRole("button", { name: "Project actions" }),
      ).toBeDisabled();
      expect(
        screen.getAllByRole("button", { name: "Open config" }),
      ).toHaveLength(2);
      expect(view.getTextStore().projectPresetStore).toHaveLength(0);
      expect(
        screen.queryByRole("button", { name: "Manage models" }),
      ).not.toBeInTheDocument();
    },
  );

  it("ignores bottom-panel shortcuts while the core is unavailable", async () => {
    mockIPC((command) => (command.includes("theme") ? "light" : null), {
      shouldMockEvents: true,
    });
    mockWindows("main");
    const play = vi.spyOn(commands, "playAudio");
    const view = renderApp();
    await events.initializationEvent.emit({
      config: config({ pitch_completion_enabled: true }),
      core_initialized: false,
      metas,
      range: [],
      error: null,
    });
    await screen.findByRole("heading", { name: "No voices set up" });
    view.getTextStore().setTextStore(0, "query", audioQuery());
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    expect(play).not.toHaveBeenCalled();
    expect(view.getConfigStore().config.ui.pitch_completion_locked).not.toBe(
      true,
    );
  });

  it("keeps Config open while initialization is pending and after failure", async () => {
    mockIPC((command) => (command.includes("theme") ? "light" : null), {
      shouldMockEvents: true,
    });
    mockWindows("main");
    vi.spyOn(commands, "pickCore").mockResolvedValue({
      ort_path: "/runtime",
      ojt_dir: "/dictionary",
      vvm_dir: "/models",
    });
    let finish!: (
      result: Awaited<ReturnType<typeof commands.initCore>>,
    ) => void;
    vi.spyOn(commands, "initCore").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderApp();
    await events.initializationEvent.emit({
      config: config(),
      core_initialized: false,
      metas: [],
      range: [],
      error: null,
    });
    await screen.findByRole("heading", { name: "No voices set up" });
    fireEvent.click(screen.getAllByRole("button", { name: "Open config" })[1]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Choose VOICEVOX folder" }),
    );
    // Storage's asset-size output is also a status in the voice section.
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((status) => status.textContent === "Loading"),
      ).toBe(true),
    );
    expect(screen.getByRole("dialog", { name: "Config" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Choose VOICEVOX folder" }),
    ).toBeDisabled();
    finish({ status: "error", error: "Core could not start" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Core could not start",
    );
    expect(
      screen.getByRole("button", { name: "Choose VOICEVOX folder" }),
    ).toBeEnabled();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Config" }), {
      key: "Escape",
    });
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Config" })).toHaveAttribute(
        "data-closed",
      ),
    );
  });

  it("shows the model manager only in Config and hides it for a VOICEVOX setup", async () => {
    mockIPC(
      (command) => {
        if (command === "get_download_setup")
          return {
            directory: "/data/voicevox",
            components: [],
            core_config: null,
          };
        if (command.includes("theme")) return "light";
        return null;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    const view = renderApp();
    await events.initializationEvent.emit({
      config: config(),
      core_initialized: true,
      active_setup_source: "ExistingInstallation",
      metas,
      range: [],
      error: null,
    });
    await screen.findByLabelText("Text to synthesize");
    expect(
      screen.queryByRole("button", { name: "Manage models" }),
    ).not.toBeInTheDocument();
    view.getConfigStore().setConfig("setup_source", "Downloaded");
    fireEvent.click(screen.getAllByRole("button", { name: "Open config" })[0]);
    await openConfigSection("Voice");
    expect(
      await screen.findByRole("heading", { name: "Manage models" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByText("Checking downloaded components…"),
      ).not.toBeInTheDocument(),
    );
    view.getConfigStore().setConfig("setup_source", "ExistingInstallation");
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Manage models" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows the selected block's character portrait beside the text blocks", async () => {
    const requests: unknown[] = [];
    mockIPC(
      (command, args) => {
        if (command === "get_speaker_portrait") {
          requests.push(args);
          return "data:image/png;base64,cG9ydHJhaXQ=";
        }
        if (command.includes("theme")) return "light";
        return null;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    // jsdom has no layout, so give panels a width for pixel minimum sizes.
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
    const view = renderApp();
    await events.initializationEvent.emit({
      config: config(),
      core_initialized: true,
      active_setup_source: "ExistingInstallation",
      metas,
      range: [],
      error: null,
    });
    await screen.findByLabelText("Text to synthesize");
    expect(
      await screen.findByRole("img", { name: "Portrait of Speaker (Normal)" }),
    ).toHaveAttribute("src", "data:image/png;base64,cG9ydHJhaXQ=");
    expect(requests).toContainEqual({
      request: { speaker_uuid: "speaker-1", style_id: 1 },
    });

    // The portrait panel reaches the window edge without an outer margin.
    const editorPanel = screen
      .getByLabelText("Text to synthesize")
      .closest("[data-corvu-resizable-panel]")!
      .parentElement!.closest("[data-corvu-resizable-panel]") as HTMLElement;
    expect(editorPanel).toHaveClass("mr0");

    // Enter on the handle collapses and restores the panel, like the sidebar.
    const handle = screen.getByRole("separator", {
      name: "Resize portrait panel",
    });
    expect(view.getConfigStore().config.ui.portrait_ratio).toBe(0.25);
    fireEvent.keyDown(handle, { key: "Enter" });
    await waitFor(() =>
      expect(view.getConfigStore().config.ui.portrait_ratio).toBe(0),
    );
    fireEvent.keyDown(handle, { key: "Enter" });
    await waitFor(() =>
      expect(view.getConfigStore().config.ui.portrait_ratio).toBeGreaterThan(0),
    );
    const ratio = view.getConfigStore().config.ui.portrait_ratio;

    // Without a speaker the panel unmounts and the text blocks take the full
    // width again, without changing the stored portrait size.
    const textPanel = screen
      .getByLabelText("Text to synthesize")
      .closest("[data-corvu-resizable-panel]") as HTMLElement;
    view.getTextStore().setTextStore(0, "preset_id", null);
    await waitFor(() =>
      expect(
        screen.queryByRole("separator", { name: "Resize portrait panel" }),
      ).not.toBeInTheDocument(),
    );
    expect(textPanel.style.flexBasis).toBe("100%");
    expect(editorPanel).toHaveClass("mr2");
    expect(view.getConfigStore().config.ui.portrait_ratio).toBe(ratio);
  });

  it("embeds the model manager in Config for the active managed setup", async () => {
    mockIPC(
      (command) => {
        if (command === "get_download_setup")
          return {
            directory: "/data/voicevox",
            components: [],
            core_config: null,
          };
        if (command.includes("theme")) return "light";
        return null;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    renderApp();
    await events.initializationEvent.emit({
      config: { ...config(), setup_source: "Downloaded" },
      core_initialized: true,
      active_setup_source: "Downloaded",
      metas,
      range: [],
      error: null,
    });
    await screen.findByLabelText("Text to synthesize");
    fireEvent.click(screen.getByRole("button", { name: "Open config" }));
    await openConfigSection("Voice");
    expect(
      await screen.findByRole("heading", { name: "Manage models" }),
    ).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Config" })).not.toHaveAttribute(
      "data-closed",
    );
  });

  it("edits keyboard shortcuts from a Config section", async () => {
    mockIPC(
      (command) =>
        command === "get_os"
          ? "Linux"
          : command.includes("theme")
            ? "light"
            : null,
      { shouldMockEvents: true },
    );
    mockWindows("main");
    const view = renderApp();
    await events.initializationEvent.emit({
      config: config(),
      core_initialized: true,
      active_setup_source: "ExistingInstallation",
      metas,
      range: [],
      error: null,
    });
    await screen.findByLabelText("Text to synthesize");
    expect(
      screen.queryByRole("button", { name: "Show keyboard shortcuts" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open config" }));
    await openConfigSection("Shortcuts");
    const save = await screen.findByRole("button", {
      name: /^Save project: /,
    });
    fireEvent.click(save);
    fireEvent.keyDown(save, { key: "S", ctrlKey: true, shiftKey: true });
    expect(
      view.getConfigStore().config.ui.shortcuts?.save_project,
    ).toMatchObject({ key: "S", primary: true, shift: true });
  });

  it.each(["Downloaded", "ExistingInstallation"] as const)(
    "keeps a pending source switch separate from the active %s setup",
    async (active) => {
      mockIPC((command) => (command.includes("theme") ? "light" : null), {
        shouldMockEvents: true,
      });
      mockWindows("main");
      const view = renderApp();
      const requested =
        active === "Downloaded" ? "ExistingInstallation" : "Downloaded";
      const core = {
        ort_path: "/runtime/lib.so",
        ojt_dir: "/dictionary",
        vvm_dir: "/models",
        setup_source: active,
      };
      await events.initializationEvent.emit({
        config: { ...config(), core, setup_source: requested },
        core_initialized: true,
        active_setup_source: active,
        resolved_core: core,
        metas,
        range: [],
        error: null,
      });
      await waitFor(() =>
        expect(view.getConfigStore().setupSource()).toBe(requested),
      );
      expect(view.getConfigStore().activeSetupSource()).toBe(active);
      expect(view.getConfigStore().setupChangePending()).toBe(true);
      await expect(view.getConfigStore().reinitializeCore()).resolves.toBe(
        false,
      );
    },
  );

  it.each(["ExistingInstallation", "Downloaded"] as const)(
    "shows the empty state for an unconfigured source and restores the %s project",
    async (active) => {
      const core = {
        ort_path: "/runtime",
        ojt_dir: "/dictionary",
        vvm_dir: "/models",
        setup_source: active,
      };
      mockIPC(
        (command) => {
          if (command === "get_download_setup")
            return {
              directory: "/data/voicevox",
              components: [],
              core_config: active === "Downloaded" ? core : null,
            };
          return command.includes("theme") ? "light" : null;
        },
        { shouldMockEvents: true },
      );
      mockWindows("main");
      const reinit = vi.spyOn(commands, "reinitCore");
      const view = renderApp();
      await events.initializationEvent.emit({
        config: {
          ...config(),
          core: active === "ExistingInstallation" ? core : null,
          setup_source: active,
        },
        core_initialized: true,
        active_setup_source: active,
        resolved_core: core,
        metas,
        range: [],
        error: null,
      });
      await screen.findByLabelText("Text to synthesize");
      const text = view.getTextStore();
      text.setTextStore(0, "text", "Keep my project");
      text.setTextStore(0, "query", audioQuery());
      text.setTextStore(0, "pitch_is_modified", true);
      const blockId = text.textStore[0].id;
      const presetId = text.projectPresetStore[0].id;
      const openConfig = () =>
        fireEvent.click(
          screen.getAllByRole("button", { name: "Open config" })[0],
        );
      openConfig();
      await openConfigSection("Voice");
      fireEvent.click(
        await screen.findByRole("button", {
          name:
            active === "ExistingInstallation"
              ? "Azalea-managed models"
              : "VOICEVOX",
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Close config" }));
      await screen.findByRole("heading", { name: "No voices set up" });
      await waitFor(() =>
        expect(view.getConfigStore().setupSwitchPending()).toBe(false),
      );
      expect(
        screen.queryByLabelText("Text to synthesize"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Create preset" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Project actions" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Manage user dictionary" }),
      ).toBeDisabled();
      expect(screen.getByRole("tab", { name: "Accent" })).toBeDisabled();
      expect(screen.getByText("No Query")).toBeInTheDocument();
      expect(view.getConfigStore().activeSetupSource()).toBe(active);
      fireEvent.click(
        screen.getAllByRole("button", { name: "Open config" })[1],
      );
      fireEvent.click(
        await screen.findByRole("button", {
          name:
            active === "ExistingInstallation"
              ? "VOICEVOX"
              : "Azalea-managed models",
        }),
      );
      await screen.findByLabelText("Text to synthesize");
      // Config stays open after the voices become ready.
      fireEvent.click(screen.getByRole("button", { name: "Close config" }));
      await waitFor(() =>
        expect(screen.getByRole("dialog", { name: "Config" })).toHaveAttribute(
          "data-closed",
        ),
      );
      expect(
        screen.queryByRole("heading", { name: "No voices set up" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Create preset" }),
      ).toBeEnabled();
      expect(screen.getByRole("tab", { name: "Accent" })).toBeEnabled();
      expect(text.textStore[0]).toMatchObject({
        id: blockId,
        text: "Keep my project",
        pitch_is_modified: true,
        query: audioQuery(),
      });
      expect(text.projectPresetStore[0].id).toBe(presetId);
      expect(text.isProjectDirty()).toBe(true);
      expect(reinit).not.toHaveBeenCalled();
      if (active === "Downloaded") {
        reinit.mockResolvedValue({ status: "ok", data: null });
        vi.spyOn(commands, "getMetas").mockResolvedValue({
          status: "ok",
          data: structuredClone(metas),
        });
        vi.spyOn(commands, "getRange").mockResolvedValue({
          status: "ok",
          data: {},
        });
        await expect(view.getConfigStore().reinitializeCore()).resolves.toBe(
          true,
        );
        expect(reinit).toHaveBeenCalledWith(expect.objectContaining(core));
        expect(text.textStore[0].id).toBe(blockId);
      }
    },
  );

  it("activates a newly picked installation from the empty state without replacing the project", async () => {
    const core = {
      ort_path: "/runtime",
      ojt_dir: "/dictionary",
      vvm_dir: "/models",
      setup_source: "Downloaded" as const,
    };
    const installation = {
      ...core,
      ort_path: "/installation",
      setup_source: "ExistingInstallation" as const,
    };
    mockIPC((command) => (command.includes("theme") ? "light" : null), {
      shouldMockEvents: true,
    });
    mockWindows("main");
    vi.spyOn(commands, "pickCore").mockResolvedValue(installation);
    const reinit = vi
      .spyOn(commands, "reinitCore")
      .mockResolvedValue({ status: "ok", data: null });
    vi.spyOn(commands, "getMetas").mockResolvedValue({
      status: "ok",
      data: structuredClone(metas),
    });
    vi.spyOn(commands, "getRange").mockResolvedValue({
      status: "ok",
      data: {},
    });
    const view = renderApp();
    await events.initializationEvent.emit({
      config: { ...config(), setup_source: "Downloaded" },
      core_initialized: true,
      active_setup_source: "Downloaded",
      resolved_core: core,
      metas,
      range: [],
      error: null,
    });
    await screen.findByLabelText("Text to synthesize");
    const text = view.getTextStore();
    text.setTextStore(0, "text", "Keep this project too");
    const blockId = text.textStore[0].id;
    const presetId = text.projectPresetStore[0].id;
    fireEvent.click(screen.getByRole("button", { name: "Open config" }));
    await openConfigSection("Voice");
    fireEvent.click(await screen.findByRole("button", { name: "VOICEVOX" }));
    fireEvent.click(screen.getByRole("button", { name: "Close config" }));
    await screen.findByRole("heading", { name: "No voices set up" });
    fireEvent.click(screen.getAllByRole("button", { name: "Open config" })[1]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Choose VOICEVOX folder" }),
    );
    await screen.findByLabelText("Text to synthesize");
    expect(reinit).toHaveBeenCalledWith(installation);
    expect(view.getConfigStore().voicesReady()).toBe(true);
    expect(view.getConfigStore().activeSetupSource()).toBe(
      "ExistingInstallation",
    );
    expect(text.textStore[0]).toMatchObject({
      id: blockId,
      text: "Keep this project too",
    });
    expect(text.projectPresetStore[0].id).toBe(presetId);
    expect(text.isProjectDirty()).toBe(true);
  });

  it.each([
    ["Native", true],
    ["Hidden", false],
  ] as const)(
    "applies the saved %s title bar style",
    async (style, decorated) => {
      const calls: Array<{ command: string; payload: unknown }> = [];
      mockIPC(
        (command, payload) => {
          calls.push({ command, payload });
          if (command.includes("theme")) return "light";
          return null;
        },
        { shouldMockEvents: true },
      );
      mockWindows("main");

      renderApp();
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
      await events.initializationEvent.emit({
        config: config({ titlebar_style: style }),
        core_initialized: false,
        metas: null,
        range: [],
        error: null,
      });

      await waitFor(() =>
        expect(calls).toContainEqual({
          command: "plugin:window|set_decorations",
          payload: { label: "main", value: decorated },
        }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Close" }),
        ).not.toBeInTheDocument(),
      );
    },
  );

  it("leaves loading for the empty workspace and applies validated appearance settings", async () => {
    const calls: string[] = [];
    mockIPC(
      (cmd) => {
        calls.push(cmd);
        if (cmd.includes("theme")) return "light";
        return null;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");

    renderApp();
    expect(screen.getByText("Loading")).toBeInTheDocument();
    await Promise.resolve();
    await Promise.resolve();

    await events.initializationEvent.emit({
      config: config({
        embedded_font: true,
        locale: "ZhCn",
        theme_mode: "Dark",
        primary_color: "not-a-color",
      }),
      core_initialized: false,
      metas: null,
      range: [],
      error: null,
    });

    expect(await screen.findByText("尚未设置语音")).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(document.documentElement).toHaveClass("embedded-font");
    expect(document.documentElement).toHaveAttribute("lang", "zh-CN");
    expect(
      document.documentElement.style.getPropertyValue("--primary-color"),
    ).toBe("#3b82f6");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fireEvent.click(screen.getAllByRole("button", { name: "打开设置" })[0]);
    await openConfigSection("语音");
    screen.getByRole("button", { name: "选择 VOICEVOX 文件夹" }).click();
    await waitFor(() => expect(warn).toHaveBeenCalledOnce());
  });

  it("warns once when the system language fell back to English", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    mockWindows("main");
    renderApp();
    await events.initializationEvent.emit({
      config: config({ locale: "En" }),
      core_initialized: false,
      metas: null,
      range: [],
      error: null,
      unsupported_system_locale: "fr-FR",
    });

    const message =
      "Your system language (fr-FR) is not supported, so Azalea is using English.";
    const warningToast = await screen.findByRole("status", { name: message });
    expect(screen.getAllByRole("status", { name: message })).toHaveLength(1);
    expect(warningToast).toHaveClass("border-amber-3");
    const progressTrack = warningToast.querySelector('[role="presentation"]');
    expect(progressTrack).toHaveClass("bg-amber-2");
    expect(progressTrack?.firstElementChild).toHaveClass("bg-amber-5");
    fireEvent.click(screen.getByRole("button", { name: "Close notification" }));
    expect(warningToast).toHaveAttribute("data-closed");
  });

  it("still completes initialization when the backend reports an error", async () => {
    const calls: string[] = [];
    mockIPC(
      (cmd) => {
        calls.push(cmd);
        return cmd === "get_os" ? "Linux" : null;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    renderApp();
    await events.initializationEvent.emit({
      config: null,
      core_initialized: false,
      metas: null,
      range: [],
      error: "core failed",
    });

    await screen.findByRole("heading", { name: "No voices set up" });
    expect(screen.queryByText("Loading")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Open config" })[0]);
    await openConfigSection("Voice");
    expect(
      await screen.findByRole("button", { name: "Choose VOICEVOX folder" }),
    ).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("core failed");
    expect(
      screen.getByRole("status", {
        name: "Couldn't read the settings file. Setting changes won't be saved until it is fixed.",
      }),
    ).toHaveAccessibleDescription("core failed");
  });

  it("shows a toast for each failed settings write but not for core errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockIPC(
      (cmd) => {
        if (cmd === "get_os") return "Linux";
        if (cmd === "set_config") throw "read-only file system";
        return null;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    const { getConfigStore } = renderApp();
    await events.initializationEvent.emit({
      config: config({ locale: "En" }),
      core_initialized: false,
      metas: null,
      range: [],
      error: "core failed",
    });

    const message = "Couldn't save settings";
    const toast = await screen.findByRole("status", { name: message });
    expect(toast).toHaveAccessibleDescription("read-only file system");
    expect(
      screen.queryByRole("status", {
        name: "Couldn't read the settings file. Setting changes won't be saved until it is fixed.",
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close notification" }));
    getConfigStore().setConfig("ui", "auto_save", true);
    await waitFor(() =>
      expect(screen.getAllByRole("status", { name: message })).toHaveLength(1),
    );
    await waitFor(() =>
      expect(screen.getByRole("status", { name: message })).not.toHaveAttribute(
        "data-closed",
      ),
    );
  });

  it("initializes a selected core and opens the editor", async () => {
    mockIPC(
      (cmd) => {
        switch (cmd) {
          case "get_os":
            return "Linux";
          case "pick_core":
            return {
              ort_path: "/test/runtime",
              ojt_dir: "/test/dictionary",
              vvm_dir: "/test/models",
              cache_size: 4,
            };
          case "init_core":
          case "set_config":
            return null;
          case "get_range":
            return {
              1: pitchRange(),
            };
          case "get_metas":
            return [
              {
                name: "Test Speaker",
                styles: [{ id: 1, name: "Normal", type: "talk", order: 0 }],
                version: "1.0.0",
                speaker_uuid: "speaker-1",
                order: 0,
              },
            ];
          default:
            return null;
        }
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    const { getTextStore } = renderApp();
    await Promise.resolve();
    await events.initializationEvent.emit({
      config: config(),
      core_initialized: false,
      metas: null,
      range: [],
      error: null,
    });

    await screen.findByRole("heading", { name: "No voices set up" });
    fireEvent.click(screen.getAllByRole("button", { name: "Open config" })[1]);
    const pickCore = await screen.findByRole("button", {
      name: "Choose VOICEVOX folder",
    });
    pickCore.click();

    expect(
      await screen.findByLabelText(
        "Text to synthesize",
        {},
        { timeout: 3_000 },
      ),
    ).toBeInTheDocument();
    // Config stays open after the voices become ready.
    fireEvent.click(screen.getByRole("button", { name: "Close config" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Config" })).toHaveAttribute(
        "data-closed",
      ),
    );
    expect(screen.getByRole("tab", { name: "Accent" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Create preset" })).toBeEnabled();

    getTextStore().setTextStore([]);
    const create = await screen.findByRole("button", {
      name: "Create text cell",
    });
    create.click();
    expect(getTextStore().textStore).toHaveLength(1);
  });

  it("keeps the sidebar width fixed when the window is resized", async () => {
    mockIPC((cmd) => (cmd.includes("theme") ? "light" : null), {
      shouldMockEvents: true,
    });
    mockWindows("main");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const result = renderApp();
    await events.initializationEvent.emit({
      config: config({ side_width: 240 }),
      core_initialized: true,
      metas,
      range: [],
      error: null,
    });

    const handles = await screen.findAllByRole("separator", {
      name: "Resize Handle",
    });
    const handle = handles.find(
      (element) => element.getAttribute("aria-orientation") === "horizontal",
    )!;
    const sidebar = handle.previousElementSibling as HTMLElement;
    const originalWindowWidth = window.innerWidth;
    const initialBasis = Number.parseFloat(sidebar.style.flexBasis);

    try {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWindowWidth * 2,
      });
      window.dispatchEvent(new Event("resize"));

      await waitFor(() =>
        expect(Number.parseFloat(sidebar.style.flexBasis)).toBeCloseTo(
          initialBasis / 2,
        ),
      );
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWindowWidth,
      });
    }

    result.unmount();
    expect(removeEventListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
    );
  });

  it("collapses and re-expands the sidebar and bottom panel by dragging", async () => {
    mockIPC((cmd) => (cmd.includes("theme") ? "light" : null), {
      shouldMockEvents: true,
    });
    mockWindows("main");
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.hasAttribute("data-corvu-resizable-root")
          ? window.innerWidth
          : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.hasAttribute("data-corvu-resizable-root") &&
          this.className === "size-full"
          ? 1_000
          : 0;
      },
    );
    renderApp();
    await events.initializationEvent.emit({
      config: config({ side_width: 240 }),
      core_initialized: true,
      metas,
      range: [],
      error: null,
    });

    const handles = await screen.findAllByRole("separator", {
      name: "Resize Handle",
    });
    const sidebarHandle = handles.find(
      (element) => element.getAttribute("aria-orientation") === "horizontal",
    )!;
    const bottomHandle = handles.find(
      (element) => element.getAttribute("aria-orientation") === "vertical",
    )!;
    const sidebar = sidebarHandle.previousElementSibling as HTMLElement;
    const bottomPanel = bottomHandle.nextElementSibling as HTMLElement;
    const drag = (
      handle: HTMLElement,
      from: { clientX: number; clientY: number },
      to: { clientX: number; clientY: number },
    ) => {
      handle.setPointerCapture = vi.fn();
      handle.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, ...from }),
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, ...to }),
      );
      window.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, ...to }),
      );
    };

    drag(
      sidebarHandle,
      { clientX: 240, clientY: 0 },
      { clientX: 0, clientY: 0 },
    );
    expect(sidebar).toHaveAttribute("data-collapsed");
    expect(sidebarHandle).toBeInTheDocument();
    drag(
      sidebarHandle,
      { clientX: 0, clientY: 0 },
      { clientX: 200, clientY: 0 },
    );
    expect(sidebar).not.toHaveAttribute("data-collapsed");

    drag(
      bottomHandle,
      { clientX: 0, clientY: 700 },
      { clientX: 0, clientY: 1_000 },
    );
    expect(bottomPanel).toHaveAttribute("data-collapsed");
    expect(bottomHandle).toBeInTheDocument();
    drag(
      bottomHandle,
      { clientX: 0, clientY: 1_000 },
      { clientX: 0, clientY: 800 },
    );
    expect(bottomPanel).not.toHaveAttribute("data-collapsed");
  });

  it("prompts to save before closing a dirty project", async () => {
    mockIPC((cmd) => (cmd.includes("theme") ? "light" : null), {
      shouldMockEvents: true,
    });
    mockWindows("main");
    const { getTextStore } = renderApp();
    await events.initializationEvent.emit({
      config: config(),
      core_initialized: true,
      metas,
      range: [],
      error: null,
    });

    await screen.findByRole("button", { name: "Project actions" });
    getTextStore().setTextStore(0, "text", "Changed");
    await emit("tauri://close-requested", {});

    expect(
      await screen.findByRole("dialog", { name: "Unsaved changes" }),
    ).toBeInTheDocument();
  });

  it("tracks system theme changes and removes the listener on cleanup", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      ...window.matchMedia(""),
      matches: true,
    });
    mockIPC((cmd) => (cmd.includes("theme") ? "light" : null), {
      shouldMockEvents: true,
    });
    mockWindows("main");
    const result = renderApp();
    await events.initializationEvent.emit({
      config: config({ theme_mode: "System" }),
      core_initialized: false,
      metas,
      range: [],
      error: null,
    });
    await screen.findByRole("heading", { name: "No voices set up" });

    await emit("tauri://theme-changed", "dark");
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));

    result.unmount();
    document.documentElement.classList.remove("dark");
    await emit("tauri://theme-changed", "dark");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("falls back to prefers-color-scheme for system theme changes", async () => {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    const mediaQueryList = {
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(
        (_type: string, listener: (event: MediaQueryListEvent) => void) => {
          listeners.push(listener);
        },
      ),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    vi.mocked(window.matchMedia).mockReturnValue(
      mediaQueryList as unknown as MediaQueryList,
    );
    mockIPC((cmd) => (cmd.includes("theme") ? "light" : null), {
      shouldMockEvents: true,
    });
    mockWindows("main");
    const result = renderApp();
    await events.initializationEvent.emit({
      config: config({ theme_mode: "System" }),
      core_initialized: false,
      metas,
      range: [],
      error: null,
    });
    await screen.findByRole("heading", { name: "No voices set up" });

    expect(mediaQueryList.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    expect(document.documentElement).not.toHaveClass("dark");

    listeners[0]({ matches: true } as MediaQueryListEvent);
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));

    listeners[0]({ matches: false } as MediaQueryListEvent);
    await waitFor(() =>
      expect(document.documentElement).not.toHaveClass("dark"),
    );

    result.unmount();
    expect(mediaQueryList.removeEventListener).toHaveBeenCalledWith(
      "change",
      listeners[0],
    );
  });
});
