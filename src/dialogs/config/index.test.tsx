import { commands } from "$binding";
import { ConfigPage } from "@dialogs/config";
import { AssetCacheSetting } from "@dialogs/config/AssetCacheSetting";
import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { batch, type Component, createSignal, onMount } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, useConfigStore } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider, useMetaStore } from "@contexts/meta";
import { UIProvider, useUIStore } from "@contexts/ui";
import { config } from "../../test/fixtures";

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
          appConfig.setConfig(
            config({
              buffer_render: false,
              nonblocking_synthesis: true,
            }),
          );
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
    expect(
      screen.getAllByRole("button", { name: "Experimental Features" }),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("switch", { name: "Non-blocking synthesis" }),
    ).not.toBeInTheDocument();
    expect(appConfig.config.ui.nonblocking_synthesis).toBe(true);

    const buffering = screen.getByRole("switch", {
      name: "Background Buffering for Audio Generation",
    });
    expect(buffering).not.toBeChecked();
    fireEvent.click(buffering);
    expect(appConfig.config.ui.buffer_render).toBe(true);
    expect(
      screen.getAllByRole("button", { name: "Experimental Features" }),
    ).toHaveLength(3);

    const nonblocking = screen.getByRole("switch", {
      name: "Non-blocking synthesis",
    });
    expect(nonblocking).toBeChecked();
    expect(appConfig.config.ui.nonblocking_synthesis).toBe(true);

    const delay = await screen.findByRole("spinbutton", {
      name: "Synthesis request delay",
    });
    fireEvent.input(delay, { target: { value: "15000" } });
    fireEvent.change(delay, { target: { value: "15000" } });
    expect(appConfig.config.ui.synthesis_delay_ms).toBe(10_000);

    fireEvent.click(buffering);
    expect(appConfig.config.ui.buffer_render).toBe(false);
    expect(appConfig.config.ui.nonblocking_synthesis).toBe(true);
    expect(
      screen.queryByRole("switch", { name: "Non-blocking synthesis" }),
    ).not.toBeInTheDocument();

    fireEvent.click(buffering);
    expect(appConfig.config.ui.buffer_render).toBe(true);
    expect(
      screen.getByRole("switch", { name: "Non-blocking synthesis" }),
    ).toBeChecked();

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

  it("updates general appearance settings", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.spyOn(commands, "getAssetsSize").mockResolvedValue({
      status: "ok",
      data: 0,
    });
    let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
    const Harness: Component = () => {
      appConfig = useConfigStore()!;
      const ui = useUIStore()!;
      onMount(() => {
        batch(() => {
          appConfig.setConfig(config({ primary_color: "#808080" }));
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

    await user.click(await screen.findByRole("button", { name: /Theme/ }));
    await user.click(await screen.findByText("Dark"));
    expect(appConfig.themeMode()).toBe("Dark");

    const customTitlebar = screen.getByRole("switch", {
      name: "Custom title bar",
    });
    expect(customTitlebar).toBeChecked();
    await user.click(customTitlebar);
    expect(appConfig.customTitlebarEnabled()).toBe(false);

    const playbackTimeline = screen.getByRole("switch", {
      name: "Playback timeline",
    });
    expect(playbackTimeline).toBeChecked();
    await user.click(playbackTimeline);
    expect(appConfig.playbackTimelineEnabled()).toBe(false);

    await user.click(screen.getByRole("button", { name: "Primary color" }));
    await user.click(await screen.findByText("Normalize"));
    expect(appConfig.config.ui.primary_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(appConfig.config.ui.primary_color).not.toBe("#808080");

    const truncation = screen.getAllByRole("spinbutton")[0];
    fireEvent.input(truncation, { target: { value: "12" } });
    fireEvent.change(truncation, { target: { value: "12" } });
    expect(appConfig.config.ui.name_truncation_len).toBe(12);

    await user.click(screen.getByRole("button", { name: /Language/ }));
    await user.click(await screen.findByText(/日本語/));
    expect(appConfig.config.ui.locale).toBe("Ja");
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
    vi.spyOn(commands, "clearAssets").mockResolvedValue({
      status: "ok",
      data: null,
    });
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
    const clear = screen.getByRole("button", { name: "Clear cache" });
    expect(clear).toBeEnabled();
    fireEvent.click(clear);
    await waitFor(() =>
      expect(commands.getAssetsSize).toHaveBeenCalledTimes(2),
    );
    expect(
      screen.getByRole("alert", {
        name: "Could not read or clear the asset cache.",
      }),
    ).toBeInTheDocument();
  });

  it("ignores a successful cache clear after the page closes", async () => {
    type ClearResult = Awaited<ReturnType<typeof commands.clearAssets>>;
    let resolveClear!: (result: ClearResult) => void;
    vi.spyOn(commands, "getAssetsSize").mockResolvedValue({
      status: "ok",
      data: -1,
    });
    vi.spyOn(commands, "clearAssets").mockReturnValue(
      new Promise((resolve) => {
        resolveClear = resolve;
      }),
    );
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

    expect(await screen.findByText("—")).toBeInTheDocument();
    const clear = screen.getByRole("button", { name: "Clear cache" });
    fireEvent.click(clear);
    await waitFor(() => expect(commands.clearAssets).toHaveBeenCalledOnce());
    expect(clear).toHaveTextContent("Clearing…");
    expect(clear).toHaveAttribute("aria-busy", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close config" }));
    resolveClear({ status: "ok", data: null });
    await waitFor(() => expect(meta.clearSpeakerIcons).toHaveBeenCalledOnce());
    expect(commands.getAssetsSize).toHaveBeenCalledOnce();
  });

  it("recovers accessibly when cache commands throw", async () => {
    vi.spyOn(commands, "getAssetsSize").mockRejectedValue(
      new Error("read failed"),
    );
    vi.spyOn(commands, "clearAssets")
      .mockResolvedValueOnce({ status: "error", error: "clear failed" })
      .mockRejectedValueOnce(new Error("clear threw"));
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

    await screen.findByRole("alert", {
      name: "Could not read or clear the asset cache.",
    });
    const clear = screen.getByRole("button", { name: "Clear cache" });
    fireEvent.click(clear);
    await waitFor(() => expect(commands.clearAssets).toHaveBeenCalledOnce());
    await screen.findByRole("alert", {
      name: "Could not read or clear the asset cache.",
    });
    fireEvent.click(clear);
    await waitFor(() => expect(commands.clearAssets).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("alert", {
        name: "Could not read or clear the asset cache.",
      }),
    ).toBeInTheDocument();
  });

  it("ignores cache reads that settle after the setting closes", async () => {
    type SizeResult = Awaited<ReturnType<typeof commands.getAssetsSize>>;
    let resolveSize!: (result: SizeResult) => void;
    let rejectSize!: (error: Error) => void;
    vi.spyOn(commands, "getAssetsSize")
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSize = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectSize = reject;
        }),
      );

    const renderSetting = () => {
      const [open, setOpen] = createSignal(true);
      const result = render(() => (
        <MultiProvider
          values={[
            [MetaProvider, []],
            [UIProvider, null],
            [ConfigProvider, null],
            [i18nProvider, null],
          ]}
        >
          <AssetCacheSetting open={open()} />
        </MultiProvider>
      ));
      return { ...result, setOpen };
    };

    const first = renderSetting();
    await waitFor(() => expect(commands.getAssetsSize).toHaveBeenCalledOnce());
    first.setOpen(false);
    resolveSize({ status: "ok", data: 10 });
    await Promise.resolve();
    expect(screen.queryByText("10 B")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    first.unmount();

    const second = renderSetting();
    await waitFor(() =>
      expect(commands.getAssetsSize).toHaveBeenCalledTimes(2),
    );
    second.setOpen(false);
    rejectSize(new Error("late failure"));
    await Promise.resolve();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    second.unmount();
  });

  it("edits CPU threads and reinitializes the core on demand", async () => {
    vi.spyOn(commands, "getAssetsSize").mockResolvedValue({
      status: "ok",
      data: 0,
    });
    vi.spyOn(commands, "initCore").mockResolvedValue({
      status: "ok",
      data: null,
    });
    vi.spyOn(commands, "getRange").mockResolvedValue({
      status: "ok",
      data: { 1: [4, 6] },
    });
    vi.spyOn(commands, "getMetas").mockResolvedValue({
      status: "ok",
      data: [],
    });
    const reinit = vi
      .spyOn(commands, "reinitCore")
      .mockResolvedValue({ status: "ok", data: null });
    let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
    const Harness: Component = () => {
      appConfig = useConfigStore()!;
      const ui = useUIStore()!;
      onMount(() => {
        batch(() => {
          appConfig.setConfig(config());
          appConfig.setConfig("core", {
            ort_path: "/core",
            ojt_dir: "/dict",
            vvm_dir: "/models",
            cache_size: 128,
            cpu_num_threads: 4,
          });
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

    const threads = await screen.findByRole("spinbutton", {
      name: "CPU threads",
    });
    const reinitButton = screen.getByRole("button", {
      name: "Reinitialize core",
    });
    expect(reinitButton).toBeDisabled();

    fireEvent.input(threads, { target: { value: "8" } });
    fireEvent.change(threads, { target: { value: "8" } });
    expect(appConfig.config.core?.cpu_num_threads).toBe(8);
    expect(reinitButton).toBeEnabled();

    fireEvent.click(reinitButton);
    await waitFor(() => expect(reinit).toHaveBeenCalledOnce());
    expect(reinit).toHaveBeenCalledWith({
      ort_path: "/core",
      ojt_dir: "/dict",
      vvm_dir: "/models",
      cache_size: 128,
      cpu_num_threads: 8,
    });
    await waitFor(() => expect(reinitButton).toBeDisabled());
  });

  it("ignores invalid CPU thread input and shows a failed reinitialization", async () => {
    vi.spyOn(commands, "getAssetsSize").mockResolvedValue({
      status: "ok",
      data: 0,
    });
    vi.spyOn(commands, "initCore").mockResolvedValue({
      status: "ok",
      data: null,
    });
    vi.spyOn(commands, "getRange").mockResolvedValue({
      status: "ok",
      data: {},
    });
    vi.spyOn(commands, "getMetas").mockResolvedValue({
      status: "ok",
      data: [],
    });
    const reinit = vi
      .spyOn(commands, "reinitCore")
      .mockResolvedValue({ status: "error", error: "reinit failed" });
    let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
    const Harness: Component = () => {
      appConfig = useConfigStore()!;
      const ui = useUIStore()!;
      onMount(() => {
        batch(() => {
          appConfig.setConfig(config());
          appConfig.setConfig("core", {
            ort_path: "/core",
            ojt_dir: "/dict",
            vvm_dir: "/models",
            cache_size: 128,
            cpu_num_threads: 4,
          });
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

    const threads = await screen.findByRole("spinbutton", {
      name: "CPU threads",
    });
    fireEvent.input(threads, { target: { value: "" } });
    fireEvent.change(threads, { target: { value: "" } });
    expect(appConfig.config.core?.cpu_num_threads).toBe(4);

    const reinitButton = screen.getByRole("button", {
      name: "Reinitialize core",
    });
    expect(reinitButton).toBeDisabled();

    fireEvent.input(threads, { target: { value: "8" } });
    fireEvent.change(threads, { target: { value: "8" } });
    expect(appConfig.config.core?.cpu_num_threads).toBe(8);
    expect(reinitButton).toBeEnabled();

    fireEvent.click(reinitButton);
    await waitFor(() => expect(reinit).toHaveBeenCalledOnce());
    await waitFor(() => expect(reinitButton).toBeEnabled());
    expect(reinit).toHaveBeenCalledWith({
      ort_path: "/core",
      ojt_dir: "/dict",
      vvm_dir: "/models",
      cache_size: 128,
      cpu_num_threads: 8,
    });

    fireEvent.input(threads, { target: { value: "9" } });
    fireEvent.change(threads, { target: { value: "9" } });
    expect(appConfig.config.core?.cpu_num_threads).toBe(9);
    expect(reinitButton).toBeEnabled();
  });

  it("disables reinitialization and ignores edits without a core config", async () => {
    vi.spyOn(commands, "getAssetsSize").mockResolvedValue({
      status: "ok",
      data: 0,
    });
    let appConfig!: NonNullable<ReturnType<typeof useConfigStore>>;
    const Harness: Component = () => {
      appConfig = useConfigStore()!;
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

    const threads = await screen.findByRole("spinbutton", {
      name: "CPU threads",
    });
    fireEvent.input(threads, { target: { value: "8" } });
    fireEvent.change(threads, { target: { value: "8" } });
    expect(appConfig.config.core).toBeNull();

    const reinitButton = screen.getByRole("button", {
      name: "Reinitialize core",
    });
    expect(reinitButton).toBeDisabled();
  });
});
