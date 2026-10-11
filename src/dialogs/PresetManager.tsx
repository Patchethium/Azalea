import { IconButton } from "@components/iconButton";
import { Preset } from "$binding";
import { AppDialogContent } from "@dialogs/AppContent";
import { Collapsible } from "@kobalte/core/collapsible";
import { Dialog } from "@kobalte/core/dialog";
import { createMemo, For, Show } from "solid-js";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";
import { createPresetId, findPresetStyle, useTextStore } from "@contexts/text";

interface PresetManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PresetManagerDialog(props: PresetManagerDialogProps) {
  const { t1 } = usei18n()!;
  const { projectPresetStore, setProjectPresetStore, removeProjectPreset } =
    useTextStore()!;
  const { config, setConfig } = useConfigStore()!;

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
  };

  const deleteFromProject = (index: number) => {
    const presetId = projectPresetStore[index]?.id;
    if (presetId !== undefined) removeProjectPreset(presetId);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <AppDialogContent
        title={t1("preset_manager.title")}
        closeLabel={t1("preset_manager.close")}
        class="min-h-[min(80vh,28rem)] w-[min(90vw,44rem)]"
      >
        <div class="flex min-h-0 flex-1 flex-row gap3 p3">
          <PresetColumn
            title={t1("preset_manager.project_presets")}
            presets={projectPresetStore}
            direction="right"
            copyTo={copyToSystem}
            delete={deleteFromProject}
          />
          <PresetColumn
            title={t1("preset_manager.system_presets")}
            presets={config.system_presets ?? []}
            direction="left"
            copyTo={copyToProject}
            delete={deleteFromSystem}
          />
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
