import { Tooltip } from "@components/tooltip";
import { Checkbox } from "@kobalte/core/checkbox";
import { Select } from "@kobalte/core/select";
import { Slider } from "@kobalte/core/slider";
import { type JSX, Show } from "solid-js";

export function OptionSelector(props: {
  name: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  getOptionLabel?: (value: string) => string;
  optionLang?: string;
  action?: JSX.Element;
}) {
  const optionLabel = (value: string) => props.getOptionLabel?.(value) ?? value;

  return (
    <Select
      options={props.options}
      value={props.value}
      onChange={(value) => {
        if (value !== null) props.onChange(value);
      }}
      itemComponent={(itemProps) => (
        <Select.Item
          item={itemProps.item}
          class="p1 flex flex-row items-center justify-between rounded-md ui-highlighted:(bg-primary-5 text-white) cursor-pointer"
        >
          <Select.ItemLabel lang={props.optionLang}>
            {optionLabel(itemProps.item.rawValue)}
          </Select.ItemLabel>
          <Select.ItemIndicator class="size-6 flex items-center justify-center">
            <div class="i-lucide:check" />
          </Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Label class="text-sm select-none cursor-default">
        {props.name}
      </Select.Label>
      <div class="flex w-full items-center gap1">
        <Tooltip
          content={
            <span lang={props.optionLang}>{optionLabel(props.value)}</span>
          }
          class="min-w-0 flex-1"
          onlyWhenOverflowing
        >
          <Select.Trigger
            class="flex w-full min-w-0 flex-row items-center justify-between px2 bg-white dark:bg-slate-8
                          h-8 bg-transparent border border-slate-2 rounded-md
                          hover:(bg-slate-1 dark:bg-slate-7) dark:border-slate-6"
          >
            <Select.Value<string>
              lang={props.optionLang}
              class="min-w-0 truncate"
            >
              {(state) => optionLabel(state.selectedOption())}
            </Select.Value>
            <Select.Icon class="shrink-0">
              <div class="size-4 i-lucide:chevrons-up-down" />
            </Select.Icon>
          </Select.Trigger>
        </Tooltip>
        {props.action}
      </div>
      <Select.Portal>
        <Select.Content class="z-60 bg-white dark:bg-slate-8 w-full rounded-lg border border-slate-2 dark:border-slate-6 overflow-y-auto max-h-[50vh] outline-none">
          <Select.Listbox class="bg-white dark:bg-slate-8 flex flex-col p1 overflow-y-hidden" />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}

export function PresetSlider(props: {
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
  appendix?: string;
  checkable?: { checked: boolean; setChecked: (value: boolean) => void };
  setValue: (value: number) => void;
}) {
  return (
    <Slider
      class="relative flex flex-col w-full select-none items-center py1"
      minValue={props.min}
      maxValue={props.max}
      step={props.step}
      value={[props.value]}
      disabled={!(props.checkable?.checked ?? true)}
      onChange={(value) => props.setValue(value[0])}
    >
      <div class="flex w-full text-sm items-center">
        <Show when={props.checkable}>
          <Checkbox
            class="size-4 rounded-sm b b-slate-3 mr-1 ui-checked:(!b-primary-5 bg-primary-5)"
            checked={props.checkable!.checked}
            onChange={(value) => props.checkable!.setChecked(value)}
          >
            <Checkbox.Input />
            <Checkbox.Control class="size-full rounded-md bg-transparent">
              <Checkbox.Indicator class="flex justify-center items-center size-full">
                <div class="i-lucide:check bg-white size-full" />
              </Checkbox.Indicator>
            </Checkbox.Control>
          </Checkbox>
        </Show>
        <Slider.Label>{props.name}</Slider.Label>
        <div class="flex-1" />
        <Slider.ValueLabel />
        {props.appendix ?? ""}
      </div>
      <div class="w-full flex p1">
        <Slider.Track class="w-full h-2 bg-slate-2 dark:bg-slate-6 rounded-full relative ui-disabled:cursor-not-allowed">
          <Slider.Fill class="absolute bg-primary-5 rounded-full h-full ui-disabled:bg-primary-2" />
          <Slider.Thumb class="block w-2 h-4 bg-primary-5 ui-disabled:bg-primary-2 rounded-sm -top-1 outline-none">
            <Slider.Input />
          </Slider.Thumb>
        </Slider.Track>
      </div>
    </Slider>
  );
}
