import { Button } from "@kobalte/core/button";
import { Dialog } from "@kobalte/core/dialog";
import { For } from "solid-js";
import { produce } from "solid-js/store";
import { Preset } from "../binding";
import { useConfigStore } from "../contexts/config";
import { usei18n } from "../contexts/i18n";
import { useTextStore } from "../contexts/text";

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
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-50 bg-black/50" />
        <div class="fixed inset-0 z-50 flex items-center justify-center">
          <Dialog.Content class="bg-white p-4 rounded-lg shadow-lg max-w-4xl w-full max-h-[80vh] flex flex-col gap-4">
            <div class="flex justify-between items-center border-b pb-2">
              <Dialog.Title class="text-lg font-bold">
                {t1("preset_manager.title")}
              </Dialog.Title>
              <Dialog.CloseButton class="p-1 hover:bg-slate-100 rounded bg-transparent">
                <div class="i-lucide:x size-6" />
              </Dialog.CloseButton>
            </div>

            <div class="flex flex-row gap-4 flex-1 overflow-hidden min-h-0">
              {/* Project Presets Column */}
              <div class="flex-1 flex flex-col gap-2 border rounded-md p-2">
                <h3 class="font-semibold text-center bg-slate-100 p-1 rounded">
                  {t1("preset_manager.project_presets")}
                </h3>
                <div class="flex-1 overflow-y-auto flex flex-col gap-2">
                  <For each={projectPresetStore}>
                    {(preset, i) => (
                      <div class="flex items-center justify-between p-2 border rounded hover:bg-slate-50">
                        <span class="truncate font-medium">{preset.name}</span>
                        <div class="flex gap-1">
                          <Button
                            class="hover:text-blue-5 rounded text-slate-7 bg-transparent"
                            title={t1("preset_manager.copy_to_system")}
                            onClick={() => copyToSystem(preset)}
                          >
                            <div class="i-lucide:arrow-right size-6" />
                          </Button>
                          <Button
                            class="hover:text-red-5 rounded text-slate-7 bg-transparent"
                            title={t1("preset_manager.delete")}
                            onClick={() => deleteFromProject(i())}
                          >
                            <div class="i-lucide:trash-2 size-6" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              {/* System Presets Column */}
              <div class="flex-1 flex flex-col gap-2 border rounded-md p-2">
                <h3 class="font-semibold text-center bg-slate-100 p-1 rounded">
                  {t1("preset_manager.system_presets")}
                </h3>
                <div class="flex-1 overflow-y-auto flex flex-col gap-2">
                  <For each={config.system_presets ?? []}>
                    {(preset, i) => (
                      <div class="flex items-center justify-between p-2 border rounded hover:bg-slate-50">
                        <div class="flex gap-1">
                          <Button
                            class="hover:text-blue-5 rounded text-slate-7 bg-transparent"
                            title={t1("preset_manager.copy_to_project")}
                            onClick={() => copyToProject(preset)}
                          >
                            <div class="i-lucide:arrow-left size-6" />
                          </Button>
                          <Button
                            class="hover:text-red-5 rounded text-slate-7 bg-transparent"
                            title={t1("preset_manager.delete")}
                            onClick={() => deleteFromSystem(i())}
                          >
                            <div class="i-lucide:trash-2 size-6" />
                          </Button> 
                        </div>
                        <span class="truncate font-medium">{preset.name}</span>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}
