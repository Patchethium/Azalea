import { IconButton } from "@components/iconButton";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

describe("IconButton", () => {
  it("uses its tooltip label as its accessible name", async () => {
    const onClick = vi.fn();
    render(() => (
      <IconButton icon="i-lucide:plus" label="Add item" onClick={onClick} />
    ));

    const button = screen.getByRole("button", { name: "Add item" });
    fireEvent.focusIn(button);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Add item");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps disabled destructive controls explainable on hover", async () => {
    render(() => (
      <IconButton
        icon="i-lucide:trash2"
        label="Delete item"
        tone="danger"
        disabled
      />
    ));

    const button = screen.getByRole("button", { name: "Delete item" });
    const icon = button.firstElementChild;
    expect(button).toBeDisabled();
    expect(button).toHaveClass("items-center", "justify-center");
    expect(button).toHaveClass("focus-visible:ring-red-3");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveClass("group-hover:bg-red-5");
    expect(icon).toHaveClass("group-active:bg-red-6");

    fireEvent.pointerEnter(button.parentElement!, { pointerType: "mouse" });
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Delete item");
  });
});
