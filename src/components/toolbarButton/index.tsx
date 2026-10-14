import { Tooltip } from "@components/tooltip";
import { Button } from "@kobalte/core/button";
import type { JSX } from "solid-js";

/** A toolbar icon button with a hover background and a tooltip. */
export function ToolbarButton(props: {
  icon: string;
  label: string;
  tooltip?: JSX.Element;
  ariaBusy?: boolean;
  ariaPressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip content={props.tooltip ?? props.label}>
      <Button
        aria-label={props.label}
        aria-busy={props.ariaBusy}
        aria-pressed={props.ariaPressed}
        onClick={() => props.onClick?.()}
        disabled={props.disabled}
        class="size-8 flex shrink-0 items-center justify-center rounded-md bg-transparent outline-none enabled:hover:bg-slate-1 focus-visible:(ring-2 ring-primary-2) disabled:(cursor-not-allowed text-slate-3) dark:enabled:hover:bg-slate-7 dark:disabled:text-slate-5"
      >
        <div aria-hidden="true" class={`${props.icon} size-4`} />
      </Button>
    </Tooltip>
  );
}
