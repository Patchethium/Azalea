import { type AvailableUpdate, commands } from "$binding";
import { AppToastRegion } from "@components/toast";
import { ConfigProvider, useConfigStore } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider } from "@contexts/meta";
import { UIProvider, useUIStore } from "@contexts/ui";
import { ConfigPage } from "@dialogs/config";
import { MultiProvider } from "@solid-primitives/context";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import userEvent from "@testing-library/user-event";
import { batch, type Component, onMount } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../i18n/en.json";
import { config } from "../../test/fixtures";

const update: AvailableUpdate = {
  version: "1.1.0",
  current_version: "1.0.0",
  installable: true,
  release_url: "https://github.com/Patchethium/Azalea/releases/tag/app-v1.1.0",
};

/** Opens the interface settings; the saved setting stays unknown, so nothing checks at startup. */
function renderConfig(overrides: Parameters<typeof config>[0] = {}) {
  let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
  const Harness: Component = () => {
    appConfig = useConfigStore()!;
    const ui = useUIStore()!;
    onMount(() => {
      batch(() => {
        appConfig.setConfig(config(overrides));
        ui.setUIStore("configSection", "interface");
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

describe("update settings", () => {
  beforeEach(() => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.spyOn(commands, "getAssetsSize").mockResolvedValue({
      status: "ok",
      data: 0,
    });
  });

  it("are hidden where updates are unsupported", async () => {
    renderConfig();
    await screen.findByText(en.config.lang);
    await Promise.resolve();
    expect(screen.queryByText(en.config.updates)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: en.config.auto_update_check }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.update.check_now }),
    ).not.toBeInTheDocument();
  });

  it("turn the startup check off and on, defaulting to on", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.mocked(commands.updatesSupported).mockResolvedValue(true);
    const appConfig = renderConfig();
    const toggle = await screen.findByRole("switch", {
      name: en.config.auto_update_check,
    });
    expect(screen.getByText(en.config.updates)).toBeInTheDocument();
    expect(appConfig().config.ui.auto_update_check).toBeUndefined();
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(appConfig().config.ui.auto_update_check).toBe(false);
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(appConfig().config.ui.auto_update_check).toBe(true);
  });

  it("show a saved, disabled startup check as off", async () => {
    vi.mocked(commands.updatesSupported).mockResolvedValue(true);
    renderConfig({ auto_update_check: false });
    expect(
      await screen.findByRole("switch", { name: en.config.auto_update_check }),
    ).not.toBeChecked();
  });

  it("check on demand and report that Azalea is current or that the check failed", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.mocked(commands.updatesSupported).mockResolvedValue(true);
    let finish!: (
      result: Awaited<ReturnType<typeof commands.checkForUpdate>>,
    ) => void;
    const check = vi.spyOn(commands, "checkForUpdate").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderConfig();

    await user.click(
      await screen.findByRole("button", { name: en.update.check_now }),
    );
    const checking = await screen.findByRole("button", {
      name: en.update.checking,
    });
    expect(checking).toBeDisabled();
    finish({ status: "ok", data: null });
    expect(await screen.findByText(en.update.up_to_date)).toBeInTheDocument();

    await user.click(
      await screen.findByRole("button", { name: en.update.check_now }),
    );
    finish({ status: "error", error: "offline" });
    expect(await screen.findByText(en.update.check_failed)).toBeInTheDocument();
    expect(screen.getByText("offline")).toBeInTheDocument();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("lead to the update that a check found", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.mocked(commands.updatesSupported).mockResolvedValue(true);
    const check = vi
      .spyOn(commands, "checkForUpdate")
      .mockResolvedValue({ status: "ok", data: update });
    const appConfig = renderConfig();

    await user.click(
      await screen.findByRole("button", { name: en.update.check_now }),
    );
    await waitFor(() =>
      expect(appConfig().updater.store.dialogOpen).toBe(true),
    );
    expect(screen.queryByText(en.update.up_to_date)).not.toBeInTheDocument();

    // The found update replaces the check button and reopens its prompt.
    appConfig().updater.dismiss();
    expect(appConfig().updater.store.dialogOpen).toBe(false);
    await user.click(
      screen.getByRole("button", { name: "Azalea 1.1.0 is available" }),
    );
    expect(appConfig().updater.store.dialogOpen).toBe(true);
    expect(
      screen.queryByRole("button", { name: en.update.check_now }),
    ).not.toBeInTheDocument();
    expect(check).toHaveBeenCalledTimes(1);
  });
});
