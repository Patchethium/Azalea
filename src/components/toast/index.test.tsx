import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { AppToastRegion, errorDetail, useToasts } from "@components/toast";
import { ConfigProvider } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider } from "@contexts/meta";
import { UIProvider } from "@contexts/ui";

const renderToasts = () => {
  let toasts!: ReturnType<typeof useToasts>;
  const Harness = () => {
    toasts = useToasts();
    return <AppToastRegion />;
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
  return toasts;
};

describe("toasts", () => {
  it("shows an error with its detail and replaces a repeated message", async () => {
    const toasts = renderToasts();
    toasts.error("Couldn't save the project", "disk full");

    const toast = await screen.findByRole("status", {
      name: "Couldn't save the project",
    });
    expect(toast).toHaveClass("border-danger-border");
    expect(toast).toHaveAccessibleDescription("disk full");
    expect(toast.querySelector(".i-lucide\\:circle-x")).not.toBeNull();
    const progressTrack = toast.querySelector('[role="presentation"]');
    expect(progressTrack).toHaveClass("bg-danger-soft");
    expect(progressTrack?.firstElementChild).toHaveClass("bg-danger");

    toasts.error("Couldn't save the project", new Error("read-only"));
    await waitFor(() => expect(toast).not.toBeInTheDocument());
    const replacement = screen.getByRole("status", {
      name: "Couldn't save the project",
    });
    expect(replacement).toHaveAccessibleDescription("read-only");

    fireEvent.click(screen.getByRole("button", { name: "Close notification" }));
    expect(replacement).toHaveAttribute("data-closed");
  });

  it("shows warnings with optional details and successes without one", async () => {
    const toasts = renderToasts();
    toasts.warning("Check the file name", "permission denied");
    toasts.success("Saved");

    const warning = await screen.findByRole("status", {
      name: "Check the file name",
    });
    expect(warning).toHaveClass("border-warning-border");
    expect(warning).toHaveAccessibleDescription("permission denied");
    const success = await screen.findByRole("status", { name: "Saved" });
    expect(success).not.toHaveClass("border");
    expect(success).not.toHaveAccessibleDescription();
  });

  it("keeps progress toasts open until they are dismissed", async () => {
    const toasts = renderToasts();
    const dismiss = toasts.progress("Exporting…");

    const toast = await screen.findByRole("status", { name: "Exporting…" });
    expect(toast.querySelector(".animate-spin")).not.toBeNull();
    dismiss();
    await waitFor(() => expect(toast).not.toBeInTheDocument());

    const replaced = toasts.progress("Exporting…");
    const dismissStale = toasts.progress("Exporting…");
    replaced();
    expect(
      await screen.findByRole("status", { name: "Exporting…" }),
    ).toBeInTheDocument();
    dismissStale();
  });

  it("formats thrown values as readable detail text", () => {
    expect(errorDetail(new Error("boom"))).toBe("boom");
    expect(errorDetail("plain")).toBe("plain");
    expect(errorDetail({ code: 2 })).toBe('{"code":2}');
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(errorDetail(cyclic)).toBe("[object Object]");
    expect(errorDetail(undefined)).toBe("undefined");
  });
});
