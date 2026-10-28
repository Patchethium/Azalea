import { Tooltip } from "@components/tooltip";
import { Button } from "@kobalte/core/button";
import { JSX, splitProps } from "solid-js";

interface IconButtonProps extends Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> {
  icon: string;
  iconSize?: "sm" | "full";
  label: string;
  size?: "xs" | "sm" | "md" | "lg";
  tone?: "primary" | "danger";
}

/** A compact icon-only control with shared interaction styling and a tooltip. */
export function IconButton(props: IconButtonProps) {
  const [local, buttonProps] = splitProps(props, [
    "icon",
    "iconSize",
    "label",
    "size",
    "tone",
    "class",
  ]);
  const buttonSize = () => {
    switch (local.size) {
      case "xs":
        return "size-4";
      case "sm":
        return "size-5";
      case "lg":
        return "size-8";
      default:
        return "size-6";
    }
  };
  const iconSize = () => (local.iconSize === "sm" ? "size-4" : "size-full");
  const iconInteraction = () =>
    local.tone === "danger"
      ? "group-hover:bg-danger group-active:bg-danger-strong group-focus-visible:bg-danger"
      : "group-hover:bg-accent group-active:bg-accent-hover group-focus-visible:bg-accent";
  const focusRing = () =>
    local.tone === "danger"
      ? "focus-visible:ring-danger-ring"
      : "focus-visible:ring-focus-ring";

  return (
    <Tooltip content={local.label}>
      <Button
        {...buttonProps}
        aria-label={local.label}
        class={`group ${buttonSize()} flex shrink-0 items-center justify-center rounded-md bg-transparent outline-none ui-disabled:cursor-not-allowed focus-visible:ring-2 ${focusRing()} ${local.class ?? ""}`}
      >
        <div
          aria-hidden="true"
          class={`${local.icon} ${iconSize()} ${iconInteraction()} group-disabled:!bg-ink-disabled`}
        />
      </Button>
    </Tooltip>
  );
}
