import { NumberInput } from "@components/numberField";
import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { ConfigProvider } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider } from "@contexts/meta";
import { UIProvider } from "@contexts/ui";

const renderInput = (props: Parameters<typeof NumberInput>[0]) =>
  render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, null],
        [i18nProvider, null],
      ]}
    >
      <NumberInput {...props} />
    </MultiProvider>
  ));

describe("NumberInput", () => {
  it("clamps typed values and supports decimal steps", () => {
    const setValue = vi.fn();
    renderInput({
      label: "Sigma",
      value: 0.05,
      setValue,
      min: 0,
      max: 0.5,
      step: 0.01,
      decimal: true,
    });

    const input = screen.getByRole("spinbutton", { name: "Sigma" });
    fireEvent.input(input, { target: { value: "0.3" } });
    expect(setValue).toHaveBeenLastCalledWith(0.3);
    fireEvent.input(input, { target: { value: "2" } });
    expect(setValue).toHaveBeenLastCalledWith(0.5);
    fireEvent.input(input, { target: { value: "-1" } });
    expect(setValue).toHaveBeenLastCalledWith(0);
  });

  it("steps within range from the increment and decrement buttons", () => {
    const setValue = vi.fn();
    renderInput({
      label: "Priority",
      value: 3,
      setValue,
      min: 0,
      max: 10,
      step: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: "Increase Priority" }));
    expect(setValue).toHaveBeenLastCalledWith(4);
    fireEvent.click(screen.getByRole("button", { name: "Decrease Priority" }));
    expect(setValue).toHaveBeenLastCalledWith(2);
  });

  it("keeps hidden labels accessible and reflects the disabled state", () => {
    renderInput({
      label: "Noise strength (sigma)",
      value: 0.05,
      setValue: vi.fn(),
      min: 0,
      max: 0.5,
      step: 0.01,
      hideLabel: true,
      disabled: true,
    });

    const input = screen.getByRole("spinbutton", {
      name: "Noise strength (sigma)",
    });
    expect(input).toBeDisabled();
    expect(
      screen.getByText("Noise strength (sigma)").parentElement,
    ).toHaveClass("sr-only");
  });
});
