import { Link } from "@kobalte/core/link";
import { Select } from "@kobalte/core/select";
import { open } from "@tauri-apps/plugin-shell";
import _ from "lodash";
import { ParentProps } from "solid-js";
import { Locale } from "../binding";
import { coverages, localeNames, possibleLocales } from "../i18n";
import { useConfigStore } from "../store/config";
import { usei18n } from "../store/i18n";

function ConfigPage() {
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;

  return (
    <div class="pl0 p2 bg-transparent size-full">
      <div class=" flex flex-col bg-white size-full rounded-lg gap1 b b-slate-2 overflow-hidden">
        {/* Lang */}
        <div class="text-lg select-none cursor-default px5 pt3">
          {t1("config.title")}
        </div>
        <div class="flex-1 overflow-auto px3">
          <ConfigItem label={t1("config.lang")}>
            <Select
              options={possibleLocales}
              class="w-48 h-8"
              value={config.ui_config?.locale}
              onChange={(value) => {
                if (value !== null)
                  setConfig("ui_config", "locale", value as Locale);
              }}
              itemComponent={(props) => (
                <Select.Item
                  item={props.item}
                  class="p1 flex flex-row items-center justify-between rounded-md ui-highlighted:(bg-blue-5 text-white) cursor-pointer"
                >
                  <Select.ItemLabel class="w-36 flex flex-row px1">
                    {localeNames[props.item.rawValue as Locale]}
                    <div class="flex-1" />
                    {coverages[props.item.rawValue as Locale] * 100}%
                  </Select.ItemLabel>
                  <Select.ItemIndicator class="size-6 flex items-center justify-center">
                    <div class="i-lucide:check" />
                  </Select.ItemIndicator>
                </Select.Item>
              )}
            >
              <Select.Trigger
                class="flex flex-row items-center justify-between p3 w-full
               h-8 bg-transparent border border-slate-2 rounded-md
               hover:(bg-slate-1)"
                aria-label={t1("config.lang")}
              >
                <Select.Value<string> class="">
                  {(state) => localeNames[state.selectedOption() as Locale]}
                </Select.Value>
                <Select.Icon class="">
                  <div class="i-lucide:chevrons-up-down" />
                </Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Content class="bg-white w-full rounded-lg border border-slate-2">
                  <Select.Listbox class="flex flex-col p2" />
                </Select.Content>
              </Select.Portal>
            </Select>
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
}

function ConfigItem(props: ConfigItemProps) {
  return (
    <div class="wfull items-center justify-center flex flex-row p2 b-b b-slate-2">
      {props.label}
      <div class="flex-1" />
      {props.children}
    </div>
  );
}

export default ConfigPage;
