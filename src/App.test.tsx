import { events } from "@binding";
import { MultiProvider } from "@solid-primitives/context";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { ConfigProvider } from "./contexts/config";
import { i18nProvider } from "./contexts/i18n";
import { MetaProvider } from "./contexts/meta";
import { SpectrogramProvider } from "./contexts/spectrogram";
import { SystemProvider } from "./contexts/system";
import { TextProvider, useTextStore } from "./contexts/text";
import { UIProvider } from "./contexts/ui";
import { config, metas } from "./test/fixtures";

const renderApp = () => {
  let text!: NonNullable<ReturnType<typeof useTextStore>>;
  const Harness = () => {
    text = useTextStore()!;
    return <App />;
  };
  const result = render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [SpectrogramProvider, null],
        [ConfigProvider, null],
        [SystemProvider, null],
        [i18nProvider, null],
        [TextProvider, null],
      ]}
    >
      <Harness />
    </MultiProvider>
  ));
  return { ...result, getTextStore: () => text };
};

describe("App initialization", () => {
  it("leaves loading for core selection and applies validated appearance settings", async () => {
    const calls: string[] = [];
    mockIPC(
      (cmd) => {
        calls.push(cmd);
        if (cmd.includes("theme")) return "light";
        return null;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");

    renderApp();
    expect(screen.getByText("Loading")).toBeInTheDocument();
    await Promise.resolve();
    await Promise.resolve();

    await events.initializationEvent.emit({
      config: config({
        theme_mode: "Dark",
        primary_color: "not-a-color",
      }),
      core_initialized: false,
      metas: null,
      range: [],
      error: null,
    });

    expect(
      await screen.findByText(
        "Welcome to Azalea, an unofficial GUI for VOICEVOX",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(
      document.documentElement.style.getPropertyValue("--primary-color"),
    ).toBe("#3b82f6");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    screen.getByRole("button", { name: "Pick it" }).click();
    await waitFor(() => expect(warn).toHaveBeenCalledOnce());
  });

  it("still completes initialization when the backend reports an error", async () => {
    const calls: string[] = [];
    mockIPC(
      (cmd) => {
        calls.push(cmd);
        return cmd === "get_os" ? "Linux" : null;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    renderApp();
    await events.initializationEvent.emit({
      config: null,
      core_initialized: false,
      metas: null,
      range: [],
      error: "core failed",
    });

    expect(
      await screen.findByRole("button", { name: "Pick it" }),
    ).toBeEnabled();
    expect(screen.queryByText("Loading")).not.toBeInTheDocument();

    screen.getByRole("radio", { name: "I'll figure it out" }).click();
    screen.getByRole("button", { name: "Okay" }).click();
    expect(calls).toContain("quit");
  });

  it("initializes a selected core and opens the editor", async () => {
    mockIPC(
      (cmd) => {
        switch (cmd) {
          case "get_os":
            return "Linux";
          case "pick_core":
            return {
              ort_path: "/test/runtime",
              ojt_dir: "/test/dictionary",
              vvm_dir: "/test/models",
              cache_size: 4,
            };
          case "init_core":
          case "set_config":
            return null;
          case "get_range":
            return { 1: [4, 6] };
          case "get_metas":
            return [
              {
                name: "Test Speaker",
                styles: [{ id: 1, name: "Normal", type: "talk", order: 0 }],
                version: "1.0.0",
                speaker_uuid: "speaker-1",
                order: 0,
              },
            ];
          default:
            return null;
        }
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    const { getTextStore } = renderApp();
    await Promise.resolve();
    await events.initializationEvent.emit({
      config: config(),
      core_initialized: false,
      metas: null,
      range: [],
      error: null,
    });

    const pickCore = await screen.findByRole("button", { name: "Pick it" });
    pickCore.click();

    expect(
      await screen.findByLabelText(
        "Text to synthesize",
        {},
        { timeout: 3_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Accent" })).toBeInTheDocument();

    getTextStore().setTextStore([]);
    const create = await screen.findByRole("button", {
      name: "Create text cell",
    });
    create.click();
    expect(getTextStore().textStore).toHaveLength(1);
  });

  it("tracks system theme changes and removes the listener on cleanup", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      ...window.matchMedia(""),
      matches: true,
    });
    mockIPC((cmd) => (cmd.includes("theme") ? "light" : null), {
      shouldMockEvents: true,
    });
    mockWindows("main");
    const result = renderApp();
    await events.initializationEvent.emit({
      config: config({ theme_mode: "System" }),
      core_initialized: false,
      metas,
      range: [],
      error: null,
    });
    await screen.findByRole("button", { name: "Pick it" });

    await emit("tauri://theme-changed", "dark");
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));

    result.unmount();
    document.documentElement.classList.remove("dark");
    await emit("tauri://theme-changed", "dark");
    expect(document.documentElement).not.toHaveClass("dark");
  });
});
