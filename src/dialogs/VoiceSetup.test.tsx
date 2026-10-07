import {
  commands,
  type DownloadProgressEvent,
  type DownloadSetup,
  type DownloadOutcome,
} from "$binding";
import { AppButton } from "@components/button";
import { VoiceSetup, ModelManagerDialog } from "@dialogs/VoiceSetup";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { listen } from "@tauri-apps/api/event";
import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { batch, createSignal, onMount } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, useConfigStore } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider } from "@contexts/meta";
import { UIProvider, useUIStore } from "@contexts/ui";
import { config } from "../test/fixtures";

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const core = {
  ort_path: "/download/runtime/lib.so",
  ojt_dir: "/download/dict",
  vvm_dir: "/download/models",
  setup_source: "Downloaded" as const,
  cpu_num_threads: 0,
  cache_size: 128,
};
const installedCore = {
  ...core,
  ort_path: "/installation/lib.so",
  setup_source: "ExistingInstallation" as const,
};
const setup = (ready = false): DownloadSetup => ({
  directory: "/local/data/com.azalea.app/voicevox",
  core_config: ready ? core : null,
  components: [
    {
      id: "runtime-linux-x64",
      bytes: 1024 * 1024,
      installed: ready,
      entries: [],
    },
    { id: "dictionary", bytes: 2 * 1024 * 1024, installed: ready, entries: [] },
    {
      id: "0.vvm",
      bytes: 3 * 1024 * 1024,
      installed: ready,
      entries: [{ character: "ずんだもん", style: "ノーマル", style_id: 3 }],
    },
    { id: "n0.vvm", bytes: 4 * 1024 * 1024, installed: false, entries: [] },
  ],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let listener: (event: { payload: DownloadProgressEvent }) => void;
let store: NonNullable<ReturnType<typeof useConfigStore>>;
let uiStore: NonNullable<ReturnType<typeof useUIStore>>;
const unlisten = vi.fn();
function mount(
  existing = true,
  downloaded = false,
  modelManager?: "inline" | "sidebar",
) {
  const Harness = () => {
    store = useConfigStore()!;
    const [modelsOpen, setModelsOpen] = createSignal(false);
    const ui = useUIStore()!;
    uiStore = ui;
    onMount(() =>
      batch(() => {
        ui.setUIStore("coreInitialized", existing);
        store.setConfig({
          ...config(),
          core: existing ? installedCore : null,
          setup_source: "Downloaded",
        });
        if (downloaded) {
          store.setConfig("setup_source", "Downloaded");
          store.setDownloadedCore(core);
          store.setActiveSetupSource("Downloaded");
        }
      }),
    );
    return (
      <>
        <VoiceSetup modelManager={modelManager} />
        <AppButton onClick={() => setModelsOpen(true)}>
          Open model manager
        </AppButton>
        <ModelManagerDialog open={modelsOpen()} onOpenChange={setModelsOpen} />
      </>
    );
  };
  return render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, null],
        [i18nProvider, null],
      ]}
    >
      <Harness />
    </MultiProvider>
  ));
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Open model manager" }));
  await screen.findByRole("checkbox", { name: /^0\.vvm/ });
}
async function start() {
  await open();
  fireEvent.click(screen.getByRole("checkbox", { name: /^0\.vvm/ }));
  fireEvent.click(
    screen.getByRole("button", { name: "Download selected packages" }),
  );
  await waitFor(() => expect(commands.downloadCpuSetup).toHaveBeenCalled());
}

