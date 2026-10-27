import { ToolbarButton } from "@components/toolbarButton";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

describe("ToolbarButton", () => {
  it("uses its label as the accessible name and default tooltip", async () => {
    const onClick = vi.fn();
    render(() => (
      <ToolbarButton
        icon="i-lucide:folder-open"
        label="Choose folder"
        ariaPressed
        onClick={onClick}
      />
    ));

    const button = screen.getByRole("button", { name: "Choose folder" });
    expect(button).toHaveClass("size-8", "enabled:hover:bg-slate-1");
    expect(button.className).not.toContain("aria-pressed:");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button.firstElementChild).toHaveAttribute("aria-hidden", "true");
    fireEvent.focusIn(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Choose folder",
    );
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows a custom tooltip and ignores clicks while disabled", async () => {
    const onClick = vi.fn();
    render(() => (
      <ToolbarButton
        icon="i-lucide:loader-circle"
        label="Loading"
        tooltip={<span>Still loading</span>}
        ariaBusy
        disabled
        onClick={onClick}
      />
    ));

    const button = screen.getByRole("button", { name: "Loading" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.pointerEnter(button.parentElement!, { pointerType: "mouse" });
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Still loading",
    );
  });

  it("highlights the pressed state on request", () => {
    render(() => (
      <ToolbarButton
        icon="i-lucide:audio-waveform"
        label="Draw on unvoiced frames"
        ariaPressed={false}
        highlightPressed
      />
    ));
    const button = screen.getByRole("button", {
      name: "Draw on unvoiced frames",
    });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button.className).toContain("aria-pressed:(bg-primary-1");
  });
});
