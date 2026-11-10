import { type AvailableUpdate, commands, events } from "$binding";
import { ConfigProvider, useConfigStore } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider, useMetaStore } from "@contexts/meta";
import { SpectrogramProvider } from "@contexts/spectrogram";
import { TextProvider, useTextStore } from "@contexts/text";
import { UIProvider, useUIStore } from "@contexts/ui";
import { UpdateDialog } from "@dialogs/Update";
import { MultiProvider } from "@solid-primitives/context";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import userEvent from "@testing-library/user-event";
import { batch, type Component, onMount } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../i18n/en.json";
import { audioQuery, config, metas, preset } from "../test/fixtures";

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

const releaseUrl =
  "https://github.com/Patchethium/Azalea/releases/tag/app-v1.1.0";
const update = (overrides: Partial<AvailableUpdate> = {}): AvailableUpdate => ({
  version: "1.1.0",
  current_version: "1.0.0",
  installable: true,
  release_url: releaseUrl,
  ...overrides,
});

/** Starts the app's contexts with updates supported and the startup check on. */
function renderDialog() {
  let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
  let ui!: NonNullable<ReturnType<typeof useUIStore>>;
  let text!: NonNullable<ReturnType<typeof useTextStore>>;
  const Harness: Component = () => {
    appConfig = useConfigStore()!;
    ui = useUIStore()!;
    text = useTextStore()!;
    const meta = useMetaStore()!;
    onMount(() => {
      batch(() => {
        appConfig.setConfig(config({ auto_save: false }));
        meta.setMetas(metas);
        text.setProjectPresetStore([preset()]);
        text.replaceTextBlocks([
          {
            id: "block",
            text: "Original",
            query: audioQuery(),
            pitch_noise_seed: 0,
            preset_id: "preset-1",
          },
        ]);
      });
      text.markProjectSaved();
      appConfig.setConfigInitialized(true);
    });
    return <UpdateDialog />;
  };
  render(() => (
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
  return { appConfig: () => appConfig, ui: () => ui, text: () => text };
}

/** Kobalte keeps a closed dialog mounted, marked closed, in jsdom. */
const closed = () =>
  waitFor(() =>
    expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute(
      "data-closed",
    ),
  );
const opened = () =>
  waitFor(() =>
    expect(screen.getByRole("dialog")).not.toHaveAttribute("data-closed"),
  );

const button = (name: string) => screen.getByRole("button", { name });

describe("UpdateDialog", () => {
  beforeEach(() => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.mocked(commands.updatesSupported).mockResolvedValue(true);
    vi.mocked(openExternal).mockResolvedValue();
  });

  it("stays closed when the startup check finds nothing", async () => {
    const check = vi
      .spyOn(commands, "checkForUpdate")
      .mockResolvedValue({ status: "ok", data: null });
    renderDialog();
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers the update found at startup, downloads it and restarts into it", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.spyOn(commands, "checkForUpdate").mockResolvedValue({
      status: "ok",
      data: update(),
    });
    let finish!: (cancelled: boolean) => void;
    const download = vi.spyOn(commands, "downloadUpdate").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = (cancelled) => resolve({ status: "ok", data: cancelled });
        }),
    );
    const install = vi
      .spyOn(commands, "installUpdate")
      .mockResolvedValue({ status: "ok", data: null });
    const { ui } = renderDialog();

    const dialog = await screen.findByRole("dialog", { name: en.update.title });
    expect(dialog).toHaveTextContent(
      "Azalea 1.1.0 is available. You have 1.0.0.",
    );
    expect(screen.queryByText(en.update.manual)).not.toBeInTheDocument();

    await user.click(screen.getByText(en.update.release_notes));
    expect(openExternal).toHaveBeenCalledWith(releaseUrl);

    await user.click(button(en.update.download));
    const progress = await screen.findByRole("progressbar", {
      name: en.update.downloading,
    });
    // The size is unknown until the server announces it.
    expect(progress).not.toHaveAttribute("aria-valuenow");
    expect(
      screen.queryByRole("button", { name: en.update.download }),
    ).toBeNull();
    const id = download.mock.calls[0][0];
    await events.updateDownloadProgressEvent.emit({
      operation_id: id,
      completed_bytes: 1048576,
      total_bytes: 4194304,
    });
    await waitFor(() =>
      expect(progress).toHaveAttribute("aria-valuetext", "1 MB / 4 MB"),
    );
    expect(progress).toHaveAttribute("aria-valuenow", "1048576");
    expect(progress).toHaveAttribute("aria-valuemax", "4194304");

    finish(false);
    await screen.findByText(en.update.ready);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    // Nothing is unsaved, so the restart needs no confirmation.
    await user.click(button(en.update.restart));
    expect(install).toHaveBeenCalledTimes(1);
    expect(ui().uiStore.pendingProjectAction).toBeNull();
    expect(await screen.findByRole("status")).toHaveTextContent(
      en.update.installing,
    );
    expect(button(en.update.restart)).toBeDisabled();
    expect(button(en.update.later)).toBeDisabled();
    // The installation cannot be dismissed half way.
    await user.click(button(en.update.close));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows megabytes received while the total is unknown", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.spyOn(commands, "checkForUpdate").mockResolvedValue({
      status: "ok",
      data: update(),
    });
    const download = vi
      .spyOn(commands, "downloadUpdate")
      .mockImplementation(() => new Promise(() => undefined));
    renderDialog();
    await user.click(
      await screen.findByRole("button", { name: en.update.download }),
    );
    const progress = await screen.findByRole("progressbar");
    await events.updateDownloadProgressEvent.emit({
      operation_id: download.mock.calls[0][0],
      completed_bytes: 2621440,
      total_bytes: null,
    });
    expect(await screen.findByText("2.5 MB")).toBeInTheDocument();
    expect(progress).not.toHaveAttribute("aria-valuenow");
  });

  it("asks about unsaved changes before restarting", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.spyOn(commands, "checkForUpdate").mockResolvedValue({
      status: "ok",
      data: update(),
    });
    vi.spyOn(commands, "downloadUpdate").mockResolvedValue({
      status: "ok",
      data: false,
    });
    const install = vi.spyOn(commands, "installUpdate");
    const { ui, text } = renderDialog();
    await user.click(
      await screen.findByRole("button", { name: en.update.download }),
    );
    await screen.findByText(en.update.ready);

    text().setTextStore(0, "text", "Edited");
    await user.click(button(en.update.restart));
    expect(ui().uiStore.pendingProjectAction).toBe("install_update");
    expect(install).not.toHaveBeenCalled();
  });

  it("cancels a download from its button and from closing the dialog", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.spyOn(commands, "checkForUpdate").mockResolvedValue({
      status: "ok",
      data: update(),
    });
    let finish!: (cancelled: boolean) => void;
    const download = vi.spyOn(commands, "downloadUpdate").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = (cancelled) => resolve({ status: "ok", data: cancelled });
        }),
    );
    const cancel = vi
      .spyOn(commands, "cancelUpdateDownload")
      .mockResolvedValue();
    const { appConfig } = renderDialog();

    await user.click(
      await screen.findByRole("button", { name: en.update.download }),
    );
    await user.click(
      await screen.findByRole("button", { name: en.update.cancel }),
    );
    expect(cancel).toHaveBeenCalledWith(download.mock.calls[0][0]);
    // The dialog waits for the backend to confirm.
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    finish(true);
    await screen.findByRole("button", { name: en.update.download });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(button(en.update.download));
    await screen.findByRole("progressbar");
    await user.click(button(en.update.close));
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenLastCalledWith(download.mock.calls[1][0]);
    await closed();
    finish(true);
    await waitFor(() =>
      expect(appConfig().updater.store.phase).toBe("available"),
    );
  });

  it("explains failed downloads and installations and allows retrying", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.spyOn(commands, "checkForUpdate").mockResolvedValue({
      status: "ok",
      data: update(),
    });
    const download = vi
      .spyOn(commands, "downloadUpdate")
      .mockResolvedValueOnce({ status: "error", error: "signature mismatch" })
      .mockResolvedValue({ status: "ok", data: false });
    const install = vi
      .spyOn(commands, "installUpdate")
      .mockResolvedValue({ status: "error", error: "permission denied" });
    renderDialog();

    await user.click(
      await screen.findByRole("button", { name: en.update.download }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `${en.update.download_failed} signature mismatch`,
    );

    await user.click(button(en.update.download));
    await screen.findByText(en.update.ready);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(download).toHaveBeenCalledTimes(2);

    await user.click(button(en.update.restart));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `${en.update.install_failed} permission denied`,
    );
    expect(install).toHaveBeenCalledTimes(1);
    expect(button(en.update.restart)).toBeEnabled();
  });

  it("points installations that cannot update themselves at the release page", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.spyOn(commands, "checkForUpdate").mockResolvedValue({
      status: "ok",
      data: update({ installable: false }),
    });
    const download = vi.spyOn(commands, "downloadUpdate");
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    renderDialog();

    await screen.findByText(en.update.manual);
    expect(
      screen.queryByRole("button", { name: en.update.download }),
    ).toBeNull();
    expect(screen.queryByText(en.update.release_notes)).not.toBeInTheDocument();

    await user.click(button(en.update.open_release_page));
    expect(openExternal).toHaveBeenCalledWith(releaseUrl);
    expect(download).not.toHaveBeenCalled();

    vi.mocked(openExternal).mockRejectedValueOnce("no browser");
    await user.click(button(en.update.open_release_page));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "Failed to open the release page:",
        "no browser",
      ),
    );

    await user.click(button(en.update.later));
    await closed();
  });

  it("closes with Later and keeps a downloaded package for the next time", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.spyOn(commands, "checkForUpdate").mockResolvedValue({
      status: "ok",
      data: update(),
    });
    const download = vi
      .spyOn(commands, "downloadUpdate")
      .mockResolvedValue({ status: "ok", data: false });
    const { appConfig } = renderDialog();

    await screen.findByRole("dialog");
    await user.click(button(en.update.later));
    await closed();
    expect(download).not.toHaveBeenCalled();

    appConfig().updater.show();
    await opened();
    await user.click(button(en.update.download));
    await screen.findByText(en.update.ready);
    await user.click(button(en.update.later));
    await closed();
    appConfig().updater.show();
    await opened();
    expect(button(en.update.restart)).toBeEnabled();
    expect(download).toHaveBeenCalledTimes(1);
  });
});
