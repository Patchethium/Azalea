import { AboutDialog } from "@dialogs/About";
import { AppDialogContent } from "@dialogs/AppContent";
import { PresetManagerDialog } from "@dialogs/PresetManager";
import { UnsavedChangesDialog } from "@dialogs/UnsavedChanges";
import { Dialog } from "@kobalte/core/dialog";
import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import { batch, createSignal, type Component, onMount } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { ConfigProvider, useConfigStore } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider } from "@contexts/meta";
import { TextProvider, useTextStore } from "@contexts/text";
import { UIProvider } from "@contexts/ui";
import { config, preset } from "../test/fixtures";

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

    const projectItem = (await screen.findByText("Project Only"))
      .parentElement!;
    fireEvent.mouseEnter(projectItem);
    const copyToSystem = await screen.findByRole("button", {
      name: "Copy to System",
    });
    expect(document.querySelector("[title]")).toBeNull();
    fireEvent.focusIn(copyToSystem);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Copy to System",
    );
    fireEvent.focusOut(copyToSystem);
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy to System" }),
    );
    expect(appConfig.config.system_presets?.map((item) => item.name)).toEqual([
      "System Only",
      "Project Only",
    ]);
    expect(appConfig.config.system_presets?.[1].id).not.toBe("preset-1");

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
    expect(text.projectPresetStore[1].id).not.toBe("preset-1");

    fireEvent.mouseEnter(screen.getByText("Changed Project").parentElement!);
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Delete" }))[0],
    );
    expect(text.projectPresetStore.map((item) => item.name)).toEqual([
      "System Only",
    ]);
    expect(text.textStore[0].preset_id).toBeNull();

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

    const project = (await screen.findByText("Project")).parentElement!;
    fireEvent.mouseEnter(project);
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy to System" }),
    );
    expect(appConfig.config.system_presets).toHaveLength(1);
    fireEvent.mouseLeave(project);

    const system = screen.getAllByText("Project")[1].parentElement!;
    fireEvent.mouseEnter(system);
    const remove = await screen.findByRole("button", { name: "Delete" });
    appConfig.setConfig("system_presets", undefined);
    document.body.append(remove);
    fireEvent.click(remove);
    expect(appConfig.config.system_presets).toEqual([]);
    remove.remove();
  });
});
