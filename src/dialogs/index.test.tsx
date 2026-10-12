import { AboutDialog } from "@dialogs/About";
import { AppDialogContent } from "@dialogs/AppContent";
import { PresetManagerDialog } from "@dialogs/PresetManager";
import { UnsavedChangesDialog } from "@dialogs/UnsavedChanges";
import { Dialog } from "@kobalte/core/dialog";
import { MultiProvider } from "@solid-primitives/context";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import userEvent from "@testing-library/user-event";
import { batch, createSignal, type Component, onMount } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { ConfigProvider, useConfigStore } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider, useMetaStore } from "@contexts/meta";
import { TextProvider, useTextStore } from "@contexts/text";
import { UIProvider } from "@contexts/ui";
import { config, metas, preset } from "../test/fixtures";

describe("AppDialogContent", () => {
  it("renders without optional content or classes", () => {
    render(() => (
      <Dialog open>
        <AppDialogContent title="Bare dialog" closeLabel="Close bare dialog" />
      </Dialog>
    ));
    expect(screen.getByRole("dialog", { name: "Bare dialog" })).toBeVisible();
  });

  it("closes on Escape", async () => {
    const [open, setOpen] = createSignal(true);
    render(() => (
      <Dialog open={open()} onOpenChange={setOpen}>
        <AppDialogContent
          title="Escape dialog"
          closeLabel="Close escape dialog"
        />
      </Dialog>
    ));

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(open()).toBe(false));
  });
});

