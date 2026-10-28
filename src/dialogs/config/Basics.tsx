import { ExtraDownloadButton } from "@components/extraDownload";
import { AppSelect } from "@components/select";
import { Tooltip } from "@components/tooltip";
import {
  type PitchScale,
  type PitchTuningMode,
  type ThemeMode,
  type TitlebarStyle,
} from "$binding";
import { ColorArea } from "@kobalte/core/color-area";
import { ColorSwatch } from "@kobalte/core/color-swatch";
import { parseColor } from "@kobalte/core/colors";
import { Popover } from "@kobalte/core/popover";
import { ToggleGroup } from "@kobalte/core/toggle-group";
import { createMemo, Show } from "solid-js";
import {
  DEFAULT_PITCH_SCALE,
  DEFAULT_PITCH_TUNING_MODE,
  DEFAULT_PRIMARY_COLOR,
  PRIMARY_COLOR_PATTERN,
} from "$constants";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { coverages, localeNames, possibleLocales } from "../../i18n";

const toggleItemClass =
  "h-full px3 bg-transparent outline-none hover:bg-slate-1 active:bg-slate-1 focus-visible:(ring-2 ring-inset ring-primary-2) ui-pressed:(!bg-primary-5 !text-white) dark:hover:bg-slate-7 dark:active:bg-slate-7";

export function ThemeSelect() {
  const { themeMode, setThemeMode } = useConfigStore()!;
  const { t1 } = usei18n()!;
  const options: ThemeMode[] = ["System", "Light", "Dark"];
  const themeName = (mode: ThemeMode) => {
    switch (mode) {
      case "System":
        return t1("config.theme_system");
      case "Light":
        return t1("config.theme_light");
      case "Dark":
        return t1("config.theme_dark");
    }
  };

  return (
    <AppSelect
      label={t1("config.theme")}
      options={options}
      value={themeMode()}
      onChange={setThemeMode}
      getOptionLabel={themeName}
      class="w-48"
    />
  );
}

export function TitlebarStyleSelect() {
  const { titlebarStyle, setTitlebarStyle } = useConfigStore()!;
  const { t1 } = usei18n()!;

  return (
    <ToggleGroup
      value={titlebarStyle()}
      onChange={(value) => {
        if (value !== null) setTitlebarStyle(value as TitlebarStyle);
      }}
      aria-label={t1("config.titlebar_style")}
      class="flex h-8 overflow-hidden rounded-md border border-slate-2 dark:border-slate-6"
    >
      <ToggleGroup.Item value="Native" class={toggleItemClass}>
        {t1("config.titlebar_native")}
      </ToggleGroup.Item>
      <ToggleGroup.Item
        value="Custom"
        class={`${toggleItemClass} border-x border-slate-2 dark:border-slate-6`}
      >
        {t1("config.titlebar_custom")}
      </ToggleGroup.Item>
      <ToggleGroup.Item value="Hidden" class={toggleItemClass}>
        {t1("config.titlebar_hidden")}
      </ToggleGroup.Item>
    </ToggleGroup>
  );
}

export function FontSelect() {
  const { config, setConfig, fontsInstalled } = useConfigStore()!;
  const { t1 } = usei18n()!;

  return (
    <Show
      when={fontsInstalled()}
      fallback={<ExtraDownloadButton pack="Fonts" label={t1("config.font")} />}
    >
      <ToggleGroup
        value={config.ui.embedded_font ? "embedded" : "native"}
        onChange={(value) => {
          if (value !== null) {
            setConfig("ui", "embedded_font", value === "embedded");
          }
        }}
        aria-label={t1("config.font")}
        class="flex h-8 overflow-hidden rounded-md border border-slate-2 dark:border-slate-6"
      >
        <ToggleGroup.Item value="native" class={toggleItemClass}>
          {t1("config.font_native")}
        </ToggleGroup.Item>
        <ToggleGroup.Item
          value="embedded"
          class={`${toggleItemClass} border-l border-slate-2 dark:border-slate-6`}
        >
          {t1("config.font_embedded")}
        </ToggleGroup.Item>
      </ToggleGroup>
    </Show>
  );
}

export function PitchScaleSelect() {
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;

  return (
    <ToggleGroup
      value={config.ui.pitch_scale ?? DEFAULT_PITCH_SCALE}
      onChange={(value) => {
        if (value !== null) setConfig("ui", "pitch_scale", value as PitchScale);
      }}
      aria-label={t1("config.pitch_scale")}
      class="flex h-8 overflow-hidden rounded-md border border-slate-2 dark:border-slate-6"
    >
      <ToggleGroup.Item value="Linear" class={toggleItemClass}>
        {t1("config.pitch_scale_linear")}
      </ToggleGroup.Item>
      <ToggleGroup.Item
        value="Optimal"
        class={`${toggleItemClass} border-l border-slate-2 dark:border-slate-6`}
      >
        {t1("config.pitch_scale_optimal")}
      </ToggleGroup.Item>
      <ToggleGroup.Item
        value="DensityAware"
        class={`${toggleItemClass} border-l border-slate-2 dark:border-slate-6`}
      >
        {t1("config.pitch_scale_density")}
      </ToggleGroup.Item>
    </ToggleGroup>
  );
}

