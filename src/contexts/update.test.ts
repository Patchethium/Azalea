import { type AvailableUpdate, commands, events } from "$binding";
import { createUpdater, type Updater } from "@contexts/update";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const update = (overrides: Partial<AvailableUpdate> = {}): AvailableUpdate => ({
  version: "1.1.0",
  current_version: "1.0.0",
  installable: true,
  release_url: "https://github.com/Patchethium/Azalea/releases/tag/app-v1.1.0",
  ...overrides,
});

const found = (value: AvailableUpdate | null = update()) =>
  ({ status: "ok", data: value }) as const;

/** Lets pending promise callbacks and the effects they trigger run. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function mount(autoCheck: () => boolean | undefined = () => undefined) {
  let updater!: Updater;
  const dispose = createRoot((dispose) => {
    updater = createUpdater(autoCheck);
    return dispose;
  });
  return { updater, dispose };
}

async function mountSupported(
  autoCheck: () => boolean | undefined = () => undefined,
) {
  vi.mocked(commands.updatesSupported).mockResolvedValue(true);
  const mounted = mount(autoCheck);
  await settle();
  expect(mounted.updater.supported()).toBe(true);
  return mounted;
}

/** A download the test finishes by hand. */
function pendingDownload() {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.downloadUpdate>>,
  ) => void;
  const download = vi.spyOn(commands, "downloadUpdate").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  return {
    download,
    finish: (result: Parameters<typeof finish>[0]) => finish(result),
  };
}

