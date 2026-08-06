import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import { batch, type Component, onMount } from "solid-js";
import { describe, expect, it } from "vitest";
import { ConfigProvider, useConfigStore } from "../contexts/config";
import { i18nProvider } from "../contexts/i18n";
import { MetaProvider } from "../contexts/meta";
import { SystemProvider } from "../contexts/system";
import { TextProvider, useTextStore } from "../contexts/text";
import { UIProvider } from "../contexts/ui";
import { config, preset } from "../test/fixtures";
import { PresetManagerDialog } from "./PresetManagerDialog";
import { ShortcutReferenceDialog } from "./ShortcutReferenceDialog";

describe("PresetManagerDialog", () => {
  it("copies independent presets in both directions and deletes them", async () => {
    let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
    let text!: NonNullable<ReturnType<typeof useTextStore>>;
    const Harness: Component = () => {
      appConfig = useConfigStore()!;
      text = useTextStore()!;
      onMount(() => {
        batch(() => {
          appConfig.setConfig({
            ...config(),
            system_presets: [preset({ name: "System Only" })],
          });
          text.setProjectPresetStore([preset({ name: "Project Only" })]);
        });
      });
      return <PresetManagerDialog open onOpenChange={() => {}} />;
    };

    render(() => (
      <MultiProvider
        values={[
          [MetaProvider, []],
          [UIProvider, null],
          [ConfigProvider, null],
          [i18nProvider, null],
          [TextProvider, null],
        ]}
      >
        <Harness />
      </MultiProvider>
    ));

    const projectItem = (await screen.findByText("Project Only"))
      .parentElement!;
    fireEvent.mouseEnter(projectItem);
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy to System" }),
    );
    expect(appConfig.config.system_presets?.map((item) => item.name)).toEqual([
      "System Only",
      "Project Only",
    ]);

    text.setProjectPresetStore(0, "name", "Changed Project");
    expect(appConfig.config.system_presets?.[1].name).toBe("Project Only");

    const systemItem = screen.getByText("System Only").parentElement!;
    fireEvent.mouseEnter(systemItem);
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy to Project" }),
    );
    expect(text.projectPresetStore.map((item) => item.name)).toEqual([
      "Changed Project",
      "System Only",
    ]);

    fireEvent.mouseEnter(screen.getByText("Changed Project").parentElement!);
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Delete" }))[0],
    );
    expect(text.projectPresetStore.map((item) => item.name)).toEqual([
      "System Only",
    ]);

    const systemCopies = screen.getAllByText("System Only");
    fireEvent.mouseEnter(systemCopies[systemCopies.length - 1].parentElement!);
    const deleteButtons = await screen.findAllByRole("button", {
      name: "Delete",
    });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(appConfig.config.system_presets?.map((item) => item.name)).toEqual([
      "Project Only",
    ]);
  });
});

describe("ShortcutReferenceDialog", () => {
  it("records unique shortcuts, reports conflicts, and restores defaults", async () => {
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null));
    let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
    const Harness: Component = () => {
      appConfig = useConfigStore()!;
      onMount(() => appConfig.setConfig(config()));
      return <ShortcutReferenceDialog />;
    };

    render(() => (
      <MultiProvider
        values={[
          [MetaProvider, []],
          [UIProvider, null],
          [ConfigProvider, null],
          [SystemProvider, null],
          [i18nProvider, null],
        ]}
      >
        <Harness />
      </MultiProvider>
    ));

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Show keyboard shortcuts",
      }),
    );
    const saveShortcut = await screen.findByRole("button", {
      name: "Save project: Ctrl + S",
    });
    expect(
      screen.getByRole("button", {
        name: "Play or stop selected cell: Space",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Stop playback:/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(saveShortcut);
    fireEvent.keyDown(saveShortcut, {
      key: "S",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(appConfig.config.ui_config.shortcuts?.save_project).toMatchObject({
      key: "S",
      primary: true,
      shift: true,
    });

    const playShortcut = screen.getByRole("button", {
      name: "Play selected cell: Ctrl + Enter",
    });
    fireEvent.click(playShortcut);
    fireEvent.keyDown(playShortcut, { key: "Enter", shiftKey: true });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That shortcut is already assigned.",
    );
    expect(appConfig.config.ui_config.shortcuts?.play_current).toBeUndefined();

    fireEvent.click(
      screen.getByRole("button", { name: "Restore all defaults" }),
    );
    await waitFor(() =>
      expect(appConfig.config.ui_config.shortcuts?.save_project).toMatchObject({
        key: "S",
        primary: true,
        shift: false,
      }),
    );
    expect(appConfig.config.ui_config.shortcuts?.toggle_playback).toMatchObject(
      {
        key: "Space",
        primary: false,
      },
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
