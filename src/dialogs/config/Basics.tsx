import { type Locale, type ThemeMode } from "$binding";
import { ColorArea } from "@kobalte/core/color-area";
import { ColorSwatch } from "@kobalte/core/color-swatch";
import { parseColor } from "@kobalte/core/colors";
import { Popover } from "@kobalte/core/popover";
import { Select } from "@kobalte/core/select";
import { createMemo } from "solid-js";
import { DEFAULT_PRIMARY_COLOR, PRIMARY_COLOR_PATTERN } from "$constants";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { coverages, localeNames, possibleLocales } from "../../i18n";

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
    <Select
      options={options}
      value={themeMode()}
      onChange={(value) => {
        if (value !== null) setThemeMode(value);
      }}
      class="h-8 w-48"
      itemComponent={(props) => (
        <Select.Item
          item={props.item}
          class="flex cursor-pointer items-center justify-between rounded-md p1 outline-none ui-highlighted:(bg-primary-5 text-white)"
        >
          <Select.ItemLabel class="px1">
            {themeName(props.item.rawValue)}
          </Select.ItemLabel>
          <Select.ItemIndicator class="flex size-6 items-center justify-center">
            <div class="i-lucide:check" />
          </Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Trigger
        class="flex h-8 w-full items-center justify-between rounded-md border border-slate-2 bg-transparent px3 outline-none hover:(bg-slate-1 dark:bg-slate-7) dark:border-slate-6"
        aria-label={t1("config.theme")}
      >
        <Select.Value<ThemeMode>>
          {(state) => themeName(state.selectedOption())}
        </Select.Value>
        <Select.Icon>
          <div class="i-lucide:chevrons-up-down" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content class="z-60 w-full rounded-lg border border-slate-2 bg-white outline-none dark:(border-slate-6 bg-slate-8)">
          <Select.Listbox class="flex flex-col p2 outline-none" />
        </Select.Content>
      </Select.Portal>
    </Select>
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
    <Popover placement="bottom-end" gutter={8}>
      <Popover.Trigger
        aria-label={t1("config.primary_color")}
        title={t1("config.primary_color")}
        class="size-8 cursor-pointer rounded-md b b-slate-2 dark:b-slate-6 bg-transparent p1 outline-none focus-visible:(b-primary-5 ring-2 ring-primary-2)"
      >
        <ColorSwatch
          value={color()}
          colorName={colorHex()}
          class="size-full rounded-sm b b-black/15 dark:b-white/20"
        />
      </Popover.Trigger>
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
  );
}

export function I18NSelect() {
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;
  return (
    <Select
      options={possibleLocales}
      class="w-48 h-8"
      value={config.ui?.locale}
      onChange={(value) => {
        if (value !== null) setConfig("ui", "locale", value as Locale);
      }}
      itemComponent={(props) => (
        <Select.Item
          item={props.item}
          class="p1 flex flex-row items-center justify-between rounded-md outline-none ui-highlighted:(bg-primary-5 text-white) cursor-pointer"
        >
          <Select.ItemLabel class="w-36 flex flex-row px1 outline-none">
            {localeNames[props.item.rawValue as Locale]}
            <div class="flex-1" />
            {coverages[props.item.rawValue as Locale] * 100}%
          </Select.ItemLabel>
          <Select.ItemIndicator class="size-6 flex items-center justify-center outline-none">
            <div class="i-lucide:check" />
          </Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Trigger
        class="flex flex-row items-center justify-between p3 w-full outline-none
              h-8 bg-transparent border border-slate-2 rounded-md
              hover:(bg-slate-1 dark:bg-slate-7) dark:border-slate-6"
        aria-label={t1("config.lang")}
      >
        <Select.Value<string>>
          {(state) => localeNames[state.selectedOption() as Locale]}
        </Select.Value>
        <Select.Icon>
          <div class="i-lucide:chevrons-up-down" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content class="bg-white dark:bg-slate-8 w-full rounded-lg border outline-none border-slate-2 dark:border-slate-6 z-60">
          <Select.Listbox class="flex flex-col p2 outline-none" />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}
