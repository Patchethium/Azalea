import { TitleBar } from "@components/titleBar";
import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vitest";
import { ConfigProvider } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider } from "@contexts/meta";
import { UIProvider } from "@contexts/ui";

const renderTitleBar = () =>
  render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, null],
        [i18nProvider, null],
      ]}
    >
      <TitleBar />
    </MultiProvider>
  ));

describe("TitleBar", () => {
  it("exposes a drag region and invokes all window controls", async () => {
    const calls: string[] = [];
    mockIPC((command) => {
      calls.push(command);
      return null;
    });
    mockWindows("main");

    const { container } = renderTitleBar();

    expect(container.querySelector("[data-tauri-drag-region]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Maximize or restore" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(calls).toEqual(
        expect.arrayContaining([
          "plugin:window|minimize",
          "plugin:window|toggle_maximize",
          "plugin:window|close",
        ]),
      ),
    );
  });

  it("reports failed window actions", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockIPC((command) => {
      if (command === "plugin:window|minimize") {
        return Promise.reject(new Error("denied"));
      }
      return null;
    });
    mockWindows("main");
    renderTitleBar();

    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "Failed to minimize the window:",
        expect.any(Error),
      ),
    );
  });
});
