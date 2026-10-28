import { Tooltip } from "@components/tooltip";
import { Button } from "@kobalte/core/button";
import type { JSX } from "solid-js";

/** Classes shared by toolbar icon buttons and toolbar menu triggers. */
export const TOOLBAR_BUTTON_CLASS =
  "size-8 flex shrink-0 items-center justify-center rounded-md bg-transparent outline-none enabled:hover:bg-hover focus-visible:(ring-2 ring-focus-ring-soft) disabled:(cursor-not-allowed text-ink-disabled)";

/**
 * Classes for a 32px icon button that sits directly on the canvas, such as
 * the sidebar footer's project menu, dictionary and config buttons. Callers
 * add their pressed or expanded state with `bg-accent text-on-accent`.
 */
export const SURFACE_BUTTON_CLASS =
  "size-8 flex shrink-0 items-center justify-center rounded-md bg-surface p1 text-ink shadow-md outline-none enabled:hover:(bg-accent text-on-accent) focus-visible:(ring-2 ring-focus-ring) disabled:(cursor-not-allowed opacity-50)";

/** Highlights a pressed toggle button with the primary color. */
const PRESSED_CLASS =
  "aria-pressed:(bg-primary-1 text-primary-7) dark:aria-pressed:(bg-primary-9 text-primary-2)";

/** A toolbar icon button with a hover background and a tooltip. */
export function ToolbarButton(props: {
  icon: string;
  label: string;
  tooltip?: JSX.Element;
  ariaBusy?: boolean;
  ariaPressed?: boolean;
  /** Whether a pressed button looks different from an unpressed one. */
  highlightPressed?: boolean;
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
        class={
          props.highlightPressed
            ? `${TOOLBAR_BUTTON_CLASS} ${PRESSED_CLASS}`
            : TOOLBAR_BUTTON_CLASS
        }
      >
        <div aria-hidden="true" class={`${props.icon} size-4`} />
      </Button>
    </Tooltip>
  );
}
