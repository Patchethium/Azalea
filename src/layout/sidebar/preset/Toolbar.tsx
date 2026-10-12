import { IconButton } from "@components/iconButton";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import type { SidebarControls } from "@layout/sidebar/useSidebar";
import { type JSX, Show } from "solid-js";

interface ListToolbarProps {
  createLabel: string;
  onCreate: () => void;
  createDisabled?: boolean;
  /** Omit the move buttons for lists that reorder by dragging. */
  move?: {
    upLabel: string;
    onUp: () => void;
    upDisabled?: boolean;
    downLabel: string;
    onDown: () => void;
    downDisabled?: boolean;
  };
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
      <Show when={props.move}>
        {(move) => (
          <>
            <IconButton
              icon="i-lucide:chevron-up"
              label={move().upLabel}
              disabled={move().upDisabled}
              onClick={move().onUp}
            />
            <IconButton
              icon="i-lucide:chevron-down"
              label={move().downLabel}
              disabled={move().downDisabled}
              onClick={move().onDown}
            />
          </>
        )}
      </Show>
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
  const { voicesReady } = useConfigStore()!;
  return (
    <ListToolbar
      createLabel={t1("preset.controls.create")}
      onCreate={controls.createPreset}
      createDisabled={!voicesReady()}
      deleteLabel={t1("preset.controls.delete")}
      onDelete={controls.removePreset}
      deleteDisabled={
        !voicesReady() || controls.currentText()?.preset_id == null
      }
      extra={
        <IconButton
          disabled={!voicesReady()}
          icon="i-lucide:library"
          label={t1("preset.controls.manage")}
          onClick={() => controls.setPresetManagerOpen(true)}
        />
      }
    />
  );
}