export function PitchTuningModeSelect() {
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;

  return (
    <ToggleGroup
      value={config.ui.pitch_tuning_mode ?? DEFAULT_PITCH_TUNING_MODE}
      onChange={(value) => {
        if (value !== null)
          setConfig("ui", "pitch_tuning_mode", value as PitchTuningMode);
      }}
      aria-label={t1("config.pitch_tuning_mode")}
      class="flex h-8 overflow-hidden rounded-md border border-slate-2 dark:border-slate-6"
    >
      <ToggleGroup.Item value="Absolute" class={toggleItemClass}>
        {t1("config.pitch_tuning_absolute")}
      </ToggleGroup.Item>
      <ToggleGroup.Item
        value="Relative"
        class={`${toggleItemClass} border-l border-slate-2 dark:border-slate-6`}
      >
        {t1("config.pitch_tuning_relative")}
      </ToggleGroup.Item>
    </ToggleGroup>
  );
}

export function PrimaryColorPicker() {
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;
  const colorHex = () => config.ui.primary_color ?? DEFAULT_PRIMARY_COLOR;
  const color = createMemo(() => {
    const value = colorHex();
    return parseColor(
      PRIMARY_COLOR_PATTERN.test(value) ? value : DEFAULT_PRIMARY_COLOR,
    );
  });
  const setPrimaryColor = (value: ReturnType<typeof parseColor>) => {
    setConfig("ui", "primary_color", value.toString("hex").toLowerCase());
  };
  const isDefaultColor = () =>
    colorHex().toLowerCase() === DEFAULT_PRIMARY_COLOR;
  const resetPrimaryColor = () => {
    setConfig("ui", "primary_color", DEFAULT_PRIMARY_COLOR);
  };
  const normalizeColor = () => {
    const hslColor = color().toFormat("hsl");
    const hue =
      hslColor.getChannelValue("saturation") === 0
        ? parseColor(DEFAULT_PRIMARY_COLOR)
            .toFormat("hsl")
            .getChannelValue("hue")
        : hslColor.getChannelValue("hue");
    setPrimaryColor(parseColor(`hsl(${hue}, 80%, 60%)`));
  };

  return (
    <div class="flex items-center gap1">
      <Show when={!isDefaultColor()}>
        <Tooltip content={t1("config.reset_primary_color")}>
          <button
            type="button"
            aria-label={t1("config.reset_primary_color")}
            onClick={resetPrimaryColor}
            class="size-8 flex items-center justify-center rounded-md bg-transparent outline-none hover:bg-slate-1 focus-visible:(ring-2 ring-primary-2) dark:hover:bg-slate-7"
          >
            <div class="i-lucide:rotate-ccw size-4" />
          </button>
        </Tooltip>
      </Show>
      <Popover placement="bottom-end" gutter={8}>
        <Tooltip content={t1("config.primary_color")}>
          <Popover.Trigger
            aria-label={t1("config.primary_color")}
            class="size-8 cursor-pointer rounded-md b b-slate-2 dark:b-slate-6 bg-transparent p1 outline-none focus-visible:(b-primary-5 ring-2 ring-primary-2)"
          >
            <ColorSwatch
              value={color()}
              colorName={colorHex()}
              class="size-full rounded-sm b b-black/15 dark:b-white/20"
            />
          </Popover.Trigger>
        </Tooltip>
        <Popover.Portal>
          <Popover.Content class="z-60 w-56 rounded-lg b b-slate-2 dark:b-slate-6 bg-white dark:bg-slate-8 p3 shadow-lg outline-none">
            <Popover.Arrow class="fill-white dark:fill-slate-8" />
            <div class="mb3 flex items-center gap2">
              <ColorSwatch
                value={color()}
                colorName={colorHex()}
                class="size-8 rounded-md b b-black/15 dark:b-white/20"
              />
              <div>
                <Popover.Title class="text-sm font-semibold">
                  {t1("config.primary_color")}
                </Popover.Title>
                <div class="font-mono text-xs uppercase text-slate-6 dark:text-slate-3">
                  {colorHex()}
                </div>
              </div>
            </div>
            <ColorArea
              value={color()}
              colorSpace="hsl"
              onChange={setPrimaryColor}
              class="relative w-full touch-none select-none"
            >
              <div class="mb2 flex items-center text-sm">
                <ColorArea.Label>{t1("config.hue_saturation")}</ColorArea.Label>
                <div class="flex-1" />
                <button
                  type="button"
                  onClick={normalizeColor}
                  class="flex items-center gap1 rounded-md bg-transparent px2 py1 text-xs hover:bg-slate-1 dark:hover:bg-slate-7"
                >
                  <div class="i-lucide:wand-sparkles size-4" />
                  {t1("config.normalize")}
                </button>
              </div>
              <ColorArea.Background class="relative h-28 w-full rounded-md b b-slate-2 dark:b-slate-6">
                <ColorArea.Thumb class="block size-5 rounded-full b-2 b-white bg-[var(--kb-color-current)] shadow-md outline-none ring-black/20 focus-visible:ring-2">
                  <ColorArea.HiddenInputX />
                  <ColorArea.HiddenInputY />
                </ColorArea.Thumb>
              </ColorArea.Background>
            </ColorArea>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </div>
  );
}

export function I18NSelect() {
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;
  return (
    <AppSelect
      label={t1("config.lang")}
      options={possibleLocales}
      value={config.ui?.locale}
      onChange={(value) => setConfig("ui", "locale", value)}
      getOptionLabel={(locale) => localeNames[locale]}
      renderOption={(locale) => (
        <span class="flex w-36 flex-row">
          {localeNames[locale]}
          <span class="flex-1" />
          {coverages[locale] * 100}%
        </span>
      )}
      class="w-48"
    />
  );
}
