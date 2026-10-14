import { Tooltip } from "@components/tooltip";
import { Button } from "@kobalte/core/button";
import { Show } from "solid-js";

/**
 * A compact path shown in monospace with the full path in a tooltip and for
 * screen readers. Clicking it runs `onClick`, usually to open the location.
 */
export function PathButton(props: {
  path: string;
  /** Shortened path to show, e.g. from `clipPath`. Defaults to `path`. */
  display?: string;
  /** Optional caption shown in a fixed-width column before the path. */
  label?: string;
  class?: string;
  onClick: () => void;
}) {
  return (
    <Tooltip
      content={<span class="font-mono">{props.path}</span>}
      class={`min-w-0 ${props.class ?? ""}`}
    >
      <Button
        type="button"
        onClick={() => props.onClick()}
        class={`w-full min-w-0 cursor-pointer items-baseline rounded-sm bg-transparent px1 py0.5 text-left text-xs outline-none hover:bg-slate-1 focus-visible:(ring-2 ring-primary-3) dark:hover:bg-slate-7 ${props.label === undefined ? "flex" : "grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3"}`}
      >
        <Show when={props.label}>
          <span class="text-slate-6 dark:text-slate-3">{props.label}</span>
        </Show>
        <span class="min-w-0 truncate font-mono">
          <span aria-hidden="true">{props.display ?? props.path}</span>
          <span class="sr-only">{props.path}</span>
        </span>
      </Button>
    </Tooltip>
  );
}