describe("createUpdater", () => {
  beforeEach(() => {
    mockIPC(() => null, { shouldMockEvents: true });
  });

  it("offers nothing and checks nothing where updates are unsupported", async () => {
    const check = vi.spyOn(commands, "checkForUpdate");
    const { updater } = mount(() => true);
    await settle();
    expect(updater.supported()).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it("treats a failed or malformed support answer as unsupported", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.mocked(commands.updatesSupported).mockRejectedValueOnce("offline");
    const failed = mount(() => true);
    await settle();
    expect(failed.updater.supported()).toBe(false);
    expect(error).toHaveBeenCalledWith(
      "Failed to ask whether updates are supported:",
      "offline",
    );
    vi.mocked(commands.updatesSupported).mockResolvedValueOnce(
      null as unknown as boolean,
    );
    const malformed = mount(() => true);
    await settle();
    expect(malformed.updater.supported()).toBe(false);
  });

  it("checks once at startup, when the saved setting is known and enabled", async () => {
    const check = vi
      .spyOn(commands, "checkForUpdate")
      .mockResolvedValue(found());
    const [setting, setSetting] = createSignal<boolean | undefined>();
    const { updater } = await mountSupported(setting);
    expect(check).not.toHaveBeenCalled();

    setSetting(true);
    await settle();
    expect(check).toHaveBeenCalledTimes(1);
    expect(updater.store.update).toEqual(update());
    expect(updater.store.phase).toBe("available");
    expect(updater.store.dialogOpen).toBe(true);

    // Toggling the setting later is not another startup.
    setSetting(false);
    setSetting(true);
    await settle();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("does not check at startup when the setting is off, or turned on later", async () => {
    const check = vi
      .spyOn(commands, "checkForUpdate")
      .mockResolvedValue(found());
    const [setting, setSetting] = createSignal(false);
    const { updater } = await mountSupported(setting);
    setSetting(true);
    await settle();
    expect(check).not.toHaveBeenCalled();
    expect(updater.store.dialogOpen).toBe(false);
  });

  it("only logs a failed startup check", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(commands, "checkForUpdate").mockResolvedValue({
      status: "error",
      error: "offline",
    });
    const { updater } = await mountSupported(() => true);
    await settle();
    expect(error).toHaveBeenCalledWith(
      "Failed to check for updates:",
      "offline",
    );
    expect(updater.store.dialogOpen).toBe(false);
    expect(updater.checking()).toBe(false);
  });

  it("reports current, failed and thrown checks", async () => {
    const check = vi.spyOn(commands, "checkForUpdate");
    const { updater } = await mountSupported();

    check.mockResolvedValueOnce(found());
    expect(await updater.check()).toEqual({
      status: "available",
      update: update(),
    });

    // A release that was withdrawn closes the prompt.
    check.mockResolvedValueOnce(found(null));
    expect(await updater.check()).toEqual({ status: "current" });
    expect(updater.store.update).toBeNull();
    expect(updater.store.phase).toBe("idle");
    expect(updater.store.dialogOpen).toBe(false);

    check.mockResolvedValueOnce({ status: "error", error: "offline" });
    expect(await updater.check()).toEqual({
      status: "error",
      error: "offline",
    });
    check.mockRejectedValueOnce("ipc closed");
    expect(await updater.check()).toEqual({
      status: "error",
      error: "ipc closed",
    });
    expect(updater.checking()).toBe(false);
  });

  it("runs one check at a time", async () => {
    let finish!: (value: ReturnType<typeof found>) => void;
    const check = vi.spyOn(commands, "checkForUpdate").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { updater } = await mountSupported();
    const first = updater.check();
    expect(updater.checking()).toBe(true);
    expect(await updater.check()).toEqual({ status: "busy" });
    finish(found());
    expect((await first).status).toBe("available");
    expect(check).toHaveBeenCalledTimes(1);
    expect(updater.checking()).toBe(false);
  });

  it("downloads with progress from its own operation only, then installs", async () => {
    vi.spyOn(commands, "checkForUpdate").mockResolvedValue(found());
    const { download, finish } = pendingDownload();
    const install = vi
      .spyOn(commands, "installUpdate")
      .mockResolvedValue({ status: "ok", data: null });
    const { updater } = await mountSupported();

    // Nothing to download or install before an update is found.
    await updater.download();
    await updater.install();
    expect(download).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();

    await updater.check();
    const downloading = updater.download();
    await settle();
    expect(updater.store.phase).toBe("downloading");
    expect(updater.store.progress).toEqual({ completed: 0, total: null });
    const id = download.mock.calls[0][0];
    // A check must not replace an update that is being downloaded.
    expect(await updater.check()).toEqual({ status: "busy" });
    await updater.install();
    expect(install).not.toHaveBeenCalled();

    await events.updateDownloadProgressEvent.emit({
      operation_id: "another-operation",
      completed_bytes: 999,
      total_bytes: 999,
    });
    expect(updater.store.progress).toEqual({ completed: 0, total: null });
    await events.updateDownloadProgressEvent.emit({
      operation_id: id,
      completed_bytes: 512,
      total_bytes: 2048,
    });
    expect(updater.store.progress).toEqual({ completed: 512, total: 2048 });

    finish({ status: "ok", data: false });
    await downloading;
    expect(updater.store.phase).toBe("ready");
    expect(updater.store.progress).toBeNull();
    // The listener is gone with the download.
    await events.updateDownloadProgressEvent.emit({
      operation_id: id,
      completed_bytes: 1,
      total_bytes: 1,
    });
    expect(updater.store.progress).toBeNull();

    // A downloaded package is not downloaded again, and survives a check
    // that finds the same release.
    await updater.download();
    expect(download).toHaveBeenCalledTimes(1);
    updater.dismiss();
    await updater.check();
    expect(updater.store.phase).toBe("ready");
    expect(updater.store.dialogOpen).toBe(true);

    updater.dismiss();
    await updater.install();
    expect(install).toHaveBeenCalledTimes(1);
    // Azalea is about to restart: stay busy, visibly.
    expect(updater.store.phase).toBe("installing");
    expect(updater.store.dialogOpen).toBe(true);
    updater.dismiss();
    expect(updater.store.dialogOpen).toBe(true);
    expect(await updater.check()).toEqual({ status: "busy" });
  });

  it("downloads a newer release again after one was already downloaded", async () => {
    const check = vi.spyOn(commands, "checkForUpdate");
    check.mockResolvedValueOnce(found());
    vi.spyOn(commands, "downloadUpdate").mockResolvedValue({
      status: "ok",
      data: false,
    });
    const { updater } = await mountSupported();
    await updater.check();
    await updater.download();
    expect(updater.store.phase).toBe("ready");

    check.mockResolvedValueOnce(found(update({ version: "1.2.0" })));
    await updater.check();
    expect(updater.store.phase).toBe("available");
    expect(updater.store.update?.version).toBe("1.2.0");
  });

  it("returns to the offer when a download is cancelled or fails", async () => {
    vi.spyOn(commands, "checkForUpdate").mockResolvedValue(found());
    const { download, finish } = pendingDownload();
    const cancel = vi
      .spyOn(commands, "cancelUpdateDownload")
      .mockResolvedValue();
    const { updater } = await mountSupported();
    await updater.check();

    // Nothing is running yet.
    updater.cancelDownload();
    expect(cancel).not.toHaveBeenCalled();

    let downloading = updater.download();
    await settle();
    // Closing the prompt cancels the download.
    updater.dismiss();
    expect(cancel).toHaveBeenCalledWith(download.mock.calls[0][0]);
    expect(updater.store.dialogOpen).toBe(false);
    finish({ status: "ok", data: true });
    await downloading;
    expect(updater.store.phase).toBe("available");
    expect(updater.store.error).toBeNull();
    expect(updater.store.progress).toBeNull();
    updater.cancelDownload();
    expect(cancel).toHaveBeenCalledTimes(1);

    updater.show();
    expect(updater.store.dialogOpen).toBe(true);
    downloading = updater.download();
    await settle();
    finish({ status: "error", error: "signature mismatch" });
    await downloading;
    expect(updater.store.phase).toBe("available");
    expect(updater.store.error).toBe("signature mismatch");

    download.mockRejectedValueOnce("ipc closed");
    await updater.download();
    expect(updater.store.error).toBe("ipc closed");
    // Trying again clears the old failure.
    downloading = updater.download();
    await settle();
    expect(updater.store.error).toBeNull();
    finish({ status: "ok", data: false });
    await downloading;
    expect(updater.store.phase).toBe("ready");
  });

  it("keeps the package ready when installing fails", async () => {
    vi.spyOn(commands, "checkForUpdate").mockResolvedValue(found());
    vi.spyOn(commands, "downloadUpdate").mockResolvedValue({
      status: "ok",
      data: false,
    });
    const install = vi.spyOn(commands, "installUpdate");
    const { updater } = await mountSupported();
    await updater.check();
    await updater.download();

    install.mockResolvedValueOnce({
      status: "error",
      error: "permission denied",
    });
    await updater.install();
    expect(updater.store.phase).toBe("ready");
    expect(updater.store.error).toBe("permission denied");

    install.mockRejectedValueOnce("ipc closed");
    await updater.install();
    expect(updater.store.phase).toBe("ready");
    expect(updater.store.error).toBe("ipc closed");
  });

  it("never downloads an update this installation cannot install", async () => {
    vi.spyOn(commands, "checkForUpdate").mockResolvedValue(
      found(update({ installable: false })),
    );
    const download = vi.spyOn(commands, "downloadUpdate");
    const { updater } = await mountSupported();
    await updater.check();
    await updater.download();
    expect(download).not.toHaveBeenCalled();
    expect(updater.store.phase).toBe("available");
  });

  it("has no prompt to show without an update", async () => {
    const { updater } = await mountSupported();
    updater.show();
    expect(updater.store.dialogOpen).toBe(false);
  });

  it("ignores answers that arrive after it is disposed", async () => {
    let answerSupport!: (value: boolean) => void;
    vi.mocked(commands.updatesSupported).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerSupport = resolve;
        }),
    );
    const late = mount();
    late.dispose();
    answerSupport(true);
    await settle();
    expect(late.updater.supported()).toBe(false);

    let answerCheck!: (value: ReturnType<typeof found>) => void;
    vi.spyOn(commands, "checkForUpdate").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerCheck = resolve;
        }),
    );
    const checking = await mountSupported();
    const check = checking.updater.check();
    checking.dispose();
    answerCheck(found());
    expect(await check).toEqual({ status: "busy" });
    expect(checking.updater.store.update).toBeNull();

    vi.spyOn(commands, "checkForUpdate").mockResolvedValue(found());
    const { download, finish } = pendingDownload();
    const downloading = await mountSupported();
    await downloading.updater.check();
    const downloaded = downloading.updater.download();
    await settle();
    const id = download.mock.calls[0][0];
    downloading.dispose();
    await events.updateDownloadProgressEvent.emit({
      operation_id: id,
      completed_bytes: 5,
      total_bytes: 10,
    });
    finish({ status: "ok", data: false });
    await downloaded;
    expect(downloading.updater.store.phase).toBe("downloading");
    expect(downloading.updater.store.progress).toEqual({
      completed: 0,
      total: null,
    });

    vi.spyOn(commands, "downloadUpdate").mockResolvedValue({
      status: "ok",
      data: false,
    });
    let failInstall!: (value: { status: "error"; error: string }) => void;
    vi.spyOn(commands, "installUpdate").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          failInstall = resolve;
        }),
    );
    const installing = await mountSupported();
    await installing.updater.check();
    await installing.updater.download();
    const installed = installing.updater.install();
    installing.dispose();
    failInstall({ status: "error", error: "late" });
    await installed;
    expect(installing.updater.store.error).toBeNull();
  });
});
