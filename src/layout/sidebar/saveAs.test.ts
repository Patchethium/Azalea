import { commands } from "$binding";
import { renderSidebar, renderSidebarHook } from "@layout/sidebar/testUtils";
import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import userEvent from "@testing-library/user-event";
import { batch } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { useConfigStore } from "@contexts/config";
import type { useTextStore } from "@contexts/text";
import { audioQuery, config, metas, preset } from "../../test/fixtures";

const dialogs = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => dialogs);
vi.mock("@components/tooltip", () => ({
  Tooltip: (props: { children: unknown }) => props.children,
}));

const renderDirtySidebar = (path: string | null, recent: string[]) => {
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
        textStore.setProjectPath(path);
      });
      textStore.markProjectSaved();
      textStore.setTextStore(0, "text", "Changed");
    },
  );
  return {
    ...result,
    getRecent: () => appConfig.config.ui.recent_projects,
    getText: () => text,
  };
};

describe("Sidebar Save Project As", () => {
  it("writes to the chosen path, then adopts it and records it as recent", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    const saveProject = vi
      .spyOn(commands, "saveProject")
      .mockResolvedValue({ status: "ok", data: null });
    dialogs.save.mockResolvedValue("/tmp/copy.azp");
    const { getControls, getRecent, getText } = renderDirtySidebar(
      "/tmp/old.azp",
      ["/tmp/old.azp"],
    );
    await Promise.resolve();
    const text = getText();
    expect(text.isProjectDirty()).toBe(true);

    expect(await getControls().saveProjectAs()).toBe(true);
    expect(dialogs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Save Project As…",
        defaultPath: "/tmp/old.azp",
      }),
    );
    expect(saveProject).toHaveBeenCalledWith(
      expect.anything(),
      "/tmp/copy.azp",
      true,
    );
    expect(text.projectPath()).toBe("/tmp/copy.azp");
    expect(text.isProjectDirty()).toBe(false);
    expect(getRecent()).toEqual(["/tmp/copy.azp", "/tmp/old.azp"]);
  });

  it("keeps the previous path and shows an error toast when the write fails", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    vi.spyOn(commands, "saveProject").mockResolvedValue({
      status: "error",
      error: "permission denied",
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    dialogs.save.mockResolvedValue("/readonly/copy.azp");
    const { getControls, getRecent, getText } = renderDirtySidebar(
      "/tmp/old.azp",
      ["/tmp/old.azp"],
    );
    await Promise.resolve();
    const text = getText();

    expect(await getControls().saveProjectAs()).toBe(false);
    expect(text.projectPath()).toBe("/tmp/old.azp");
    expect(text.isProjectDirty()).toBe(true);
    expect(getRecent()).toEqual(["/tmp/old.azp"]);
    expect(
      await screen.findByRole("status", {
        name: "Couldn't save the project to /readonly/copy.azp",
      }),
    ).toHaveAccessibleDescription("permission denied");
  });

  it("does nothing when the dialog is cancelled", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    const saveProject = vi.spyOn(commands, "saveProject");
    dialogs.save.mockResolvedValue(null);
    const { getControls, getRecent, getText } = renderDirtySidebar(null, []);
    await Promise.resolve();
    const text = getText();

    expect(await getControls().saveProjectAs()).toBe(false);
    expect(dialogs.save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: undefined }),
    );
    expect(saveProject).not.toHaveBeenCalled();
    expect(text.projectPath()).toBeNull();
    expect(text.isProjectDirty()).toBe(true);
    expect(getRecent()).toEqual([]);
  });

  it("does not let a stale save replace a newer Save As path", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    let finishStaleSave!: () => void;
    const saveProject = vi
      .spyOn(commands, "saveProject")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishStaleSave = () => resolve({ status: "ok", data: null });
          }),
      )
      .mockResolvedValue({ status: "ok", data: null });
    dialogs.save.mockResolvedValue("/tmp/copy.azp");
    const { getControls, getRecent, getText } = renderDirtySidebar(
      "/tmp/old.azp",
      [],
    );
    await Promise.resolve();
    const controls = getControls();
    const text = getText();

    const staleSave = controls.saveProject();
    expect(await controls.saveProjectAs()).toBe(true);
    expect(text.projectPath()).toBe("/tmp/copy.azp");
    finishStaleSave();
    expect(await staleSave).toBe(true);
    expect(saveProject).toHaveBeenCalledTimes(2);
    expect(text.projectPath()).toBe("/tmp/copy.azp");
    expect(getRecent()).toEqual(["/tmp/copy.azp"]);
  });

  it("runs from the Ctrl+Shift+S shortcut without overriding plain save", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    const saveProject = vi
      .spyOn(commands, "saveProject")
      .mockResolvedValue({ status: "ok", data: null });
    dialogs.save.mockResolvedValue("/tmp/shortcut.azp");
    const { getText } = renderDirtySidebar("/tmp/old.azp", []);
    await Promise.resolve();

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() =>
      expect(saveProject).toHaveBeenLastCalledWith(
        expect.anything(),
        "/tmp/old.azp",
        true,
      ),
    );
    expect(dialogs.save).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "S", ctrlKey: true, shiftKey: true });
    await waitFor(() =>
      expect(getText().projectPath()).toBe("/tmp/shortcut.azp"),
    );
    expect(dialogs.save).toHaveBeenCalledTimes(1);
    expect(saveProject).toHaveBeenLastCalledWith(
      expect.anything(),
      "/tmp/shortcut.azp",
      true,
    );
  });

  it("offers Save Project As in the project menu", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    const saveProject = vi
      .spyOn(commands, "saveProject")
      .mockResolvedValue({ status: "ok", data: null });
    dialogs.save.mockResolvedValue("/tmp/menu.azp");
    renderSidebar(({ config: configStore, meta, text }) => {
      batch(() => {
        configStore.setConfig(config({ auto_save: false }));
        meta.setMetas(metas);
        text.setProjectPresetStore([preset()]);
      });
      text.markProjectSaved();
    });

    await user.click(
      await screen.findByRole("button", { name: "Project actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Save Project As…" }),
    );
    await waitFor(() =>
      expect(saveProject).toHaveBeenCalledWith(
        expect.anything(),
        "/tmp/menu.azp",
        true,
      ),
    );
  });
});
