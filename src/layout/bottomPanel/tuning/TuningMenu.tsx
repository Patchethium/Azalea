import type { PitchScale as PitchScaleMode, PitchTuningMode } from "$binding";
import { DEFAULT_PITCH_SCALE, DEFAULT_PITCH_TUNING_MODE } from "$constants";
import { TOOLBAR_BUTTON_CLASS } from "@components/toolbarButton";
import { Tooltip } from "@components/tooltip";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { For, Show } from "solid-js";
import type { Dict } from "../../../i18n";
import styles from "./TuningMenu.module.css";

const pitchTuningOptions = [
  ["Absolute", "config.pitch_tuning_absolute"],
  ["Relative", "config.pitch_tuning_relative"],
] as const;
const pitchScaleOptions = [
  ["Linear", "config.pitch_scale_linear"],
  ["Optimal", "config.pitch_scale_optimal"],
  ["DensityAware", "config.pitch_scale_density"],
] as const;

const separatorClass = "my-1 b-t b-slate-3 dark:b-slate-5";

function RadioOptions(props: {
  options: readonly (readonly [string, keyof Dict & `config.${string}`])[];
}) {
  const { t1 } = usei18n()!;
  return (
    <For each={props.options}>
      {([value, label]) => (
        <DropdownMenu.RadioItem
          class={styles.menu_item}
          value={value}
          closeOnSelect
        >
          <DropdownMenu.ItemIndicator class="size-4 flex items-center justify-center">
            <div class="i-lucide:check size-4" />
          </DropdownMenu.ItemIndicator>
          <DropdownMenu.ItemLabel>{t1(label)}</DropdownMenu.ItemLabel>
        </DropdownMenu.RadioItem>
      )}
    </For>
  );
}

/**
 * Tuning-panel view options: pitch tuning mode, the absolute pitch scale, and
 * the pitch ruler. It lives in the toolbar so it stays reachable when the ruler
 * is hidden.
 */
export function TuningMenu() {
  const { t1 } = usei18n()!;
  const { config, setConfig, pitchRulerEnabled, setPitchRulerEnabled } =
    useConfigStore()!;
  const tuningMode = () =>
    config.ui.pitch_tuning_mode ?? DEFAULT_PITCH_TUNING_MODE;

  return (
    <DropdownMenu>
      <Tooltip content={t1("bottom.tuning_options")}>
        <DropdownMenu.Trigger
          aria-label={t1("bottom.tuning_options")}
          class={`${TOOLBAR_BUTTON_CLASS} data-[expanded]:bg-slate-1 dark:data-[expanded]:bg-slate-7`}
        >
          <div aria-hidden="true" class="i-lucide:ellipsis-vertical size-4" />
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="z-50 bg-slate-1 dark:bg-slate-7 p-1 outline-none rounded-md ring-1 ring-slate-3 dark:ring-slate-5 shadow-xl">
          <DropdownMenu.Group>
            <DropdownMenu.GroupLabel class="px-2 py-1 text-xs text-slate-5 dark:text-slate-4">
              {t1("config.pitch_tuning_mode")}
            </DropdownMenu.GroupLabel>
            <DropdownMenu.RadioGroup
              value={tuningMode()}
              onChange={(value) =>
                setConfig("ui", "pitch_tuning_mode", value as PitchTuningMode)
              }
            >
              <RadioOptions options={pitchTuningOptions} />
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Group>
          {/* The pitch scale only maps absolute values. */}
          <Show when={tuningMode() === "Absolute"}>
            <DropdownMenu.Separator class={separatorClass} />
            <DropdownMenu.Group>
              <DropdownMenu.GroupLabel class="px-2 py-1 text-xs text-slate-5 dark:text-slate-4">
                {t1("config.pitch_scale")}
              </DropdownMenu.GroupLabel>
              <DropdownMenu.RadioGroup
                value={config.ui.pitch_scale ?? DEFAULT_PITCH_SCALE}
                onChange={(value) =>
                  setConfig("ui", "pitch_scale", value as PitchScaleMode)
                }
              >
                <RadioOptions options={pitchScaleOptions} />
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Group>
          </Show>
          <DropdownMenu.Separator class={separatorClass} />
          <DropdownMenu.CheckboxItem
            class={styles.menu_item}
            checked={pitchRulerEnabled()}
            closeOnSelect
            onChange={setPitchRulerEnabled}
          >
            <DropdownMenu.ItemIndicator class="size-4 flex items-center justify-center">
              <div class="i-lucide:check size-4" />
            </DropdownMenu.ItemIndicator>
            <DropdownMenu.ItemLabel>
              {t1("config.pitch_ruler")}
            </DropdownMenu.ItemLabel>
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
