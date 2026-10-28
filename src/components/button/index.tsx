import { Button } from "@kobalte/core/button";
import { type JSX, splitProps } from "solid-js";

interface AppButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `surface` adds the app's card background for buttons over the canvas;
   * `danger` fills red on hover, for destructive actions such as discarding.
   */
  variant?: "default" | "primary" | "surface" | "danger";
  /** `sm` fits compact toolbars and action bars. */
  size?: "sm" | "md";
}

const sizes = {
  sm: "px2 py1",
  md: "px3 py2",
};

const variants = {
  default:
    "b b-border bg-transparent hover:(b-accent bg-accent text-on-accent)",
  surface:
    "b b-border bg-surface shadow-sm hover:(b-accent bg-accent text-on-accent)",
  danger:
    "b b-border bg-transparent hover:(b-danger-strong bg-danger-strong text-on-accent)",
  primary:
    "b b-accent bg-accent font-medium text-on-accent hover:(b-accent-hover bg-accent-hover)",
};

export function AppButton(props: AppButtonProps) {
  const [local, rest] = splitProps(props, ["class", "variant", "size"]);
  return (
    <Button
      type="button"
      {...rest}
      class={`rounded-md ${sizes[local.size ?? "md"]} text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:(cursor-not-allowed opacity-50) ${variants[local.variant ?? "default"]} ${local.class ?? ""}`}
    />
  );
}
