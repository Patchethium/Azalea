import { IconButton } from "@components/iconButton";
import { usei18n } from "@contexts/i18n";
import { NumberField } from "@kobalte/core/number-field";
import { Show } from "solid-js";

/** Labeled numeric input with clamping, stepping, and optional decimal values. */
export function NumberInput(props: {
  label: string;
  value?: number;
  setValue: (value: number) => void;
  min: number;
  max: number;
  step: number;
  title?: string;
  info?: string;
  disabled?: boolean;
  hideLabel?: boolean;
  decimal?: boolean;
}) {
  const { t2 } = usei18n()!;
  return (
    <NumberField
      minValue={props.min}
      maxValue={props.max}
      value={props.value}
      step={props.step}
      disabled={props.disabled}
      onChange={(value) => {
        const parsed = props.decimal
          ? Number.parseFloat(value)
          : Number.parseInt(value, 10);
        if (Number.isNaN(parsed)) return;
        props.setValue(Math.min(props.max, Math.max(props.min, parsed)));
      }}
      changeOnWheel={true}
      format={false}
      title={props.title}
      class="w-full"
    >
      <div class={props.hideLabel ? "sr-only" : "flex items-center gap1"}>
        <NumberField.Label class="text-sm">{props.label}</NumberField.Label>
        <Show when={props.info}>
          {(info) => (
            <IconButton
              type="button"
              icon="i-lucide:info"
              label={info()}
              size="xs"
            />
          )}
        </Show>
      </div>
      <div class="flex flex-row gap-1 items-center">
        <NumberField.Input class="h-8 w-full outline-none rounded-lg b b-slate-2 dark:(b-slate-6 bg-slate-7) focus:b-primary-3 px-1 disabled:(cursor-not-allowed opacity-50)" />
        <div class="flex flex-col">
          <NumberField.IncrementTrigger
            as={IconButton}
            icon="i-lucide:chevron-up"
            label={t2("preset.controls.increase", { label: props.label })}
            size="xs"
          />
          <NumberField.DecrementTrigger
            as={IconButton}
            icon="i-lucide:chevron-down"
            label={t2("preset.controls.decrease", { label: props.label })}
            size="xs"
          />
        </div>
      </div>
    </NumberField>
  );
}
