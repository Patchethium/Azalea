import { Button } from "@kobalte/core/button";
import { RadioGroup } from "@kobalte/core/radio-group";
import { createSignal, For } from "solid-js";
import { CoreConfig, commands } from "../binding";
import { useConfigStore } from "../contexts/config";
import { usei18n } from "../contexts/i18n";
import { I18NSelect } from "./ConfigPage";

function InitDialog() {
  const { setConfig } = useConfigStore()!;
  const { t1, t2 } = usei18n()!;

  const setCoreConfig = (config: CoreConfig) => {
    setConfig("core_config", config);
  };

  type ActionType = "later" | "installed";
  const actions: ActionType[] = ["installed", "later"];
  const [action, setAction] = createSignal<ActionType>("installed");

  const actionName = (act: ActionType) => {
    switch (act) {
      case "installed":
        return t1("init_dialog.installed.desp");
      case "later":
        return t1("init_dialog.later.desp");
    }
  };

  const buttonName = () => {
    switch (action()) {
      case "installed":
        return t1("init_dialog.installed.button");
      case "later":
        return t1("init_dialog.later.button");
    }
  };

  const executeAction = async () => {
    switch (action()) {
      case "later":
        commands.quit();
        break;
      case "installed": {
        const cfg = await commands.pickCore();
        if (cfg === null) {
          console.warn(
            "User cancelled core picking or an invalid path is provided.",
          );
        } else {
          setCoreConfig(cfg);
        }
        break;
      }
    }
  };

  return (
    <div class="flex relative items-center justify-center wfull hfull">
      <div
        class="relative flex flex-col items-start gap-1 bg-white p8 rounded-2xl b-1 border-blue-2 selection:(text-white bg-blue-5)
       before:(content-empty inset-0 scale-110 absolute left-0 top-0 blur-150 wfull hfull -z-10 rounded-3xl bg-gradient-to-br from-blue-3 to-green-3 rounded-2xl animate-duration-7000 animate-pulse)"
      >
        <div class="text-center text-xl font-600 text-slate-9">
          {t1("init_dialog.intro")}
        </div>
        <div class="">{t2("init_dialog.before")}</div>
        <RadioGroup
          value={action()}
          onChange={setAction}
          class="flex flex-col gap2"
        >
          <For each={actions}>
            {(act: ActionType) => (
              <RadioGroup.Item
                value={act}
                class="flex flex-row gap-2 items-center"
              >
                <RadioGroup.ItemInput />
                <RadioGroup.ItemControl class="w5 h5 rounded-full bg-white b-1 border-gray-2 flex justify-center items-center ui-checked:bg-blue-5">
                  <RadioGroup.ItemIndicator class="w2 h2 bg-white rounded-full" />
                </RadioGroup.ItemControl>
                <RadioGroup.ItemLabel class="">
                  {actionName(act)}
                </RadioGroup.ItemLabel>
              </RadioGroup.Item>
            )}
          </For>
        </RadioGroup>
        <div class="flex flex-row justify-center items-center w-full">
          <I18NSelect />
          <div class="m-auto" />
          <Button
            class="py2 px3 rounded-lg bg-blue-5 text-white hover:bg-blue-6 focus:(bg-blue-6 outline-solid outline-3 outline-blue-2) active:bg-blue-7"
            disabled={action() === null}
            onClick={executeAction}
          >
            {buttonName()}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default InitDialog;
