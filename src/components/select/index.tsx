import { Tooltip } from "@components/tooltip";
import { Select } from "@kobalte/core/select";
import { type JSX, Show } from "solid-js";

/**
 * A single-choice dropdown. `name` shows a visible label above the trigger;
 * without it, `label` names the trigger for assistive tech.
 */
export function AppSelect<T extends string>(props: {
  options: T[];
  value: T | undefined;
  onChange: (value: T) => void;
  getOptionLabel?: (value: T) => string;
  /** Rich content for an option in the listbox; defaults to its label. */
  renderOption?: (value: T) => JSX.Element;
  name?: string;
  label?: string;
  optionLang?: string;
  /** An element placed beside the trigger, such as an action button. */
  action?: JSX.Element;
  class?: string;
}) {
  const optionLabel = (value: T) => props.getOptionLabel?.(value) ?? value;

  return (
    <Select<T>
      options={props.options}
      value={props.value}
      onChange={(value) => {
        if (value !== null) props.onChange(value);
      }}
      class={props.class}
      itemComponent={(itemProps) => (
        <Select.Item
          item={itemProps.item}
          class="flex cursor-pointer flex-row items-center justify-between gap2 rounded-md p1 pl2 outline-none ui-highlighted:(bg-accent text-on-accent)"
        >
          <Select.ItemLabel lang={props.optionLang} class="min-w-0 flex-1">
            {props.renderOption?.(itemProps.item.rawValue) ??
              optionLabel(itemProps.item.rawValue)}
          </Select.ItemLabel>
          <Select.ItemIndicator class="size-6 flex shrink-0 items-center justify-center">
            <div aria-hidden="true" class="i-lucide:check size-4" />
          </Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Show when={props.name}>
        <Select.Label class="text-sm select-none cursor-default">
          {props.name}
        </Select.Label>
      </Show>
      <div class="flex w-full items-center gap1">
        <Tooltip
          content={
            <span lang={props.optionLang}>
              {props.value === undefined ? "" : optionLabel(props.value)}
            </span>
          }
          class="min-w-0 flex-1"
          onlyWhenOverflowing
        >
          <Select.Trigger
            aria-label={props.name ? undefined : props.label}
            class="flex h-8 w-full min-w-0 flex-row items-center justify-between gap1 rounded-md b b-border bg-surface px2 text-sm outline-none hover:bg-hover focus-visible:(ring-2 ring-focus-ring)"
          >
            <Select.Value<T> lang={props.optionLang} class="min-w-0 truncate">
              {(state) => optionLabel(state.selectedOption())}
            </Select.Value>
            <Select.Icon class="shrink-0">
              <div
                aria-hidden="true"
                class="i-lucide:chevrons-up-down size-4"
              />
            </Select.Icon>
          </Select.Trigger>
        </Tooltip>
        {props.action}
      </div>
      <Select.Portal>
        <Select.Content class="z-popover w-full max-h-[50vh] overflow-y-auto rounded-lg b b-border bg-surface text-sm shadow-lg outline-none">
          <Select.Listbox class="flex flex-col p1 outline-none" />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}
