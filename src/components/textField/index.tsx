import { TextField } from "@kobalte/core/text-field";
import { Show } from "solid-js";

/**
 * Classes shared by text inputs: a hairline border that turns `focus-ring`
 * on focus. Callers set the height (`h-8` by default, `h-6` in dense rows).
 */
export const INPUT_CLASS =
  "w-full min-w-0 rounded-lg b b-border bg-surface px2 outline-none focus:b-focus-ring disabled:(cursor-not-allowed opacity-50) dark:bg-surface-raised";

/** A labeled single-line text field with an optional hint below it. */
export function AppTextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  description?: string;
  /** Keeps the label for assistive tech only. */
  hideLabel?: boolean;
  class?: string;
}) {
  return (
    <TextField
      value={props.value}
      onChange={(value) => props.onChange(value)}
      class={`flex flex-col gap1 ${props.class ?? ""}`}
    >
      <TextField.Label
        class={
          props.hideLabel ? "sr-only" : "text-sm select-none cursor-default"
        }
      >
        {props.label}
      </TextField.Label>
      <TextField.Input
        class={`h-8 text-sm ${INPUT_CLASS}`}
        placeholder={props.placeholder}
      />
      <Show when={props.description}>
        <TextField.Description class="text-xs text-ink-subtle">
          {props.description}
        </TextField.Description>
      </Show>
    </TextField>
  );
}
