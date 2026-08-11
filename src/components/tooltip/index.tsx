import { Tooltip as TooltipPrimitive } from "@kobalte/core/tooltip";
import { createSignal, JSX, ParentComponent } from "solid-js";

interface TooltipProps {
  content: JSX.Element;
  class?: string;
  onlyWhenOverflowing?: boolean;
}

/** Adds one consistently styled tooltip to any control passed as its child. */
export const Tooltip: ParentComponent<TooltipProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [disabled, setDisabled] = createSignal(
    props.onlyWhenOverflowing ?? false,
  );

  const updateDisabled = (trigger: HTMLElement) => {
    if (!props.onlyWhenOverflowing) return;
    const target = trigger.querySelector<HTMLElement>(".truncate");
    const nextDisabled =
      target === null || target.scrollWidth <= target.clientWidth;
    setDisabled(nextDisabled);
    if (nextDisabled) setOpen(false);
  };

  return (
    <TooltipPrimitive
      placement="top"
      gutter={6}
      open={open()}
      disabled={disabled()}
      openDelay={400}
      closeDelay={0}
      onOpenChange={setOpen}
    >
      <TooltipPrimitive.Trigger
        as="span"
        class={`inline-flex ${props.class ?? ""}`}
        onPointerEnter={(event) => updateDisabled(event.currentTarget)}
        onFocusIn={(event) => {
          updateDisabled(event.currentTarget);
          if (!disabled()) setOpen(true);
        }}
        onFocusOut={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setOpen(false);
          }
        }}
      >
        {props.children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content class="z-50 select-none rounded-md bg-slate-8 px2 py1 text-xs text-white shadow-md dark:(bg-slate-1 text-slate-9)">
          {props.content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive>
  );
};
