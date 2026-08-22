import { IconButton } from "@components/iconButton";
import { usei18n } from "@contexts/i18n";
import type { SidebarControls } from "@layout/sidebar/useSidebar";
import type { JSX } from "solid-js";

interface ListToolbarProps {
  createLabel: string;
  onCreate: () => void;
  createDisabled?: boolean;
  moveUpLabel: string;
  onMoveUp: () => void;
  moveUpDisabled?: boolean;
  moveDownLabel: string;
  onMoveDown: () => void;
  moveDownDisabled?: boolean;
  deleteLabel: string;
  onDelete: () => void;
  deleteDisabled?: boolean;
  extra?: JSX.Element;
  class?: string;
}

export function ListToolbar(props: ListToolbarProps) {
  return (
    <div
      class={`w-auto flex items-center rounded-md bg-white dark:bg-slate-8 p1 shadow-md z-10 ${props.class ?? "mt-2 mx-1"}`}
    >
      <IconButton
        icon="i-lucide:plus"
        label={props.createLabel}
        disabled={props.createDisabled}
        onClick={props.onCreate}
      />
      <IconButton
        icon="i-lucide:chevron-up"
        label={props.moveUpLabel}
        disabled={props.moveUpDisabled}
        onClick={props.onMoveUp}
      />
      <IconButton
        icon="i-lucide:chevron-down"
        label={props.moveDownLabel}
        disabled={props.moveDownDisabled}
        onClick={props.onMoveDown}
      />
      <div class="flex-1" />
      {props.extra}
      <IconButton
        icon="i-lucide:trash2"
        label={props.deleteLabel}
        tone="danger"
        disabled={props.deleteDisabled}
        onClick={props.onDelete}
      />
    </div>
  );
}

export function PresetToolbar(props: { controls: SidebarControls }) {
  const { t1 } = usei18n()!;
  const controls = props.controls;
  return (
    <ListToolbar
      createLabel={t1("preset.controls.create")}
      onCreate={controls.createPreset}
      moveUpLabel={t1("preset.controls.move_up")}
      onMoveUp={() => controls.movePreset(controls.currentPresetIndex(), -1)}
      moveUpDisabled={controls.currentPresetIndex() <= 0}
      moveDownLabel={t1("preset.controls.move_down")}
      onMoveDown={() => controls.movePreset(controls.currentPresetIndex(), 1)}
      moveDownDisabled={
        controls.currentPresetIndex() === -1 ||
        controls.currentPresetIndex() === controls.projectPresetStore.length - 1
      }
      deleteLabel={t1("preset.controls.delete")}
      onDelete={controls.removePreset}
      deleteDisabled={controls.currentText()?.preset_id == null}
      extra={
        <IconButton
          icon="i-lucide:library"
          label={t1("preset.controls.manage")}
          onClick={() => controls.setPresetManagerOpen(true)}
        />
      }
    />
  );
}
