import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import userEvent from "@testing-library/user-event";
import { batch, type Component, onMount } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { ConfigProvider, useConfigStore } from "../contexts/config";
import { i18nProvider } from "../contexts/i18n";
import { MetaProvider, useMetaStore } from "../contexts/meta";
import { SystemProvider } from "../contexts/system";
import { TextProvider, useTextStore } from "../contexts/text";
import { UIProvider } from "../contexts/ui";
import { audioQuery, config, metas, preset } from "../test/fixtures";
import Sidebar from "./Sidebar";

const dialogs = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => dialogs);

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
    const Harness: Component = () => {
      appConfig = useConfigStore()!;
      text = useTextStore()!;
      const meta = useMetaStore()!;
      onMount(() => {
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
      return <Sidebar />;
    };

    render(() => (
      <main>
        <MultiProvider
          values={[
            [MetaProvider, []],
            [UIProvider, null],
            [ConfigProvider, null],
            [SystemProvider, null],
            [i18nProvider, null],
            [TextProvider, null],
          ]}
        >
          <Harness />
        </MultiProvider>
      </main>
    ));

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

    await user.click(
      await screen.findByRole("button", { name: "Project actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Load Project" }),
    );
    await waitFor(() => expect(text.textStore[0].text).toBe("Loaded block"));
    expect(text.projectPresetStore[0].name).toBe("Loaded preset");
    expect(text.projectPath()).toBe("/tmp/loaded.azp");

    appConfig.setConfig("ui_config", "auto_save", true);
    text.setTextStore(0, "text", "Autosaved edit");
    await waitFor(
      () =>
        expect(
          invocations.filter(({ cmd }) => cmd === "save_project").length,
        ).toBeGreaterThan(1),
      { timeout: 2_000 },
    );
    const lastSave = invocations
      .filter(({ cmd }) => cmd === "save_project")
      .at(-1)!;
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
