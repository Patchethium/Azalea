import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { batch, type Component, onMount } from "solid-js";
import { describe, expect, it } from "vitest";
import { ConfigProvider, useConfigStore } from "../contexts/config";
import { i18nProvider } from "../contexts/i18n";
import { MetaProvider } from "../contexts/meta";
import { UIProvider, useUIStore } from "../contexts/ui";
import { config } from "../test/fixtures";
import { ConfigPage } from "./ConfigPage";

describe("ConfigPage", () => {
  it("updates synthesis feature settings and closes accessibly", async () => {
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
});
