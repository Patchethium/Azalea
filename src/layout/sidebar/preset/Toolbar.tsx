import { IconButton } from "@components/iconButton";
import type { SidebarControls } from "@layout/sidebar/useSidebar";
import { usei18n } from "../../../contexts/i18n";

export function PresetToolbar(props: { controls: SidebarControls }) {
  const { t1 } = usei18n()!;
  const controls = props.controls;
  return (
    <div class="w-auto flex items-center rounded-md bg-white dark:bg-slate-8 mt-2 mx-1 p1 shadow-md z-10">
      <IconButton
        icon="i-lucide:plus"
        label={t1("preset.controls.create")}
        onClick={controls.createPreset}
      />
      <IconButton
        icon="i-lucide:chevron-up"
        label={t1("preset.controls.move_up")}
        disabled={
          controls.currentText()?.preset_id == null ||
          controls.currentText()?.preset_id === 0
        }
        onClick={() =>
          controls.movePreset(controls.currentText()?.preset_id ?? 0, -1)
        }
      />
      <IconButton
        icon="i-lucide:chevron-down"
        label={t1("preset.controls.move_down")}
        disabled={
          controls.currentText()?.preset_id == null ||
          controls.currentText()?.preset_id ===
            controls.projectPresetStore.length - 1
        }
        onClick={() =>
          controls.movePreset(controls.currentText()?.preset_id ?? 0, 1)
        }
      />
      <div class="flex-1" />
      <IconButton
        icon="i-lucide:library"
        label={t1("preset.controls.manage")}
        onClick={() => controls.setPresetManagerOpen(true)}
      />
      <IconButton
        icon="i-lucide:trash2"
        label={t1("preset.controls.delete")}
        tone="danger"
        disabled={controls.currentText()?.preset_id == null}
        onClick={controls.removePreset}
      />
    </div>
  );
}
