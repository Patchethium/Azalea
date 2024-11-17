/// The Dialog that will show when the user first opens the app
/// It will ask the user to pick an option of setting up the core path
/// - Download the core
/// - Set the core path manually
/// - Let the app find some candidate paths
///   - If failed, go back to the first option
import { Button } from "@kobalte/core/button";
import { RadioGroup } from "@kobalte/core/radio-group";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { For, createSignal } from "solid-js";
import { commands } from "../binding";
import { useConfigStore } from "../store/config";

function InitDialog() {
  const { setConfig } = useConfigStore()!;
  const setCorePath = (path: string) => {
    setConfig("core_config", { core_path: path });
  };

  type ActionType = "later" | "installed";
  const actions: ActionType[] = ["installed", "later"];
  const [action, setAction] = createSignal<ActionType>("installed");

  const actionName = (act: ActionType) => {
    switch (act) {
      case "later":
        return "I'll figure it out";
      case "installed":
        return "I have VOICEVOX installed on my computer";
    }
  };

  const buttonName = () => {
    switch (action()) {
      case "later":
        return "Okay";
      case "installed":
        return "Pick it";
    }
  };

  const executeAction = async () => {
    switch (action()) {
      case "later":
        commands.quit();
        break;
      case "installed": {
        const path = await commands.pickCore(false);
        if (path.status === "ok") {
          if (path.data !== "") {
            setCorePath(path.data);
          }
        } else {
          console.error("Error picking core path", path.error);
        }
        break;
      }
    }
  };

  return (
    <div class="flex relative items-center justify-center wfull hfull">
      <div
        class="relative flex flex-col items-start gap-1 bg-white p8 rounded-2xl b-1 border-blue-2 selection:(text-white bg-blue-5)
       before:(content-empty inset-0 scale-110 absolute left-0 top-0 blur-150 wfull hfull -z-10 rounded-3xl bg-gradient-to-br from-blue-4 to-green-4 rounded-2xl animate-duration-7000 animate-pulse)"
      >
        <div class="text-center text-xl font-600 text-slate-9">
          Welcome to
          <span
            class="ml1 underline underline-blue-4 hover:(text-blue-6 cursor-pointer)"
            onClick={() => openShell("https://github.com/Patchethium/Azalea")}
          >
            Azalea
          </span>
          , an unofficial
          <span
            class="underline underline-green-4 m1 hover:(text-green-6 cursor-pointer)"
            onClick={() => openShell("https://github.com/VOICEVOX/VOICEVOX")}
          >
            VOICEVOX
          </span>
          GUI
        </div>
        <div class="">
          Before we getting started, Azalea needs to know where the
          <span class="m1 font-bold">VOICEVOX Core</span>is.
        </div>
        <RadioGroup
          value={action()}
          onChange={setAction}
          class="flex flex-col gap2"
        >
          <RadioGroup.Label class="text-gray-9 font-bold text-lg select-none cursor-default">
            How would you like to set it up?
          </RadioGroup.Label>
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
