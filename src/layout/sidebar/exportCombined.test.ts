import { type AzaleaConfig, commands, type TextBlockProps } from "$binding";
import { renderSidebar } from "@layout/sidebar/testUtils";
import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import userEvent from "@testing-library/user-event";
import { batch } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { useConfigStore } from "@contexts/config";
import { audioQuery, config, metas, preset } from "../../test/fixtures";

const dialogs = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => dialogs);
vi.mock("@components/tooltip", () => ({
  Tooltip: (props: { children: unknown }) => props.children,
}));

const block = (
  id: string,
  text: string,
  patch: Partial<TextBlockProps> = {},
): TextBlockProps => ({
  id,
  text,
  query: audioQuery(),
  pitch_noise_seed: 0,
  preset_id: "preset-1",
  ...patch,
});

const renderCombinedSidebar = (
  ui: Partial<AzaleaConfig["ui"]>,
  blocks: TextBlockProps[],
  projectPath: string | null = null,
) => {
  let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
  renderSidebar(({ config: configStore, meta, text }) => {
    appConfig = configStore;
    batch(() => {
      configStore.setConfig(config({ auto_save: false, ...ui }));
      meta.setMetas(metas);
      text.setProjectPresetStore([preset()]);
      text.replaceTextBlocks(blocks);
      text.setProjectPath(projectPath);
    });
  });
  return { getConfig: () => appConfig };
};

const openExportCombined = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByText("Default");
  await user.click(
    await screen.findByRole("button", { name: "Project actions" }),
  );
  await user.click(
    await screen.findByRole("menuitem", { name: "Export all as one file…" }),
  );
};

const setup = () => {
  mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
  return userEvent.setup({ pointerEventsCheck: 0 });
};

