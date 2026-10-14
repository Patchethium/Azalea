import { PathButton } from "@components/pathButton";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

describe("PathButton", () => {
  it("shows the shortened path and names the button with the full path", async () => {
    const onClick = vi.fn();
    render(() => (
      <PathButton
        path="/home/me/exports"
        display="…/me/exports"
        onClick={onClick}
      />
    ));

    const button = screen.getByRole("button", { name: "/home/me/exports" });
    expect(button).toHaveClass("flex", "text-xs");
    expect(button).not.toHaveClass("grid");
    expect(button.querySelector('[aria-hidden="true"]')).toHaveTextContent(
      "…/me/exports",
    );
    fireEvent.focusIn(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "/home/me/exports",
    );
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("puts an optional label in a column before the full path", () => {
    render(() => (
      <PathButton path="/opt/vv/models" label="Models" onClick={() => {}} />
    ));

    const button = screen.getByRole("button", {
      name: "Models /opt/vv/models",
    });
    expect(button).toHaveClass("grid");
    expect(button.querySelector('[aria-hidden="true"]')).toHaveTextContent(
      "/opt/vv/models",
    );
  });
});
