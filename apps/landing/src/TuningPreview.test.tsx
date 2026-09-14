import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TuningPreview } from "./TuningPreview";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(280);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 1000,
    height: 280,
    top: 0,
    left: 0,
    bottom: 280,
    right: 1000,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("copied tuning panel", () => {
  it("edits pitch with the actual Kobalte slider and resets the sample", async () => {
    render(() => <TuningPreview />);
    const pitch = (
      await screen.findAllByRole("slider", { name: "ア pitch" })
    )[0];
    expect(pitch).toHaveAttribute("aria-valuenow", "5.2");
    fireEvent.keyDown(pitch, { key: "ArrowUp" });
    await waitFor(() => expect(pitch).toHaveAttribute("aria-valuenow", "5.21"));
    fireEvent.click(screen.getByRole("button", { name: "Reset tuning" }));
    await waitFor(() => expect(pitch).toHaveAttribute("aria-valuenow", "5.2"));
  });

  it("resizes phonemes by dragging and ends the drag on leaving the timeline", async () => {
    const { container } = render(() => <TuningPreview />);
    const vowel = (
      await screen.findAllByRole("spinbutton", { name: "ア vowel duration" })
    )[0];
    const timeline = container.querySelector("[data-tuning-virtualizer]")!;
    fireEvent.mouseDown(vowel, { clientX: 100 });
    fireEvent.mouseMove(timeline, { clientX: 136 });
    await waitFor(() => expect(vowel).toHaveAttribute("aria-valuenow", "0.2"));
    fireEvent.mouseLeave(timeline);
    fireEvent.mouseMove(timeline, { clientX: 200 });
    expect(vowel).toHaveAttribute("aria-valuenow", "0.2");
    fireEvent.click(screen.getByRole("button", { name: "Reset tuning" }));
    expect(vowel).toHaveAttribute("aria-valuenow", "0.1");
  });

  it("keeps duration controls keyboard accessible and clamps at the minimum", async () => {
    render(() => <TuningPreview />);
    const vowel = (
      await screen.findAllByRole("spinbutton", { name: "ア vowel duration" })
    )[0];
    expect(vowel).toHaveAttribute("tabindex", "0");
    for (let i = 0; i < 20; i++) fireEvent.keyDown(vowel, { key: "ArrowLeft" });
    expect(vowel).toHaveAttribute("aria-valuenow", "0.01");
    fireEvent.keyDown(vowel, { key: "ArrowRight" });
    expect(vowel).toHaveAttribute("aria-valuenow", "0.02");
  });

  it("zooms the duration timeline without changing pitch and resets zoom", async () => {
    const { container } = render(() => <TuningPreview />);
    const zoom = await screen.findByRole("slider", { name: "Timeline zoom" });
    const pitch = screen.getAllByRole("slider", { name: "ア pitch" })[0];
    const scroller = container.querySelector("[data-bottom-panel-scroll]")!;
    fireEvent.wheel(scroller, { ctrlKey: true, deltaY: -1 });
    await waitFor(() => expect(zoom).toHaveAttribute("aria-valuenow", "410"));
    expect(pitch).toHaveAttribute("aria-valuenow", "5.2");
    fireEvent.click(screen.getByRole("button", { name: "Reset tuning" }));
    expect(zoom).toHaveAttribute("aria-valuenow", "360");
  });
});
