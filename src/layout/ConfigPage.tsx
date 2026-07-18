import { ColorArea } from "@kobalte/core/color-area";
import { ColorSwatch } from "@kobalte/core/color-swatch";
import { parseColor } from "@kobalte/core/colors";
import { Dialog } from "@kobalte/core/dialog";
import { NumberField } from "@kobalte/core/number-field";
import { Popover } from "@kobalte/core/popover";
import { Select } from "@kobalte/core/select";
import { Switch } from "@kobalte/core/switch";
import _ from "lodash";
import { createMemo, ParentProps, Show } from "solid-js";
import { Locale } from "../binding";
import { AppDialogContent } from "../components/AppDialogContent";
import { useConfigStore } from "../contexts/config";
import { usei18n } from "../contexts/i18n";
import { useUIStore } from "../contexts/ui";
import { coverages, localeNames, possibleLocales } from "../i18n";

function ConfigPage() {
  const { t1 } = usei18n()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const {
    config,
    setConfig,
    spectrogramPreviewEnabled,
    setSpectrogramPreviewEnabled,
  } = useConfigStore()!;

  return (
    <Dialog
      open={uiStore.page === "config"}
      onOpenChange={(open) => setUIStore("page", open ? "config" : null)}
    >
      <AppDialogContent
        title={t1("config.title")}
        closeLabel={t1("config.close")}
        class="w-[min(90vw,32rem)] h-[min(80vh,24rem)]"
      >
        <div class="flex-1 overflow-auto px3">
          <ConfigItem label={t1("config.lang")}>
            <I18NSelect />
          </ConfigItem>
          <ConfigItem label={t1("config.dark_mode")}>
            <Switch
              checked={config.ui_config.dark_mode ?? false}
              onChange={(v) => setConfig("ui_config", "dark_mode", v)}
              class="inline-flex items-center select-none cursor-pointer justify-center"
            >
              <Switch.Input class="outline-2px" />
              <Switch.Control class="bg-slate-3 dark:bg-slate-6 rounded-full w-12 h-6 p1 ui-checked:(bg-primary-5)">
                <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:(translate-x-6)" />
              </Switch.Control>
            </Switch>
          </ConfigItem>
          <ConfigItem label={t1("config.primary_color")}>
            <PrimaryColorPicker />
          </ConfigItem>
          <ConfigItem label={t1("config.truncation_len")}>
            <NumberField
              minValue={0}
              step={1}
              value={config.ui_config.name_truncation_len}
              onChange={(v) =>
                setConfig(
                  "ui_config",
                  "name_truncation_len",
                  Number.parseInt(v, 10),
                )
              }
              changeOnWheel={true}
              format={false}
              class="flex flex-row items-center justify-center gap-1"
            >
              <Show when={config.ui_config.name_truncation_len === 0}>
                <NumberField.Label class="text-slate-6">
                  {_.capitalize(t1("config.no_truncation"))}
                </NumberField.Label>
              </Show>
              <div class="flex flex-row gap-1 items-center w-16">
                <NumberField.Input class="h-8 w-full outline-none rounded-lg b b-slate-2 dark:(b-slate-6 bg-slate-8) focus:b-primary-3 px-1" />
                <div class="flex flex-col">
                  <NumberField.IncrementTrigger
                    aria-label="Increment"
                    class="size-4 bg-transparent group"
                  >
                    <div class="i-lucide:chevron-up size-full group-hover:bg-primary-5 group-active:bg-primary-7" />
                  </NumberField.IncrementTrigger>
                  <NumberField.DecrementTrigger
                    aria-label="Decrement"
                    class="size-4 bg-transparent group"
                  >
                    <div class="i-lucide:chevron-down size-full group-hover:bg-primary-5 group-active:bg-primary-7" />
                  </NumberField.DecrementTrigger>
                </div>
              </div>
            </NumberField>
          </ConfigItem>
          <ConfigItem label={t1("config.background_buffering")} experimental>
            <Switch
              checked={config.ui_config.buffer_render}
              onChange={(v) => setConfig("ui_config", "buffer_render", v)}
              class="inline-flex items-center select-none cursor-pointer justify-center"
            >
              <Switch.Input class="outline-2px" />
              <Switch.Control class="bg-slate-3 dark:bg-slate-6 rounded-full w-12 h-6 p1 ui-checked:(bg-primary-5)">
                <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:(translate-x-6)" />
              </Switch.Control>
            </Switch>
          </ConfigItem>
          <ConfigItem label={t1("config.spectrogram_preview")} experimental>
            <Switch
              checked={spectrogramPreviewEnabled()}
              onChange={setSpectrogramPreviewEnabled}
              class="inline-flex items-center select-none cursor-pointer justify-center"
            >
              <Switch.Input class="outline-2px" />
              <Switch.Control class="bg-slate-3 dark:bg-slate-6 rounded-full w-12 h-6 p1 ui-checked:(bg-primary-5)">
                <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:(translate-x-6)" />
              </Switch.Control>
            </Switch>
          </ConfigItem>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}

function PrimaryColorPicker() {
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;
  const colorHex = () => config.ui_config.primary_color ?? "#3b82f6";
  const color = createMemo(() => {
    const value = colorHex();
    return parseColor(/^#[0-9a-f]{6}$/i.test(value) ? value : "#3b82f6");
  });
  const setPrimaryColor = (value: ReturnType<typeof parseColor>) => {
    setConfig(
      "ui_config",
      "primary_color",
      value.toString("hex").toLowerCase(),
    );
  };
  const normalizeColor = () => {
    const hslColor = color().toFormat("hsl");
    const hue =
      hslColor.getChannelValue("saturation") === 0
        ? parseColor("#3b82f6").toFormat("hsl").getChannelValue("hue")
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

interface ConfigItemProps extends ParentProps {
  label: string;
  experimental?: boolean;
}

function ConfigItem(props: ConfigItemProps) {
  const { t1 } = usei18n()!;
  return (
    <div class="wfull items-center justify-center flex flex-row p2 b-b b-slate-2 dark:b-slate-7 select-none cursor-default">
      {props.label}
      {props.experimental && (
        <div
          class="i-lucide:flask-conical ml-1 size-5 text-slate-7 hover:bg-primary-5"
          title={t1("config.experimental")}
        />
      )}
      <div class="flex-1" />
      {props.children}
    </div>
  );
}

function I18NSelect() {
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;
  return (
    <Select
      options={possibleLocales}
      class="w-48 h-8"
      value={config.ui_config?.locale}
      onChange={(value) => {
        if (value !== null) setConfig("ui_config", "locale", value as Locale);
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

export default ConfigPage;
export { I18NSelect };