describe("UnsavedChangesDialog", () => {
  const renderDialog = (props: {
    busy?: boolean;
    onSave: () => void;
    onDiscard: () => void;
    onCancel: () => void;
  }) =>
    render(() => (
      <MultiProvider
        values={[
          [MetaProvider, []],
          [UIProvider, null],
          [ConfigProvider, null],
          [i18nProvider, null],
        ]}
      >
        <UnsavedChangesDialog open busy={props.busy ?? false} {...props} />
      </MultiProvider>
    ));

  it("offers save, discard, and cancel actions", () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const onCancel = vi.fn();
    renderDialog({ onSave, onDiscard, onCancel });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSave).toHaveBeenCalledOnce();
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("disables every action while saving", () => {
    renderDialog({
      busy: true,
      onSave: () => {},
      onDiscard: () => {},
      onCancel: () => {},
    });

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("cancels when the dialog is dismissed", () => {
    const onCancel = vi.fn();
    renderDialog({ onSave: () => {}, onDiscard: () => {}, onCancel });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onCancel).toHaveBeenCalled();
  });
});

describe("AboutDialog", () => {
  it("shows the runtime application version", async () => {
    mockIPC((cmd) => (cmd === "plugin:app|version" ? "9.8.7" : null));

    render(() => (
      <MultiProvider
        values={[
          [MetaProvider, []],
          [UIProvider, null],
          [ConfigProvider, null],
          [i18nProvider, null],
        ]}
      >
        <AboutDialog open onOpenChange={() => {}} />
      </MultiProvider>
    ));

    expect(await screen.findByText("9.8.7")).toBeInTheDocument();
  });
});

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
          text.replaceTextBlocks([
            {
              id: "block-1",
              text: "",
              query: null,
              pitch_noise_seed: 0,
              preset_id: "preset-1",
            },
          ]);
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

    const row = (name: string, column: string) =>
      within(screen.getByRole("region", { name: column }))
        .getByText(name)
        .closest("li")!;
    await screen.findByText("Project Only");
    const copyToSystem = within(
      row("Project Only", "Project Presets"),
    ).getByRole("button", { name: "Copy to System" });
    expect(document.querySelector("[title]")).toBeNull();
    fireEvent.focusIn(copyToSystem);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Copy to System",
    );
    fireEvent.focusOut(copyToSystem);
    fireEvent.click(copyToSystem);
    expect(appConfig.config.system_presets?.map((item) => item.name)).toEqual([
      "System Only",
      "Project Only",
    ]);
    expect(appConfig.config.system_presets?.[1].id).not.toBe("preset-1");

    text.setProjectPresetStore(0, "name", "Changed Project");
    expect(appConfig.config.system_presets?.[1].name).toBe("Project Only");

    fireEvent.click(
      within(row("System Only", "System Presets")).getByRole("button", {
        name: "Copy to Project",
      }),
    );
    expect(text.projectPresetStore.map((item) => item.name)).toEqual([
      "Changed Project",
      "System Only",
    ]);
    expect(text.projectPresetStore[1].id).not.toBe("preset-1");

    fireEvent.click(
      within(row("Changed Project", "Project Presets")).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(text.projectPresetStore.map((item) => item.name)).toEqual([
      "System Only",
    ]);
    expect(text.textStore[0].preset_id).toBeNull();

    fireEvent.click(
      within(row("System Only", "System Presets")).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(appConfig.config.system_presets?.map((item) => item.name)).toEqual([
      "Project Only",
    ]);
  });

  it("edits a preset in place of the opposite list", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
    let text!: NonNullable<ReturnType<typeof useTextStore>>;
    const [open, setOpen] = createSignal(true);
    const Harness: Component = () => {
      appConfig = useConfigStore()!;
      text = useTextStore()!;
      const meta = useMetaStore()!;
      onMount(() => {
        batch(() => {
          meta.setMetas(metas);
          appConfig.setConfig({
            ...config(),
            system_presets: [
              preset({ id: "system-1", name: "System One" }),
              preset({ id: "system-2", name: "System Two" }),
            ],
          });
          text.setProjectPresetStore([
            preset({ name: "Project One" }),
            preset({ id: "preset-2", name: "Project Two" }),
          ]);
          text.replaceTextBlocks([
            {
              id: "block-1",
              text: "",
              query: null,
              pitch_noise_seed: 0,
              preset_id: "preset-1",
              pitch_is_modified: true,
            },
          ]);
        });
      });
      return <PresetManagerDialog open={open()} onOpenChange={setOpen} />;
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

    const region = (name: string) => screen.queryByRole("region", { name });
    const editButton = (name: string, column: string) =>
      within(within(region(column)!).getByText(name).closest("li")!).getByRole(
        "button",
        { name: "Edit" },
      );
    const nameField = () =>
      within(region("Edit Preset")!).getByPlaceholderText("Untitled Preset");

    await screen.findByText("Project One");
    expect(region("Edit Preset")).toBeNull();

    // Editing a project preset replaces the system list.
    const editProjectOne = editButton("Project One", "Project Presets");
    expect(editProjectOne).toHaveAttribute("aria-pressed", "false");
    await user.click(editProjectOne);
    expect(region("System Presets")).toBeNull();
    expect(region("Project Presets")).not.toBeNull();
    expect(editProjectOne).toHaveAttribute("aria-pressed", "true");
    expect(nameField()).toHaveValue("Project One");
    await user.clear(nameField());
    await user.type(nameField(), "Renamed");
    expect(text.projectPresetStore[0].name).toBe("Renamed");
    await user.click(
      within(region("Edit Preset")!).getByRole("button", {
        name: "Style Normal",
      }),
    );
    // The dialog marks the Select's portal aria-hidden, as with Config selects.
    await user.click(
      await screen.findByRole("option", { name: "Happy", hidden: true }),
    );
    expect(text.projectPresetStore[0]).toMatchObject({
      style_id: 2,
      style_name: "Happy",
    });
    // A new voice invalidates the edits of blocks using the preset.
    expect(text.textStore[0].pitch_is_modified).toBe(false);

    // Edit switches between presets and toggles the editor off.
    await user.click(editButton("Project Two", "Project Presets"));
    expect(nameField()).toHaveValue("Project Two");
    await user.click(editButton("Project Two", "Project Presets"));
    expect(region("Edit Preset")).toBeNull();
    expect(region("System Presets")).not.toBeNull();

    // Editing a system preset replaces the project list.
    await user.click(editButton("System Two", "System Presets"));
    expect(region("Project Presets")).toBeNull();
    await user.clear(nameField());
    await user.type(nameField(), "Edited System");
    expect(appConfig.config.system_presets?.map((item) => item.name)).toEqual([
      "System One",
      "Edited System",
    ]);
    expect(text.projectPresetStore.map((item) => item.name)).toEqual([
      "Renamed",
      "Project Two",
    ]);

    // Deleting another preset keeps the editor on the same preset.
    await user.click(
      within(
        within(region("System Presets")!)
          .getByText("System One")
          .closest("li")!,
      ).getByRole("button", { name: "Delete" }),
    );
    expect(nameField()).toHaveValue("Edited System");
    await user.click(
      screen.getByRole("button", { name: "Close preset editor" }),
    );
    expect(region("Project Presets")).not.toBeNull();

    // Deleting the edited preset closes its editor.
    await user.click(editButton("Project Two", "Project Presets"));
    await user.click(
      within(
        within(region("Project Presets")!)
          .getByText("Project Two")
          .closest("li")!,
      ).getByRole("button", { name: "Delete" }),
    );
    expect(region("Edit Preset")).toBeNull();
    expect(region("System Presets")).not.toBeNull();

    // Closing the dialog closes the editor.
    await user.click(editButton("Renamed", "Project Presets"));
    setOpen(false);
    setOpen(true);
    await screen.findByText("Renamed");
    expect(region("Edit Preset")).toBeNull();
  });

  it("collapses preset details until a preset is expanded", async () => {
    const Harness: Component = () => {
      const appConfig = useConfigStore()!;
      const text = useTextStore()!;
      const meta = useMetaStore()!;
      onMount(() => {
        meta.setMetas(metas);
        appConfig.setConfig({ ...config(), system_presets: [] });
        text.setProjectPresetStore([
          preset({ name: "Detailed", speed: 120, pitch: 0.05 }),
        ]);
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

    const card = await screen.findByRole("button", { name: /^Detailed/ });
    expect(card).toHaveTextContent("Speaker › Normal");
    expect(card).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("120%")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Project Presets" })).getByText(
        "1",
      ),
    ).toBeInTheDocument();

    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-expanded", "true");
    for (const [label, value] of [
      ["Speed", "120%"],
      ["Pitch", "0.05"],
      ["Volume", "1"],
      ["Start Sli.", "100 ms"],
      ["End Sli.", "200 ms"],
    ]) {
      expect(
        screen.getByText(label, { selector: "dt" }).nextElementSibling,
      ).toHaveTextContent(value);
    }
  });

  it("handles a missing system preset list", async () => {
    let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
    const Harness: Component = () => {
      appConfig = useConfigStore()!;
      const text = useTextStore()!;
      onMount(() => {
        appConfig.setConfig({ ...config(), system_presets: undefined });
        text.setProjectPresetStore([preset({ name: "Project" })]);
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

    const systemColumn = await screen.findByRole("region", {
      name: "System Presets",
    });
    expect(within(systemColumn).getByText("No presets")).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy to System" }),
    );
    expect(appConfig.config.system_presets).toHaveLength(1);

    const remove = within(systemColumn).getByRole("button", {
      name: "Delete",
    });
    appConfig.setConfig("system_presets", undefined);
    document.body.append(remove);
    fireEvent.click(remove);
    expect(appConfig.config.system_presets).toEqual([]);
    remove.remove();
  });
});
