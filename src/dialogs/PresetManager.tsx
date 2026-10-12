import { IconButton } from "@components/iconButton";
import { Preset } from "$binding";
import { AppDialogContent } from "@dialogs/AppContent";
import { Collapsible } from "@kobalte/core/collapsible";
import { Dialog } from "@kobalte/core/dialog";
import { PresetEditor } from "@layout/sidebar/preset/Editor";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";
import { createPresetId, findPresetStyle, useTextStore } from "@contexts/text";

interface PresetManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type PresetList = "project" | "system";

/** The preset being edited; its editor replaces the opposite list. */
interface EditTarget {
  list: PresetList;
  index: number;
}

export function PresetManagerDialog(props: PresetManagerDialogProps) {
  const { t1 } = usei18n()!;
  const {
    projectPresetStore,
    setProjectPresetStore,
    removeProjectPreset,
    updateProjectPreset,
  } = useTextStore()!;
  const { config, setConfig } = useConfigStore()!;
  const [editing, setEditing] = createSignal<EditTarget | null>(null);
  createEffect(() => {
    if (!props.open) setEditing(null);
  });

  const presetsOf = (list: PresetList): readonly Preset[] =>
    list === "project" ? projectPresetStore : (config.system_presets ?? []);
  const editedPreset = () => {
    const target = editing();
    return target === null
      ? null
      : (presetsOf(target.list)[target.index] ?? null);
  };
  const toggleEdit = (list: PresetList, index: number) => {
    const target = editing();
    setEditing(
      target?.list === list && target.index === index ? null : { list, index },
    );
  };
  const updateEdited = (patch: Partial<Preset>) => {
    const target = editing();
    if (target === null) return;
    if (target.list === "project") {
      const presetId = projectPresetStore[target.index]?.id;
      if (presetId !== undefined) updateProjectPreset(presetId, patch);
    } else {
      setConfig("system_presets", target.index, (preset) => ({
        ...preset,
        ...patch,
      }));
    }
  };
  /** Keeps the edit target on the same preset after one is deleted. */
  const afterDelete = (list: PresetList, index: number) => {
    const target = editing();
    if (target?.list !== list || target.index < index) return;
    setEditing(
      target.index === index ? null : { list, index: target.index - 1 },
    );
  };

  const copyToSystem = (preset: Preset) => {
    const newPreset = { ...preset, id: createPresetId() };
    setConfig("system_presets", [...(config.system_presets ?? []), newPreset]);
  };

  const copyToProject = (preset: Preset) => {
    const newPreset = { ...preset, id: createPresetId() };
    setProjectPresetStore(projectPresetStore.length, newPreset);
  };

  const deleteFromSystem = (index: number) => {
    setConfig(
      "system_presets",
      (config.system_presets ?? []).filter((_, i) => i !== index),
    );
    afterDelete("system", index);
  };

  const deleteFromProject = (index: number) => {
    const presetId = projectPresetStore[index]?.id;
    if (presetId === undefined) return;
    removeProjectPreset(presetId);
    afterDelete("project", index);
  };

  const editorPanel = () => (
    <Show when={editedPreset()}>
      {(preset) => (
        <section
          aria-label={t1("preset_manager.editor")}
          class="min-w-0 flex flex-1 flex-col overflow-hidden rounded-md b b-slate-2 dark:b-slate-6"
        >
          <h3 class="m0 flex items-center gap2 b-b b-slate-2 bg-slate-1 px3 py1 text-sm font-semibold dark:(b-slate-6 bg-slate-7)">
            <span class="min-w-0 flex-1 truncate">
              {t1("preset_manager.editor")}
            </span>
            <IconButton
              icon="i-lucide:x"
              iconSize="sm"
              size="sm"
              label={t1("preset_manager.close_editor")}
              onClick={() => setEditing(null)}
            />
          </h3>
          <div class="min-h-0 flex flex-1 flex-col overflow-y-auto px3">
            <PresetEditor preset={preset()} onChange={updateEdited} />
          </div>
        </section>
      )}
    </Show>
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <AppDialogContent
        title={t1("preset_manager.title")}
        closeLabel={t1("preset_manager.close")}
        // Fixed to the preset editor height so toggling edit mode keeps the size.
        class="h-[min(80vh,32rem)] w-[min(90vw,44rem)]"
      >
        <div class="flex min-h-0 flex-1 flex-row gap3 p3">
          <Show
            when={editing()?.list !== "system" || editedPreset() === null}
            fallback={editorPanel()}
          >
            <PresetColumn
              title={t1("preset_manager.project_presets")}
              presets={projectPresetStore}
              direction="right"
              copyTo={copyToSystem}
              delete={deleteFromProject}
              editingIndex={
                editing()?.list === "project" ? editing()!.index : null
              }
              edit={(index) => toggleEdit("project", index)}
            />
          </Show>
          <Show
            when={editing()?.list !== "project" || editedPreset() === null}
            fallback={editorPanel()}
          >
            <PresetColumn
              title={t1("preset_manager.system_presets")}
              presets={config.system_presets ?? []}
              direction="left"
              copyTo={copyToProject}
              delete={deleteFromSystem}
              editingIndex={
                editing()?.list === "system" ? editing()!.index : null
              }
              edit={(index) => toggleEdit("system", index)}
            />
          </Show>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}

interface PresetColumnProps {
  title: string;
  presets: readonly Preset[];
  direction: "left" | "right";
  copyTo: (preset: Preset) => void;
  delete: (index: number) => void;
  editingIndex: number | null;
  edit: (index: number) => void;
}

function PresetColumn(props: PresetColumnProps) {
  const { t1 } = usei18n()!;
  return (
    <section
      aria-label={props.title}
      class="min-w-0 flex flex-1 flex-col overflow-hidden rounded-md b b-slate-2 dark:b-slate-6"
    >
      <h3 class="m0 flex items-center gap2 b-b b-slate-2 bg-slate-1 px3 py1.5 text-sm font-semibold dark:(b-slate-6 bg-slate-7)">
        <span class="flex-1">{props.title}</span>
        <span class="text-xs font-normal text-slate-5 dark:text-slate-4">
          {props.presets.length}
        </span>
      </h3>
      <Show
        when={props.presets.length}
        fallback={
          <p class="m0 flex flex-1 items-center justify-center p3 text-sm text-slate-5 dark:text-slate-4">
            {t1("preset_manager.empty")}
          </p>
        }
      >
        <ul class="m0 flex min-h-0 flex-1 list-none flex-col overflow-y-auto p0">
          <For each={props.presets}>
            {(preset, i) => (
              <PresetItem
                preset={preset}
                index={i()}
                direction={props.direction}
                copyTo={props.copyTo}
                delete={props.delete}
                editing={props.editingIndex === i()}
                edit={props.edit}
              />
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

interface PresetItemProps {
  preset: Preset;
  index: number;
  direction: "left" | "right";
  copyTo: (preset: Preset) => void;
  delete: (index: number) => void;
  editing: boolean;
  edit: (index: number) => void;
}

const formatNumber = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);

function PresetItem(props: PresetItemProps) {
  const { t1 } = usei18n()!;
  const { metas } = useMetaStore()!;
  const identity = createMemo(() => findPresetStyle(props.preset, metas));
  const copyLabel = () =>
    t1(
      props.direction === "right"
        ? "preset_manager.copy_to_system"
        : "preset_manager.copy_to_project",
    );
  const details = () => [
    [t1("preset.speed"), `${formatNumber(props.preset.speed)}%`],
    [t1("preset.pitch"), formatNumber(props.preset.pitch)],
    [t1("preset.intonation"), formatNumber(props.preset.intonation)],
    [t1("preset.volume"), formatNumber(props.preset.volume)],
    [t1("preset.start_sli"), `${formatNumber(props.preset.start_slience)} ms`],
    [t1("preset.end_sli"), `${formatNumber(props.preset.end_slience)} ms`],
  ];

  return (
    <li class="[&+li]:(b-t b-slate-2 dark:b-slate-6)">
      <Collapsible>
        <div class="flex items-center gap2 px2 py1.5 hover:bg-slate-50 dark:hover:bg-slate-7/50">
          <Collapsible.Trigger class="group min-w-0 flex flex-1 cursor-pointer items-center gap2 rounded bg-transparent p0 text-left outline-none focus-visible:(ring-2 ring-primary-3)">
            <div
              aria-hidden="true"
              class="i-lucide:chevron-right size-4 shrink-0 text-slate-5 transition-transform group-data-[expanded]:rotate-90"
            />
            <span class="min-w-0 flex flex-1 flex-col">
              <span class="truncate text-sm font-medium">
                {props.preset.name || t1("preset.placeholder_name")}
              </span>
              <Show when={identity()}>
                {(found) => (
                  <span
                    lang="ja"
                    class="truncate text-xs text-slate-5 dark:text-slate-4"
                  >
                    {found().speaker.name} › {found().style.name}
                  </span>
                )}
              </Show>
            </span>
          </Collapsible.Trigger>
          <IconButton
            icon="i-lucide:pencil"
            iconSize="sm"
            size="md"
            tone="primary"
            label={t1("preset_manager.edit")}
            aria-pressed={props.editing}
            class="aria-pressed:bg-primary-1 dark:aria-pressed:bg-primary-9"
            onClick={() => props.edit(props.index)}
          />
          <IconButton
            icon={
              props.direction === "right"
                ? "i-lucide:arrow-right"
                : "i-lucide:arrow-left"
            }
            iconSize="sm"
            size="md"
            tone="primary"
            label={copyLabel()}
            onClick={() => props.copyTo(props.preset)}
          />
          <IconButton
            icon="i-lucide:trash-2"
            iconSize="sm"
            size="md"
            tone="danger"
            label={t1("preset_manager.delete")}
            onClick={() => props.delete(props.index)}
          />
        </div>
        <Collapsible.Content>
          <dl class="m0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pb2 pl-8 pr3 text-xs">
            <For each={details()}>
              {([label, value]) => (
                <>
                  <dt class="text-slate-5 dark:text-slate-4">{label}</dt>
                  <dd class="m0 tabular-nums">{value}</dd>
                </>
              )}
            </For>
          </dl>
        </Collapsible.Content>
      </Collapsible>
    </li>
  );
}
