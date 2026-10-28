import { AppSelect } from "@components/select";
import { Checkbox } from "@kobalte/core/checkbox";
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
  return (
    <AppSelect
      name={props.name}
      options={props.options}
      value={props.value}
      onChange={props.onChange}
      getOptionLabel={props.getOptionLabel}
      optionLang={props.optionLang}
      action={props.action}
    />
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
