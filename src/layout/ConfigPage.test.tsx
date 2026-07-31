import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { batch, type Component, onMount } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "../binding";
import { ConfigProvider, useConfigStore } from "../contexts/config";
import { i18nProvider } from "../contexts/i18n";
import { MetaProvider, useMetaStore } from "../contexts/meta";
import { UIProvider, useUIStore } from "../contexts/ui";
import { config } from "../test/fixtures";
import { ConfigPage } from "./ConfigPage";

describe("ConfigPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates synthesis feature settings and closes accessibly", async () => {
    vi.spyOn(commands, "getAssetsSize").mockResolvedValue({
      status: "ok",
      data: 0,
    });
    vi.spyOn(commands, "clearAssets");
    let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
    let ui!: NonNullable<ReturnType<typeof useUIStore>>;
    const Harness: Component = () => {
      appConfig = useConfigStore()!;
      ui = useUIStore()!;
      onMount(() => {
        batch(() => {
          appConfig.setConfig(config({ buffer_render: false }));
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
      </MultiProvider>
    ));

    expect(
      await screen.findByRole("dialog", { name: "Config" }),
    ).toBeInTheDocument();
    const buffering = screen.getByRole("switch", {
      name: "Background Buffering for Audio Generation",
    });
    expect(buffering).not.toBeChecked();
    fireEvent.click(buffering);
    expect(appConfig.config.ui_config.buffer_render).toBe(true);

    const delay = await screen.findByRole("spinbutton", {
      name: "Synthesis request delay",
    });
    fireEvent.input(delay, { target: { value: "15000" } });
    fireEvent.change(delay, { target: { value: "15000" } });
    expect(appConfig.config.ui_config.synthesis_delay_ms).toBe(10_000);

    const preview = screen.getByRole("switch", {
      name: "Spectrogram Preview",
    });
    expect(preview).toBeChecked();
    fireEvent.click(preview);
    expect(appConfig.spectrogramPreviewEnabled()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Close config" }));
    await waitFor(() => expect(ui.uiStore.page).toBeNull());
    expect(screen.getByRole("dialog", { name: "Config" })).toHaveAttribute(
      "data-closed",
    );
  });

  it("shows the saved asset size and refreshes it after clearing", async () => {
    vi.spyOn(commands, "getAssetsSize")
      .mockResolvedValueOnce({ status: "ok", data: 2048 })
      .mockResolvedValueOnce({ status: "ok", data: 0 });
    vi.spyOn(commands, "clearAssets").mockResolvedValue({
      status: "ok",
      data: null,
    });
    let meta!: NonNullable<ReturnType<typeof useMetaStore>>;
    const Harness: Component = () => {
      const appConfig = useConfigStore()!;
      const ui = useUIStore()!;
      meta = useMetaStore()!;
      vi.spyOn(meta, "clearSpeakerIcons");
      onMount(() => {
        batch(() => {
          appConfig.setConfig(config());
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
      </MultiProvider>
    ));

    expect(await screen.findByText("2 KB")).toBeInTheDocument();
    const clear = screen.getByRole("button", { name: "Clear cache" });
    expect(clear).toBeEnabled();
    fireEvent.click(clear);

    expect(commands.clearAssets).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText("0 B")).toBeInTheDocument());
    expect(meta.clearSpeakerIcons).toHaveBeenCalledOnce();
    expect(commands.getAssetsSize).toHaveBeenCalledTimes(2);
    expect(clear).toBeDisabled();
  });

  it("shows an accessible error when the asset size cannot be read", async () => {
    vi.spyOn(commands, "getAssetsSize").mockResolvedValue({
      status: "error",
      error: "unavailable",
    });
    vi.spyOn(commands, "clearAssets");
    const Harness: Component = () => {
      const appConfig = useConfigStore()!;
      const ui = useUIStore()!;
      onMount(() => {
        batch(() => {
          appConfig.setConfig(config());
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
      </MultiProvider>
    ));

    expect(
      await screen.findByRole("alert", {
        name: "Could not read or clear the asset cache.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear cache" })).toBeEnabled();
  });
});
