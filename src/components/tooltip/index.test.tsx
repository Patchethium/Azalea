import { Tooltip } from "@components/tooltip";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

describe("Tooltip", () => {
  it("only opens for overflowing text when requested", async () => {
    vi.useFakeTimers();
    render(() => (
      <Tooltip content="Full name" onlyWhenOverflowing>
        <button type="button">
          <span class="truncate">Visible name</span>
        </button>
      </Tooltip>
    ));

    const button = screen.getByRole("button");
    const name = screen.getByText("Visible name");
    Object.defineProperties(name, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 100 },
    });
    fireEvent.pointerEnter(button.parentElement!, { pointerType: "mouse" });
    await vi.advanceTimersByTimeAsync(400);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.pointerLeave(button.parentElement!, { pointerType: "mouse" });
    Object.defineProperty(name, "scrollWidth", {
      configurable: true,
      value: 101,
    });
    fireEvent.pointerEnter(button.parentElement!, { pointerType: "mouse" });
    await vi.advanceTimersByTimeAsync(400);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Full name");
  });
});
