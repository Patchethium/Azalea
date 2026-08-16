import { events } from "$binding";
import { MultiProvider } from "@solid-primitives/context";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { ConfigProvider } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider } from "@contexts/meta";
import { SpectrogramProvider } from "@contexts/spectrogram";
import { SystemProvider } from "@contexts/system";
import { TextProvider, useTextStore } from "@contexts/text";
import { UIProvider } from "@contexts/ui";
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
  it("restores the saved system title bar preference", async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    mockIPC(
      (command, payload) => {
        calls.push({ command, payload });
        if (command.includes("theme")) return "light";
        return null;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");

    renderApp();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    await events.initializationEvent.emit({
      config: config({ custom_titlebar: false }),
      core_initialized: false,
      metas: null,
      range: [],
      error: null,
    });

    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "plugin:window|set_decorations",
        payload: { label: "main", value: true },
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Close" }),
      ).not.toBeInTheDocument(),
    );
  });

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

  it("keeps the sidebar width fixed when the window is resized", async () => {
    mockIPC((cmd) => (cmd.includes("theme") ? "light" : null), {
      shouldMockEvents: true,
    });
    mockWindows("main");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const result = renderApp();
    await events.initializationEvent.emit({
      config: config({ side_width: 240 }),
      core_initialized: true,
      metas,
      range: [],
      error: null,
    });

    const handles = await screen.findAllByRole("separator", {
      name: "Resize Handle",
    });
    const handle = handles.find(
      (element) => element.getAttribute("aria-orientation") === "horizontal",
    )!;
    const sidebar = handle.previousElementSibling as HTMLElement;
    const originalWindowWidth = window.innerWidth;
    const initialBasis = Number.parseFloat(sidebar.style.flexBasis);

    try {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWindowWidth * 2,
      });
      window.dispatchEvent(new Event("resize"));

      await waitFor(() =>
        expect(Number.parseFloat(sidebar.style.flexBasis)).toBeCloseTo(
          initialBasis / 2,
        ),
      );
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWindowWidth,
      });
    }

    result.unmount();
    expect(removeEventListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
    );
  });

  it("collapses and re-expands the sidebar and bottom panel by dragging", async () => {
    mockIPC((cmd) => (cmd.includes("theme") ? "light" : null), {
      shouldMockEvents: true,
    });
    mockWindows("main");
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.hasAttribute("data-corvu-resizable-root")
          ? window.innerWidth
          : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.hasAttribute("data-corvu-resizable-root") &&
          this.className === "size-full"
          ? 1_000
          : 0;
      },
    );
    renderApp();
    await events.initializationEvent.emit({
      config: config({ side_width: 240 }),
      core_initialized: true,
      metas,
      range: [],
      error: null,
    });

    const handles = await screen.findAllByRole("separator", {
      name: "Resize Handle",
    });
    const sidebarHandle = handles.find(
      (element) => element.getAttribute("aria-orientation") === "horizontal",
    )!;
    const bottomHandle = handles.find(
      (element) => element.getAttribute("aria-orientation") === "vertical",
    )!;
    const sidebar = sidebarHandle.previousElementSibling as HTMLElement;
    const bottomPanel = bottomHandle.nextElementSibling as HTMLElement;
    const drag = (
      handle: HTMLElement,
      from: { clientX: number; clientY: number },
      to: { clientX: number; clientY: number },
    ) => {
      handle.setPointerCapture = vi.fn();
      handle.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, ...from }),
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, ...to }),
      );
      window.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, ...to }),
      );
    };

    drag(
      sidebarHandle,
      { clientX: 240, clientY: 0 },
      { clientX: 0, clientY: 0 },
    );
    expect(sidebar).toHaveAttribute("data-collapsed");
    expect(sidebarHandle).toBeInTheDocument();
    drag(
      sidebarHandle,
      { clientX: 0, clientY: 0 },
      { clientX: 200, clientY: 0 },
    );
    expect(sidebar).not.toHaveAttribute("data-collapsed");

    drag(
      bottomHandle,
      { clientX: 0, clientY: 700 },
      { clientX: 0, clientY: 1_000 },
    );
    expect(bottomPanel).toHaveAttribute("data-collapsed");
    expect(bottomHandle).toBeInTheDocument();
    drag(
      bottomHandle,
      { clientX: 0, clientY: 1_000 },
      { clientX: 0, clientY: 800 },
    );
    expect(bottomPanel).not.toHaveAttribute("data-collapsed");
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