describe("VoiceSetup", () => {
  beforeEach(() => {
    unlisten.mockReset();
    vi.mocked(openExternal).mockResolvedValue(undefined);
    vi.spyOn(commands, "getDownloadSetup").mockResolvedValue({
      status: "ok",
      data: setup(),
    });
    vi.spyOn(commands, "downloadCpuSetup").mockResolvedValue({
      status: "ok",
      data: { cancelled: false, icon_errors: [] },
    });
    vi.spyOn(commands, "cancelSetupDownload").mockResolvedValue({
      status: "ok",
      data: null,
    });
    vi.mocked(listen).mockImplementation(async (_name, callback) => {
      listener = callback as typeof listener;
      return unlisten;
    });
    vi.spyOn(commands, "getMetas").mockResolvedValue({
      status: "ok",
      data: [],
    });
    vi.spyOn(commands, "getRange").mockResolvedValue({
      status: "ok",
      data: {},
    });
    vi.spyOn(commands, "initCore").mockResolvedValue({
      status: "ok",
      data: null,
    });
    vi.spyOn(commands, "reinitCore").mockResolvedValue({
      status: "ok",
      data: null,
    });
  });

  it("switches setups with the keyboard without rendering a manager trigger by default", async () => {
    mount();
    store.setConfig("setup_source", "ExistingInstallation");
    const user = userEvent.setup();
    const voicevox = screen.getByRole("button", { name: "VOICEVOX" });
    await user.click(voicevox);
    expect(voicevox).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{ArrowLeft} ");
    await waitFor(() => expect(store.setupSource()).toBe("Downloaded"));
    expect(
      screen.getByRole("button", { name: "Azalea-managed models" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByRole("button", { name: "Manage models" }),
    ).not.toBeInTheDocument();
    expect(store.config.core).toEqual(installedCore);
    expect(store.setupChangePending()).toBe(true);
    await user.click(screen.getByRole("button", { name: "VOICEVOX" }));
    expect(store.setupChangePending()).toBe(false);
    expect(store.config.core).toEqual(installedCore);
  });

  it("opens the shared model manager page in sidebar mode", async () => {
    mount(true, false, "sidebar");
    expect(
      await screen.findByRole("button", { name: "Manage models" }),
    ).toBeInTheDocument();
    store.setConfig("setup_source", "ExistingInstallation");
    expect(
      screen.queryByRole("button", { name: "Manage models" }),
    ).not.toBeInTheDocument();
    store.setConfig("setup_source", "Downloaded");
    fireEvent.click(
      await screen.findByRole("button", { name: "Manage models" }),
    );
    expect(uiStore.uiStore.page).toBe("models");
    expect(
      screen.queryByRole("dialog", { name: "Manage models" }),
    ).not.toBeInTheDocument();
    expect(commands.getDownloadSetup).not.toHaveBeenCalled();
  });

  it("ignores stale setup checks after switching back or unmounting", async () => {
    const lookup = deferred<{ status: "error"; error: string }>();
    vi.mocked(commands.getDownloadSetup).mockReturnValue(lookup.promise);
    const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "VOICEVOX" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Azalea-managed models" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "VOICEVOX" }));
    lookup.resolve({ status: "error", error: "stale failure" });
    await Promise.resolve();
    expect(store.coreError()).toBeNull();
    expect(store.setupSource()).toBe("ExistingInstallation");
    const late = deferred<{ status: "ok"; data: DownloadSetup }>();
    vi.mocked(commands.getDownloadSetup).mockReturnValueOnce(late.promise);
    fireEvent.click(
      screen.getByRole("button", { name: "Azalea-managed models" }),
    );
    view.unmount();
    late.resolve({ status: "ok", data: setup(true) });
    await Promise.resolve();
    expect(commands.initCore).not.toHaveBeenCalled();
  });

  it("shows setup-check failures and allows a retry through the group", async () => {
    vi.mocked(commands.getDownloadSetup)
      .mockResolvedValueOnce({ status: "error", error: "setup check failed" })
      .mockRejectedValueOnce(new Error("network failed"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "VOICEVOX" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Azalea-managed models" }),
    );
    await screen.findByText("setup check failed");
    fireEvent.click(screen.getByRole("button", { name: "VOICEVOX" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Azalea-managed models" }),
    );
    await screen.findByText("Error: network failed");
  });

  it("requires package selection, calculates missing bytes, and supports keyboard selection", async () => {
    mount();
    await open();
    expect(
      screen.getByRole("button", { name: "Download selected packages" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply models" })).toBeDisabled();
    expect(screen.getByText("Download size: 3 MB")).toBeInTheDocument();
    const user = userEvent.setup();
    const checkbox = screen.getByRole("checkbox", { name: /^0\.vvm/ });
    await user.click(checkbox);
    await user.keyboard(" ");
    expect(checkbox).not.toBeChecked();
    await user.keyboard(" ");
    expect(checkbox).toBeChecked();
    expect(screen.getByText("Download size: 6 MB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /^n0\.vvm/ }));
    expect(screen.getByText("Download size: 10 MB")).toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(screen.getByText("Download size: 7 MB")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Model terms" })).toHaveAttribute(
      "href",
      expect.stringContaining("0.16.4"),
    );
    fireEvent.click(screen.getByRole("link", { name: "Model terms" }));
    expect(openExternal).toHaveBeenCalledWith(
      expect.stringContaining("0.16.4/TERMS.txt"),
    );
    vi.mocked(openExternal).mockRejectedValueOnce(new Error("browser failed"));
    fireEvent.click(screen.getByRole("link", { name: "Dictionary license" }));
    await screen.findByText("Error: browser failed");
  });

  it("groups downloaded and available packages and refreshes installation status", async () => {
    mount();
    await open();
    expect(
      screen.queryByRole("heading", { name: "Downloaded models" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Available downloads (0.16.4)" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /^0\.vvm/ }));
    vi.mocked(commands.getDownloadSetup).mockResolvedValueOnce({
      status: "ok",
      data: setup(true),
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh available models" }),
    );
    await screen.findByRole("heading", { name: "Downloaded models" });
    expect(screen.getByRole("checkbox", { name: /^0\.vvm/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^0\.vvm/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /^n0\.vvm/ })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Download selected packages" }),
    ).toBeDisabled();
    expect(screen.getByText("Download size: 0 MB")).toBeInTheDocument();
  });

  it("downloads, ignores stale events, and applies the managed setup without restarting", async () => {
    const job = deferred<{ status: "ok"; data: DownloadOutcome }>();
    vi.mocked(commands.downloadCpuSetup).mockReturnValue(job.promise);
    mount();
    await start();
    const [id, ids] = vi.mocked(commands.downloadCpuSetup).mock.calls[0];
    expect(ids).toEqual(["0.vvm"]);
    listener({
      payload: {
        operation_id: "stale",
        component_id: "wrong",
        completed_bytes: 1,
        total_bytes: 2,
        extracting: false,
      },
    });
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    listener({
      payload: {
        operation_id: id,
        component_id: "0.vvm",
        completed_bytes: 1024 * 1024,
        total_bytes: 3 * 1024 * 1024,
        extracting: false,
      },
    });
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "1048576",
    );
    listener({
      payload: {
        operation_id: id,
        component_id: "0.vvm",
        completed_bytes: 3 * 1024 * 1024,
        total_bytes: 3 * 1024 * 1024,
        extracting: true,
      },
    });
    expect(screen.getByText(/Extracting/)).toBeInTheDocument();
    listener({
      payload: {
        operation_id: id,
        component_id: "speaker-icons",
        completed_bytes: 0,
        total_bytes: 1,
        extracting: false,
      },
    });
    expect(screen.getByText(/Downloading speaker icons/)).toBeInTheDocument();
    vi.mocked(commands.getDownloadSetup).mockResolvedValue({
      status: "ok",
      data: setup(true),
    });
    job.resolve({ status: "ok", data: { cancelled: false, icon_errors: [] } });
    await screen.findByText(/Downloads complete/);
    await waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
    expect(store.setupSource()).toBe("Downloaded");
    fireEvent.click(screen.getByRole("button", { name: "Apply models" }));
    expect(store.setupSource()).toBe("Downloaded");
    await waitFor(() => expect(store.activeSetupSource()).toBe("Downloaded"));
    expect(store.config.core).toEqual(installedCore);
    expect(commands.reinitCore).toHaveBeenCalledWith(core);
    expect(screen.queryByText(/Restart Azalea/)).not.toBeInTheDocument();
    expect(commands.initCore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "VOICEVOX" }));
    await waitFor(() =>
      expect(store.activeSetupSource()).toBe("ExistingInstallation"),
    );
    expect(store.setupSource()).toBe("ExistingInstallation");
    expect(screen.queryByText(/Restart Azalea/)).not.toBeInTheDocument();
  });

  it("initializes a fresh downloaded setup and keeps its thread settings separate", async () => {
    vi.mocked(commands.getDownloadSetup).mockResolvedValue({
      status: "ok",
      data: setup(true),
    });
    mount(false);
    await open();
    expect(screen.getByRole("checkbox", { name: /^0\.vvm/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Apply models" }));
    await waitFor(() => expect(commands.initCore).toHaveBeenCalledWith(core));
    expect(store.config.core).toBeNull();
    store.setCpuNumThreads(4);
    expect(store.cpuNumThreads()).toBe(4);
    expect(store.config.downloaded_setup?.cpu_num_threads).toBe(4);
  });

  it("shows initialization errors when a downloaded setup cannot start", async () => {
    vi.mocked(commands.getDownloadSetup).mockResolvedValue({
      status: "ok",
      data: setup(true),
    });
    vi.mocked(commands.initCore).mockResolvedValue({
      status: "error",
      error: "Cannot initialize this voice setup",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount(false);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Apply models" }));
    await screen.findByText("Cannot initialize this voice setup");
    expect(store.coreError()).toBe("Cannot initialize this voice setup");
  });

  it("refreshes newly installed voices in the active downloaded setup and shows failures", async () => {
    vi.mocked(commands.getDownloadSetup).mockResolvedValue({
      status: "ok",
      data: setup(true),
    });
    vi.spyOn(commands, "reinitCore")
      .mockResolvedValueOnce({ status: "error", error: "Model reload failed" })
      .mockResolvedValue({ status: "ok", data: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount(true, true);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Apply models" }));
    await waitFor(() => expect(commands.reinitCore).toHaveBeenCalledWith(core));
    await screen.findAllByText("Model reload failed");
    fireEvent.click(screen.getByRole("button", { name: "Apply models" }));
    await waitFor(() => expect(store.coreError()).toBeNull());
    expect(commands.getMetas).toHaveBeenCalled();
    expect(commands.initCore).not.toHaveBeenCalled();
  });

  it("reports icon failures without blocking activation", async () => {
    vi.mocked(commands.downloadCpuSetup).mockImplementation(async () => {
      vi.mocked(commands.getDownloadSetup).mockResolvedValue({
        status: "ok",
        data: setup(true),
      });
      return {
        status: "ok",
        data: { cancelled: false, icon_errors: ["missing"] },
      };
    });
    mount();
    await start();
    await screen.findByText("Some speaker icons could not be downloaded.");
    expect(screen.getByRole("button", { name: "Apply models" })).toBeEnabled();
  });

  it("reports download errors and supports retry", async () => {
    vi.mocked(commands.downloadCpuSetup)
      .mockResolvedValueOnce({ status: "error", error: "bad checksum" })
      .mockRejectedValueOnce(new Error("network error"));
    mount();
    await start();
    await screen.findByText("bad checksum");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Error: network error");
    expect(unlisten).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText(/Downloads complete/);
  });

  it("cancels a running download and reports preserved components", async () => {
    const job = deferred<{ status: "ok"; data: DownloadOutcome }>();
    vi.mocked(commands.downloadCpuSetup).mockReturnValue(job.promise);
    mount();
    await start();
    vi.mocked(commands.cancelSetupDownload)
      .mockResolvedValueOnce({ status: "error", error: "cancel error" })
      .mockRejectedValueOnce(new Error("cancel rejected"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel download" }));
    await screen.findByText("cancel error");
    fireEvent.click(screen.getByRole("button", { name: "Cancel download" }));
    await screen.findByText("Error: cancel rejected");
    fireEvent.click(screen.getByRole("button", { name: "Cancel download" }));
    expect(commands.cancelSetupDownload).toHaveBeenCalledWith(
      vi.mocked(commands.downloadCpuSetup).mock.calls[0][0],
    );
    job.resolve({ status: "ok", data: { cancelled: true, icon_errors: [] } });
    await screen.findByText(/Download cancelled/);
  });

  it("retries catalog errors and ignores results after closing", async () => {
    vi.mocked(commands.getDownloadSetup)
      .mockResolvedValueOnce({ status: "error", error: "unsupported target" })
      .mockRejectedValueOnce(new Error("status failed"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Open model manager" }));
    await screen.findByText("unsupported target");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Error: status failed");
    const lookup = deferred<{ status: "ok"; data: DownloadSetup }>();
    vi.mocked(commands.getDownloadSetup).mockReturnValueOnce(lookup.promise);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Close model manager" }),
    );
    lookup.resolve({ status: "ok", data: setup(true) });
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveAttribute("data-closed"),
    );
    expect(store.setupSource()).toBe("Downloaded");
  });

  it("cancels on close/unmount and releases delayed listeners without starting a job", async () => {
    const listening = deferred<() => void>();
    vi.mocked(listen).mockReturnValueOnce(listening.promise);
    const view = mount();
    await open();
    fireEvent.click(screen.getByRole("checkbox", { name: /^0\.vvm/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Download selected packages" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Close model manager" }),
    );
    view.unmount();
    listening.resolve(unlisten);
    await waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
    expect(commands.downloadCpuSetup).not.toHaveBeenCalled();
    expect(commands.cancelSetupDownload).toHaveBeenCalled();
  });
});
