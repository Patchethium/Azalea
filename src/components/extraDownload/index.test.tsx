import { commands, events, type ExtraStatus } from "$binding";
import en from "../../i18n/en.json";
import { AppToastRegion } from "@components/toast";
import { ConfigPage } from "@dialogs/config";
import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import { batch, type Component, onMount } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, useConfigStore } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider } from "@contexts/meta";
import { type ConfigSection, UIProvider, useUIStore } from "@contexts/ui";
import { config } from "../../test/fixtures";

const status = (fonts: boolean, english: boolean): ExtraStatus[] => [
  { pack: "Fonts", bytes: 23187805, installed: fonts },
  { pack: "EnglishModels", bytes: 7887840, installed: english },
];

function renderConfig(section: ConfigSection) {
  let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
  const Harness: Component = () => {
    appConfig = useConfigStore()!;
    const ui = useUIStore()!;
    onMount(() => {
      batch(() => {
        appConfig.setConfig(config());
        ui.setUIStore("configSection", section);
        ui.setUIStore("page", "config");
      });
    });
    return <ConfigPage />;
  };
  render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, null],
        [i18nProvider, null],
      ]}
    >
      <Harness />
      <AppToastRegion />
    </MultiProvider>
  ));
  return () => appConfig;
}

describe("ExtraDownloadButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads the English models in place of the switch with progress and cancel", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "getAssetsSize").mockResolvedValue({
      status: "ok",
      data: 0,
    });
    vi.mocked(commands.getExtrasStatus)
      .mockResolvedValueOnce({ status: "ok", data: status(true, false) })
      .mockResolvedValue({ status: "ok", data: status(true, true) });
    let finish!: (cancelled: boolean) => void;
    const download = vi.spyOn(commands, "downloadExtra").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = (cancelled) => resolve({ status: "ok", data: cancelled });
        }),
    );
    const cancel = vi
      .spyOn(commands, "cancelExtraDownload")
      .mockResolvedValue({ status: "ok", data: null });
    const appConfig = renderConfig("synthesis");

    const button = await screen.findByRole("button", {
      name: `${en.config.english_transform}: Download (7.5 MB)`,
    });
    expect(
      screen.queryByRole("switch", { name: en.config.english_transform }),
    ).not.toBeInTheDocument();
    // Nested options stay hidden until the models are in place.
    expect(
      screen.queryByRole("switch", {
        name: en.config.english_accent_prediction,
      }),
    ).not.toBeInTheDocument();
    expect(appConfig().englishModelsInstalled()).toBe(false);

    fireEvent.click(button);
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
    const [operationId, pack] = download.mock.calls[0];
    expect(pack).toBe("EnglishModels");
    const progress = screen.getByRole("progressbar", {
      name: `${en.config.english_transform}: ${en.config.extra_downloading}`,
    });
    await events.extraDownloadProgressEvent.emit({
      operation_id: "another-operation",
      pack: "EnglishModels",
      completed_bytes: 7887840,
      total_bytes: 7887840,
    });
    expect(progress).toHaveAttribute("aria-valuenow", "0");
    await events.extraDownloadProgressEvent.emit({
      operation_id: operationId,
      pack: "EnglishModels",
      completed_bytes: 3943920,
      total_bytes: 7887840,
    });
    await waitFor(() =>
      expect(progress).toHaveAttribute("aria-valuenow", "3943920"),
    );

    fireEvent.click(
      screen.getByRole("button", { name: en.config.extra_cancel }),
    );
    expect(cancel).toHaveBeenCalledWith(operationId);

    finish(false);
    const transform = await screen.findByRole("switch", {
      name: en.config.english_transform,
    });
    expect(transform).toBeChecked();
    expect(
      screen.getByRole("switch", { name: en.config.english_accent_prediction }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(appConfig().englishModelsInstalled()).toBe(true);
  });

  it("reports a failed font download and offers the download again", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.mocked(commands.getExtrasStatus).mockResolvedValue({
      status: "ok",
      data: status(false, true),
    });
    const download = vi
      .spyOn(commands, "downloadExtra")
      .mockResolvedValueOnce({ status: "error", error: "network down" })
      .mockRejectedValueOnce("ipc failed");
    renderConfig("interface");

    const label = `${en.config.font}: Download (22.1 MB)`;
    fireEvent.click(await screen.findByRole("button", { name: label }));
    expect(
      screen.queryByRole("group", { name: en.config.font }),
    ).not.toBeInTheDocument();
    const toast = await screen.findByRole("status", {
      name: en.config.extra_download_failed,
    });
    expect(toast).toHaveAccessibleDescription("network down");
    expect(download).toHaveBeenCalledWith(expect.any(String), "Fonts");

    fireEvent.click(await screen.findByRole("button", { name: label }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: label })).toBeEnabled();
  });

  it("waits for the download status before offering a download", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(commands.getExtrasStatus).mockResolvedValue({
      status: "error",
      error: "unreadable",
    });
    renderConfig("interface");

    const button = await screen.findByRole("button", {
      name: `${en.config.font}: Download (0 MB)`,
    });
    expect(button).toBeDisabled();
    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "Failed to read download status:",
        "unreadable",
      ),
    );
  });
});
