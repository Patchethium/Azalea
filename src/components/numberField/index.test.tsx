import { NumberInput } from "@components/numberField";
import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
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
  it.each(["0.03", "0.10", "0.15"])(
    "preserves decimal text while typing %s character by character",
    async (text) => {
      const [value, setValue] = createSignal(0.05);
      renderInput({
        label: "Sigma",
        get value() {
          return value();
        },
        setValue,
        min: 0,
        max: 0.15,
        step: 0.01,
        decimal: true,
      });

      const input = screen.getByRole("spinbutton", { name: "Sigma" });
      await userEvent.clear(input);
      for (let index = 0; index < text.length; index++) {
        await userEvent.keyboard(text[index]);
        const partial = text.slice(0, index + 1);
        expect(input).toHaveValue(partial);
        expect(value()).toBe(Number(partial));
      }
      await userEvent.tab();
      expect(input).toHaveValue(String(Number(text)));
      expect(value()).toBe(Number(text));
    },
  );

  it("restores the value from focus after deleting it character by character", async () => {
    const [value, updateValue] = createSignal(300);
    const setValue = vi.fn(updateValue);
    renderInput({
      label: "Silence",
      get value() {
        return value();
      },
      setValue,
      min: 0,
      max: 1500,
      step: 100,
    });

    const input = screen.getByRole("spinbutton", { name: "Silence" });
    await userEvent.click(input);
    for (const text of ["30", "3", ""]) {
      await userEvent.keyboard("{Backspace}");
      expect(input).toHaveValue(text);
    }
    await userEvent.tab();
    expect(input).toHaveValue("300");
    expect(value()).toBe(300);
  });

  it("preserves decimal text while deleting and restores it on empty blur", async () => {
    const [value, setValue] = createSignal(0.05);
    renderInput({
      label: "Sigma",
      get value() {
        return value();
      },
      setValue,
      min: 0,
      max: 0.15,
      step: 0.01,
      decimal: true,
    });

    const input = screen.getByRole("spinbutton", { name: "Sigma" });
    await userEvent.click(input);
    for (const text of ["0.0", "0.", "0", ""]) {
      await userEvent.keyboard("{Backspace}");
      expect(input).toHaveValue(text);
    }
    await userEvent.tab();
    expect(input).toHaveValue("0.05");
    expect(value()).toBe(0.05);
  });

  it.each([
    { initial: 0.15, text: "2" },
    { initial: 0, text: "-1" },
  ])("clamps edits when the stored value is already $initial", async (test) => {
    const [value, setValue] = createSignal(test.initial);
    renderInput({
      label: "Sigma",
      get value() {
        return value();
      },
      setValue,
      min: 0,
      max: 0.15,
      step: 0.01,
      decimal: true,
    });

    const input = screen.getByRole("spinbutton", { name: "Sigma" });
    await userEvent.clear(input);
    fireEvent.input(input, { target: { value: test.text } });
    expect(input).toHaveValue(String(test.initial));
    expect(value()).toBe(test.initial);
  });

  it("allows clearing and replacing a value without storing an empty value", async () => {
    const [value, updateValue] = createSignal(3);
    const setValue = vi.fn(updateValue);
    renderInput({
      label: "Priority",
      get value() {
        return value();
      },
      setValue,
      min: 0,
      max: 10,
      step: 1,
    });

    const input = screen.getByRole("spinbutton", { name: "Priority" });
    await userEvent.clear(input);
    expect(input).toHaveValue("");
    expect(setValue).not.toHaveBeenCalled();
    await userEvent.type(input, "7");
    expect(input).toHaveValue("7");
    expect(setValue).toHaveBeenLastCalledWith(7);
    await userEvent.tab();
    await userEvent.clear(input);
    await userEvent.tab();
    expect(input).toHaveValue("7");
    expect(setValue).toHaveBeenCalledOnce();
  });

  it.each([
    { initial: 0, decimal: false },
    { initial: 7, decimal: false },
    { initial: 0.08, decimal: true },
  ])(
    "restores $initial without changing the stored value on blur",
    async (test) => {
      const [value, updateValue] = createSignal(test.initial);
      const setValue = vi.fn(updateValue);
      renderInput({
        label: "Value",
        get value() {
          return value();
        },
        setValue,
        min: 0,
        max: 10,
        step: test.decimal ? 0.01 : 1,
        decimal: test.decimal,
      });

      const input = screen.getByRole("spinbutton", { name: "Value" });
      await userEvent.clear(input);
      expect(input).toHaveValue("");
      expect(value()).toBe(test.initial);
      await userEvent.tab();
      expect(input).toHaveValue(String(test.initial));
      expect(value()).toBe(test.initial);
      expect(setValue).not.toHaveBeenCalled();
      await userEvent.click(input);
      await userEvent.tab();
      expect(setValue).not.toHaveBeenCalled();
    },
  );

  it.each([0, 8])(
    "shows an external change to %s during an empty edit",
    async (nextValue) => {
      const [value, setValue] = createSignal(3);
      renderInput({
        label: "Value",
        get value() {
          return value();
        },
        setValue,
        min: 0,
        max: 10,
        step: 1,
      });

      const input = screen.getByRole("spinbutton", { name: "Value" });
      await userEvent.clear(input);
      setValue(nextValue);
      expect(input).toHaveValue(String(nextValue));
      await userEvent.clear(input);
      await userEvent.tab();
      expect(input).toHaveValue(String(nextValue));
      expect(value()).toBe(nextValue);
    },
  );

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
