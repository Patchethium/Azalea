import { Link } from "@kobalte/core/link";
import { Select } from "@kobalte/core/select";
import { Switch } from "@kobalte/core/switch";
import { open } from "@tauri-apps/plugin-shell";
import { ParentProps } from "solid-js";
import { Locale } from "../binding";
import { useConfigStore } from "../contexts/config";
import { usei18n } from "../contexts/i18n";
import { coverages, localeNames, possibleLocales } from "../i18n";

function ConfigPage() {
  const { t1 } = usei18n()!;
  const { config, setConfig } = useConfigStore()!;

  return (
    <div class="pl0 p2 bg-transparent size-full">
      <div class=" flex flex-col bg-white size-full rounded-lg gap1 b b-slate-2 overflow-hidden">
        {/* Lang */}
        <div class="text-lg select-none cursor-default px5 pt3">
          {t1("config.title")}
        </div>
        <div class="flex-1 overflow-auto px3">
          <ConfigItem label={t1("config.lang")}>
            <I18NSelect />
          </ConfigItem>
          <ConfigItem label={t1("config.background_buffering")} experimental>
            <Switch
              checked={config.ui_config.buffer_render}
              onChange={(v) => setConfig("ui_config", "buffer_render", v)}
              class="inline-flex items-center select-none cursor-pointer justify-center"
            >
              <Switch.Input class="outline-2px" />
              <Switch.Control class="bg-slate-3 rounded-full w-12 h-6 p1 ui-checked:(bg-blue-5)">
                <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:(translate-x-6)" />
              </Switch.Control>
            </Switch>
          </ConfigItem>
        </div>
        <div class="h-8 w-full px3 text-sm flex items-center justify-center text-slate-7 gap-2">
          <div class="select-none cursor-default">Azalea v0.1.0</div>
          <div class="flex-1" />
          <Link
            onClick={() => open("https://github.com/Patchethium/Azalea")}
            class="flex flex-row items-center hover:(text-slate-9 underline underline-blue-4) cursor-pointer"
          >
            GitHub <div class="i-lucide:square-arrow-out-up-right" />
          </Link>
        </div>
      </div>
    </div>
  );
}

interface ConfigItemProps extends ParentProps {
  label: string;
  experimental?: boolean;
}

function ConfigItem(props: ConfigItemProps) {
  const { t1 } = usei18n()!;
  return (
    <div class="wfull items-center justify-center flex flex-row p2 b-b b-slate-2 select-none cursor-default">
      {props.label}
      {props.experimental && (
        <div
          class="i-lucide:flask-conical ml-1 size-5 text-slate-7 hover:bg-blue-5"
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
          class="p1 flex flex-row items-center justify-between rounded-md outline-none ui-highlighted:(bg-blue-5 text-white) cursor-pointer"
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
              hover:(bg-slate-1)"
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
        <Select.Content class="bg-white w-full rounded-lg border outline-none border-slate-2">
          <Select.Listbox class="flex flex-col p2 outline-none" />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}

export default ConfigPage;
export { I18NSelect };
