import { Button } from "@kobalte/core/button";
import { Dialog } from "@kobalte/core/dialog";
import { createSignal, For, Show } from "solid-js";
import { produce } from "solid-js/store";
import { Preset } from "../binding";
import { useConfigStore } from "../contexts/config";
import { usei18n } from "../contexts/i18n";
import { useTextStore } from "../contexts/text";
import { AppDialogContent } from "./AppDialogContent";

interface PresetManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PresetManagerDialog(props: PresetManagerDialogProps) {
  const { t1 } = usei18n()!;
  const { projectPresetStore, setProjectPresetStore } = useTextStore()!;
  const { config, setConfig } = useConfigStore()!;

  const copyToSystem = (preset: Preset) => {
    // Clone the preset to avoid reference issues
    const newPreset = { ...preset };
    setConfig("system_presets", [...(config.system_presets ?? []), newPreset]);
  };

  const copyToProject = (preset: Preset) => {
    const newPreset = { ...preset };
    setProjectPresetStore(projectPresetStore.length, newPreset);
  };

  const deleteFromSystem = (index: number) => {
    setConfig(
      "system_presets",
      (config.system_presets ?? []).filter((_, i) => i !== index),
    );
  };

  const deleteFromProject = (index: number) => {
    setProjectPresetStore(
      produce((presets) => {
        presets.splice(index, 1);
      }),
    );
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <AppDialogContent
        title={t1("preset_manager.title")}
        closeLabel={t1("preset_manager.close")}
        class="max-w-4xl w-full h-[60%]"
      >
        <div class="flex flex-row gap-4 flex-1 overflow-hidden min-h-0 p4">
          {/* Project Presets Column */}
          <div class="flex-1 flex flex-col gap-2 border dark:border-slate-6 rounded-md p-2">
            <h3 class="font-semibold text-center bg-slate-100 dark:bg-slate-7 p-1 rounded">
              {t1("preset_manager.project_presets")}
            </h3>
            <div class="flex-1 overflow-y-auto flex flex-col gap-2">
              <For each={projectPresetStore}>
                {(preset, i) => (
                  <PresetItem
                    preset={preset}
                    index={i()}
                    direction="right"
                    copyTo={copyToSystem}
                    delete={deleteFromProject}
                  />
                )}
              </For>
            </div>
          </div>

          {/* System Presets Column */}
          <div class="flex-1 flex flex-col gap-2 border dark:border-slate-6 rounded-md p-2">
            <h3 class="font-semibold text-center bg-slate-100 dark:bg-slate-7 p-1 rounded">
              {t1("preset_manager.system_presets")}
            </h3>
            <div class="flex-1 overflow-y-auto flex flex-col gap-2">
              <For each={config.system_presets ?? []}>
                {(preset, i) => (
                  <PresetItem
                    preset={preset}
                    index={i()}
                    direction="left"
                    copyTo={copyToProject}
                    delete={deleteFromSystem}
                  />
                )}
              </For>
            </div>
          </div>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}

interface PresetItemProps {
  preset: Preset;
  index: number;
  direction: "left" | "right";
  copyTo: (preset: Preset) => void;
  delete: (index: number) => void;
}

function PresetItem(props: PresetItemProps) {
  const { t1 } = usei18n()!;
  const [hovered, setHovered] = createSignal(false);
  return (
    <div
      class="flex items-center justify-between p-2 border dark:border-slate-6 rounded hover:bg-slate-50 dark:hover:bg-slate-7"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span class="truncate font-medium">{props.preset.name}</span>
      <Show when={hovered()} fallback={<div />}>
        <div class="flex gap-1">
          <Button
            class="hover:text-primary-5 rounded text-slate-7 dark:text-slate-3 bg-transparent"
            title={t1("preset_manager.copy_to_project")}
            onClick={() => props.copyTo(props.preset)}
          >
            <div
              class="size-6"
              classList={{
                "i-lucide:arrow-right": props.direction === "right",
                "i-lucide:arrow-left": props.direction === "left",
              }}
            />
          </Button>
          <Button
            class="hover:text-red-5 rounded text-slate-7 dark:text-slate-3 bg-transparent"
            title={t1("preset_manager.delete")}
            onClick={() => props.delete(props.index)}
          >
            <div class="i-lucide:trash-2 size-6" />
          </Button>
        </div>
      </Show>
    </div>
  );
}