describe("Sidebar combined export", () => {
  it("suggests a resolved default path in the dialog and saves the chosen path", async () => {
    const user = setup();
    vi.spyOn(commands, "homeDir").mockResolvedValue("/home/user");
    const audioExportPath = vi
      .spyOn(commands, "audioExportPath")
      .mockImplementation(
        async (dir: string, name: string) => `${dir}/${name}.wav`,
      );
    const resolve = vi
      .spyOn(commands, "resolveAudioSavePath")
      .mockResolvedValue({ status: "ok", data: "/home/user/First(2).wav" });
    const audioQueryCommand = vi
      .spyOn(commands, "audioQuery")
      .mockResolvedValue({ status: "ok", data: audioQuery() });
    const save = vi
      .spyOn(commands, "saveCombinedAudio")
      .mockResolvedValue({ status: "ok", data: "/chosen/mix.wav" });
    const parentPath = vi
      .spyOn(commands, "parentPath")
      .mockResolvedValue("/chosen");
    const openPath = vi
      .spyOn(commands, "openPathLocation")
      .mockResolvedValue({ status: "ok", data: null });
    dialogs.save.mockResolvedValue("/chosen/mix");

    const { getConfig } = renderCombinedSidebar(
      { prevent_overwrite: true, export_text: true, export_lab: true },
      [
        block("first", "First"),
        block("empty", "", { query: null }),
        block("second", "Second", { query: null }),
      ],
    );
    await openExportCombined(user);

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(audioExportPath).toHaveBeenCalledWith("/home/user", "First");
    expect(resolve).toHaveBeenCalledWith("/home/user/First.wav");
    expect(dialogs.save).toHaveBeenCalledWith({
      title: "Export all as one file…",
      filters: [{ name: "Audio", extensions: ["wav"] }],
      defaultPath: "/home/user/First(2).wav",
    });
    expect(audioQueryCommand).toHaveBeenCalledWith("Second", 1, 0);
    const [path, items, preventOverwrite, sidecars] = save.mock.calls[0];
    expect(path).toBe("/chosen/mix.wav");
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.speaker_id)).toEqual([1, 1]);
    expect(items[0].audio_query.prePhonemeLength).toBe(0.1);
    expect(preventOverwrite).toBe(false);
    expect(sidecars).toEqual({ text: "First\nSecond", lab: true });

    const toast = await screen.findByRole("status", {
      name: "Combined audio exported successfully",
    });
    expect(toast).toBeInTheDocument();
    expect(
      screen.queryByRole("status", {
        name: "Exporting all cells as one file…",
      }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(getConfig().config.ui.last_exported_dir).toBe("/chosen"),
    );
    expect(parentPath).toHaveBeenCalledWith("/chosen/mix.wav");
    fireEvent.click(screen.getByRole("button", { name: "Open output folder" }));
    expect(openPath).toHaveBeenCalledWith("/chosen/mix.wav");
  });

  it("writes silently to the pinned directory with exclusive numbering", async () => {
    const user = setup();
    const audioExportPath = vi
      .spyOn(commands, "audioExportPath")
      .mockResolvedValue("/pinned/My Show.wav");
    const resolve = vi.spyOn(commands, "resolveAudioSavePath");
    const save = vi
      .spyOn(commands, "saveCombinedAudio")
      .mockResolvedValue({ status: "ok", data: "/pinned/My Show(2).wav" });
    const parentPath = vi
      .spyOn(commands, "parentPath")
      .mockResolvedValue("/pinned");
    vi.spyOn(commands, "openPathLocation").mockResolvedValue({
      status: "error",
      error: "no file manager",
    });

    const { getConfig } = renderCombinedSidebar(
      {
        default_export_dir: "/pinned",
        default_export_dir_enabled: true,
        silent_save: true,
        prevent_overwrite: true,
        export_text: false,
      },
      [block("first", "hello")],
      "/projects/My Show.azp",
    );
    await openExportCombined(user);

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(dialogs.save).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(audioExportPath).toHaveBeenCalledWith("/pinned", "My Show");
    expect(save).toHaveBeenCalledWith(
      "/pinned/My Show.wav",
      [expect.objectContaining({ speaker_id: 1 })],
      true,
      { text: null, lab: false },
    );
    expect(parentPath).toHaveBeenCalledWith("/pinned/My Show(2).wav");
    await waitFor(() =>
      expect(getConfig().config.ui.last_exported_dir).toBe("/pinned"),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open output folder" }),
    );
    expect(
      await screen.findByRole("status", {
        name: "Couldn't open the output folder",
      }),
    ).toHaveAccessibleDescription("no file manager");
  });

  it("shows an error toast when the combined write fails", async () => {
    const user = setup();
    vi.spyOn(commands, "audioExportPath").mockResolvedValue("/out/hello.wav");
    vi.spyOn(commands, "saveCombinedAudio").mockResolvedValue({
      status: "error",
      error: "sample rate mismatch",
    });
    const parentPath = vi.spyOn(commands, "parentPath");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderCombinedSidebar(
      {
        default_export_dir: "/out",
        default_export_dir_enabled: true,
        silent_save: true,
      },
      [block("first", "hello")],
    );
    await openExportCombined(user);

    expect(
      await screen.findByRole("status", {
        name: "Couldn't export the combined audio to /out/hello.wav",
      }),
    ).toHaveAccessibleDescription("sample rate mismatch");
    expect(parentPath).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith("sample rate mismatch");
  });

  it("aborts with an error toast when a block cannot be prepared", async () => {
    const user = setup();
    vi.spyOn(commands, "audioExportPath").mockResolvedValue("/out/a.wav");
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "error",
      error: "engine down",
    });
    const save = vi.spyOn(commands, "saveCombinedAudio");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ui = {
      default_export_dir: "/out",
      default_export_dir_enabled: true,
      silent_save: true,
    };

    renderCombinedSidebar(ui, [
      block("a", "Alpha"),
      block("b", "Beta", { query: null }),
    ]);
    await openExportCombined(user);
    expect(
      await screen.findByRole("status", {
        name: "Couldn't prepare cell 2 for the combined export",
      }),
    ).toHaveAccessibleDescription("engine down");
    expect(save).not.toHaveBeenCalled();
  });

  it("reports blocks without a preset", async () => {
    const user = setup();
    vi.spyOn(commands, "audioExportPath").mockResolvedValue("/out/a.wav");
    const save = vi.spyOn(commands, "saveCombinedAudio");

    renderCombinedSidebar(
      {
        default_export_dir: "/out",
        default_export_dir_enabled: true,
        silent_save: true,
      },
      [block("a", "Alpha", { preset_id: null })],
    );
    await openExportCombined(user);
    expect(
      await screen.findByRole("status", {
        name: "Couldn't prepare cell 1 for the combined export",
      }),
    ).toHaveAccessibleDescription("No preset is assigned to this text cell.");
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the unresolved path when resolving fails and stops on cancel", async () => {
    const user = setup();
    vi.spyOn(commands, "homeDir").mockResolvedValue(null);
    vi.spyOn(commands, "audioExportPath").mockResolvedValue("./Saved.wav");
    vi.spyOn(commands, "resolveAudioSavePath").mockResolvedValue({
      status: "error",
      error: "permission denied",
    });
    const save = vi.spyOn(commands, "saveCombinedAudio");
    vi.spyOn(console, "error").mockImplementation(() => {});
    dialogs.save.mockResolvedValue(null);

    renderCombinedSidebar({ prevent_overwrite: true }, [block("a", "Alpha")]);
    await openExportCombined(user);

    await waitFor(() =>
      expect(dialogs.save).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: "./Saved.wav" }),
      ),
    );
    expect(
      await screen.findByRole("status", {
        name: "Couldn't check for existing files; the suggested filename may replace one",
      }),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("reports unexpected failures with the target name", async () => {
    const user = setup();
    vi.spyOn(commands, "audioExportPath").mockRejectedValue(
      new Error("ipc closed"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderCombinedSidebar(
      {
        default_export_dir: "/out",
        default_export_dir_enabled: true,
        silent_save: true,
      },
      [block("a", "Alpha")],
    );
    await openExportCombined(user);
    expect(
      await screen.findByRole("status", {
        name: "Couldn't export the combined audio to Alpha",
      }),
    ).toHaveAccessibleDescription("ipc closed");
  });

  it("warns about an empty project without opening a dialog", async () => {
    const user = setup();
    const exportPath = vi.spyOn(commands, "audioExportPath");
    const save = vi.spyOn(commands, "saveCombinedAudio");

    renderCombinedSidebar({}, [block("empty", "", { query: null })]);
    await openExportCombined(user);

    expect(
      await screen.findByRole("status", {
        name: "There are no text cells to export.",
      }),
    ).toBeInTheDocument();
    expect(dialogs.save).not.toHaveBeenCalled();
    expect(exportPath).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
