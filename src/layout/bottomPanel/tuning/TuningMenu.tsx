import type { PitchScale as PitchScaleMode, PitchTuningMode } from "$binding";
import { DEFAULT_PITCH_SCALE, DEFAULT_PITCH_TUNING_MODE } from "$constants";
import { TOOLBAR_BUTTON_CLASS } from "@components/toolbarButton";
import { Tooltip } from "@components/tooltip";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { For, Show } from "solid-js";
import type { Dict } from "../../../i18n";

const pitchTuningOptions = [
  ["Absolute", "config.pitch_tuning_absolute"],
  ["Relative", "config.pitch_tuning_relative"],
] as const;
const pitchScaleOptions = [
  ["Linear", "config.pitch_scale_linear"],
  ["Optimal", "config.pitch_scale_optimal"],
  ["DensityAware", "config.pitch_scale_density"],
] as const;

function RadioOptions(props: {
  options: readonly (readonly [string, keyof Dict & `config.${string}`])[];
}) {
  const { t1 } = usei18n()!;
  return (
    <For each={props.options}>
      {([value, label]) => (
        <DropdownMenu.RadioItem class="menu-item" value={value} closeOnSelect>
          <DropdownMenu.ItemLabel class="flex-1">
            {t1(label)}
          </DropdownMenu.ItemLabel>
          <DropdownMenu.ItemIndicator class="size-4 shrink-0 flex items-center justify-center">
            <div class="i-lucide:check size-4" />
          </DropdownMenu.ItemIndicator>
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
          class={`${TOOLBAR_BUTTON_CLASS} data-[expanded]:bg-hover`}
        >
          <div aria-hidden="true" class="i-lucide:ellipsis-vertical size-4" />
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="menu-panel z-overlay">
          <DropdownMenu.Group>
            <DropdownMenu.GroupLabel class="menu-group-label">
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
            <DropdownMenu.Separator class="menu-separator" />
            <DropdownMenu.Group>
              <DropdownMenu.GroupLabel class="menu-group-label">
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
          <DropdownMenu.Separator class="menu-separator" />
          <DropdownMenu.CheckboxItem
            class="menu-item"
            checked={pitchRulerEnabled()}
            closeOnSelect
            onChange={setPitchRulerEnabled}
          >
            <DropdownMenu.ItemLabel class="flex-1">
              {t1("config.pitch_ruler")}
            </DropdownMenu.ItemLabel>
            <DropdownMenu.ItemIndicator class="size-4 shrink-0 flex items-center justify-center">
              <div class="i-lucide:check size-4" />
            </DropdownMenu.ItemIndicator>
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
