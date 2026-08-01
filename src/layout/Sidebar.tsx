import { Accordion } from "@kobalte/core/accordion";
import { Checkbox } from "@kobalte/core/checkbox";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { NumberField } from "@kobalte/core/number-field";
import { Select } from "@kobalte/core/select";
import { Slider } from "@kobalte/core/slider";
import { TextField } from "@kobalte/core/text-field";
import { ToggleGroup } from "@kobalte/core/toggle-group";
import { createScheduled, throttle } from "@solid-primitives/scheduled";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import _ from "lodash";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { produce } from "solid-js/store";
import { commands, Preset, StyleId } from "../binding";
import { AboutDialog } from "../components/AboutDialog";
import { IconButton } from "../components/IconButton";
import { PresetManagerDialog } from "../components/PresetManagerDialog";
import { ShortcutReferenceDialog } from "../components/ShortcutReferenceDialog";
import { SpeakerSelectionDialog } from "../components/SpeakerSelectionDialog";
import { useConfigStore } from "../contexts/config";
import { usei18n } from "../contexts/i18n";
import { useMetaStore } from "../contexts/meta";
import { useSystemStore } from "../contexts/system";
import { findPresetStyle, useTextStore } from "../contexts/text";
import { PageType, useUIStore } from "../contexts/ui";
import {
  isShortcutAllowed,
  matchesShortcut,
  resolveShortcut,
} from "../shortcuts";
import style from "./sidebar.module.css";

interface PresetCardProps extends JSX.HTMLAttributes<HTMLDivElement> {
  preset_idx: number;
  selected: boolean;
}

function PresetCard(props: PresetCardProps) {
  const { metas } = useMetaStore()!;
  const { projectPresetStore } = useTextStore()!;
  const preset = createMemo(() => {
    if (projectPresetStore.length === 0) {
      return null;
    }
    return projectPresetStore[props.preset_idx];
  });
  const identity = createMemo(() => {
    const currentPreset = preset();
    return currentPreset === null || currentPreset === undefined
      ? null
      : findPresetStyle(currentPreset, metas);
  });

  return (
    <div class="p1 group" {...props}>
      <div
        class="items-start rounded-r-md p1 pl2 group-hover:bg-slate-2 dark:group-hover:bg-slate-7 overflow-hidden bg-white dark:bg-slate-8 border-l-2 border-slate-1 dark:border-slate-7
        cursor-default select-none w-full min-h-[fit-content] group-active:bg-white dark:group-active:bg-slate-8 flex flex-col"
        classList={{
          "shadow-md group-hover:bg-white dark:group-hover:bg-slate-8 !border-primary-5":
            props.selected,
        }}
      >
        <div>{preset()?.name ?? ""}</div>
        <div class="text-xs text-slate-5 flex flex-row items-center">
          {identity()?.speaker.name}
          <span class="mx-1">{">"}</span>
          {identity()?.style.name}
        </div>
      </div>
    </div>
  );
}

function Sidebar() {
  const { metas } = useMetaStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const {
    setTextStore,
    projectPresetStore,
    setProjectPresetStore,
    project,
    projectPath,
    setProjectPath,
    selectedTextBlock,
    selectedTextBlockIndex,
    replaceTextBlocks,
    newProject,
  } = useTextStore()!;
  const { config, setConfig } = useConfigStore()!;
  const { systemStore } = useSystemStore()!;
  const { t1 } = usei18n()!;

  const setStyleId = (styleId: StyleId) => {
    const presetId = currentText()?.preset_id;
    const styleChanged =
      presetId !== null &&
      presetId !== undefined &&
      projectPresetStore[presetId]?.style_id !== styleId;
    const speaker = metas.find((candidate) =>
      candidate.styles.some((style) => style.id === styleId),
    );
    const style = speaker?.styles.find((candidate) => candidate.id === styleId);
    if (
      presetId !== null &&
      presetId !== undefined &&
      speaker !== undefined &&
      style !== undefined
    ) {
      batch(() => {
        setProjectPresetStore(presetId, "style_id", styleId);
        setProjectPresetStore(presetId, "speaker_uuid", speaker.speaker_uuid);
        setProjectPresetStore(presetId, "style_name", style.name);
        if (styleChanged) {
          setTextStore(
            produce((blocks) => {
              for (const block of blocks) {
                if (block.preset_id === presetId) {
                  block.query_is_modified = false;
                }
              }
            }),
          );
        }
      });
    }
  };

  const [expanded, setExpanded] = createSignal(["preset"]);
  const [presetManagerOpen, setPresetManagerOpen] = createSignal(false);
  const [speakerSelectionOpen, setSpeakerSelectionOpen] = createSignal(false);
  const [aboutOpen, setAboutOpen] = createSignal(false);

  const currentText = selectedTextBlock;

  const currentPreset = createMemo(() => {
    const presetId = currentText()?.preset_id;
    if (projectPresetStore.length === 0 || presetId == null) {
      return null;
    }
    return projectPresetStore[presetId] ?? null;
  });

  const currentStyleIdentity = createMemo(() => {
    const preset = currentPreset();
    return preset === null ? null : findPresetStyle(preset, metas);
  });
  const curMeta = () => currentStyleIdentity()?.speaker;
  const curStyle = () => currentStyleIdentity()?.style;

  const availableStyleNames = () =>
    _.flatMap(curMeta()?.styles.map((s) => s.name)) ?? [];

  const availableSpeakerNames = () => {
    return metas.map((meta) => meta.name);
  };

  const selectSpeakerByName = (name: string) => {
    const speaker = metas.find((meta) => meta.name === name);
    if (speaker !== undefined && speaker.styles.length > 0) {
      setStyleId(speaker.styles[0].id);
    }
  };

  const setStyleByName = (name: string) => {
    const style = curMeta()?.styles.find((s) => s.name === name);
    if (style) setStyleId(style.id);
  };

  const createPresetSetter = (key: keyof Preset) => (value: number) => {
    const presetId = currentText()?.preset_id;
    if (presetId !== null && presetId !== undefined) {
      setProjectPresetStore(presetId, key, value);
    }
  };

  const pitch = createMemo(() => currentPreset()?.pitch);
  const setPitch = createPresetSetter("pitch");

  const speed = createMemo(() => currentPreset()?.speed);
  const setSpeed = createPresetSetter("speed");

  const intonation = createMemo(() => currentPreset()?.intonation);
  const setIntonation = createPresetSetter("intonation");

  const volume = createMemo(() => currentPreset()?.volume);
  const setVolume = createPresetSetter("volume");

  const startSli = createMemo(() => currentPreset()?.start_slience);
  const setStartSli = createPresetSetter("start_slience");

  const endSli = createMemo(() => currentPreset()?.end_slience);
  const setEndSli = createPresetSetter("end_slience");

  const setPresetName = (name: string) => {
    const presetId = currentText()?.preset_id;
    if (presetId !== null && presetId !== undefined) {
      setProjectPresetStore(presetId, "name", name);
    }
  };

  const setTextPresetIdx = (preset_idx: number) => {
    const block = currentText();
    if (block === null) return;
    const previousStyle =
      block.preset_id === null
        ? null
        : projectPresetStore[block.preset_id]?.style_id;
    const nextStyle = projectPresetStore[preset_idx]?.style_id;
    batch(() => {
      setTextStore(selectedTextBlockIndex(), "preset_id", preset_idx);
      if (previousStyle !== nextStyle) {
        setTextStore(selectedTextBlockIndex(), "query_is_modified", false);
      }
    });
  };

  const createPreset = () => {
    const preset: Preset = {
      ...(currentPreset() ?? {
        speed: 100,
        pitch: 0,
        intonation: 1,
        volume: 1,
        start_slience: 200,
        end_slience: 200,
        style_id: 0,
        speaker_uuid: null,
        style_name: null,
      }),
      name: t1("preset.new_preset"),
    };
    setProjectPresetStore(projectPresetStore.length, preset);
    // focuse on the new preset
    setTextPresetIdx((projectPresetStore?.length ?? 1) - 1);
  };

  const removePreset = () => {
    const idx = currentText()?.preset_id;
    if (idx !== null && idx !== undefined) {
      // set every text block that uses this preset to use null as preset_id
      setTextStore(
        produce((draft) => {
          for (let i = 0; i < draft.length; i++) {
            if (draft[i].preset_id === idx) {
              draft[i].preset_id = null;
            }
          }
        }),
      );
      setProjectPresetStore(projectPresetStore.filter((_, i) => i !== idx));
      if (projectPresetStore.length > 0) {
        setTextPresetIdx(Math.max(0, idx - 1));
      }
    }
  };

  const [actionMenuOpen, setActionMenuOpen] = createSignal(false);
  const autoSave = createMemo(() => config.ui_config.auto_save);
  const setAutoSave = (v: boolean) => {
    setConfig("ui_config", "auto_save", v);
  };

  const saveProject = async () => {
    let path = projectPath();
    if (path === null) {
      path = await saveDialog({
        title: "Save Project",
        filters: [
          {
            name: "Azalea Poject Files",
            extensions: ["azp"],
          },
        ],
      });
      if (path === null) return;
      setProjectPath(path);
    }
    const res = await commands.saveProject(project, path, true);
    switch (res.status) {
      case "ok": {
        break;
      }
      case "error": {
        console.error(res.error);
        break;
      }
    }
  };

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !isShortcutAllowed(event) ||
        !matchesShortcut(
          event,
          resolveShortcut(config.ui_config.shortcuts, "save_project"),
          systemStore.os,
        )
      ) {
        return;
      }
      event.preventDefault();
      void saveProject();
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const loadProject = async () => {
    const path = await openDialog({
      title: "Save Project",
      filters: [
        {
          name: "Azalea Poject Files",
          extensions: ["azp"],
        },
      ],
    });
    if (path === null) return;
    const res = await commands.loadProject(path);
    switch (res.status) {
      case "ok": {
        // directly setting the whole project won't work
        const project = res.data;
        batch(() => {
          setProjectPath(path);
          replaceTextBlocks(project.blocks);
          setProjectPresetStore(project.presets);
          setUIStore("selectedTextBlockIndex", 0);
        });
        break;
      }
      case "error": {
        console.error(res.error);
        break;
      }
    }
  };

  const scheduledSave = createScheduled((fn) => throttle(fn, 500));

  createEffect(() => {
    JSON.stringify(project);
    if (scheduledSave() && config.ui_config.auto_save && projectPath() !== null)
      saveProject();
  });

  const handleMovePresetUp = (idx: number) => {
    if (idx <= 0 || idx >= projectPresetStore.length) return;
    const newPresets = [...projectPresetStore];
    const temp = newPresets[idx - 1];
    newPresets[idx - 1] = newPresets[idx];
    newPresets[idx] = temp;
    batch(() => {
      setProjectPresetStore(newPresets);
      // update all text blocks that use these presets
      setTextStore(
        produce((draft) => {
          for (let i = 0; i < draft.length; i++) {
            if (draft[i].preset_id === idx) {
              draft[i].preset_id = idx - 1;
            } else if (draft[i].preset_id === idx - 1) {
              draft[i].preset_id = idx;
            }
          }
        }),
      );
    });
  };

  const handleMovePresetDown = (idx: number) => {
    if (idx < 0 || idx >= projectPresetStore.length - 1) return;
    const newPresets = [...projectPresetStore];
    const temp = newPresets[idx + 1];
    newPresets[idx + 1] = newPresets[idx];
    newPresets[idx] = temp;
    batch(() => {
      setProjectPresetStore(newPresets);
      // update all text blocks that use these presets
      setTextStore(
        produce((draft) => {
          for (let i = 0; i < draft.length; i++) {
            if (draft[i].preset_id === idx) {
              draft[i].preset_id = idx + 1;
            } else if (draft[i].preset_id === idx + 1) {
              draft[i].preset_id = idx;
            }
          }
        }),
      );
    });
  };

  return (
    <div class="size-full bg-transparent flex flex-col gap-1 pl2 pr0 overflow-y-hidden">
      {/* Controls */}
      <div class="w-auto flex items-center rounded-md bg-white dark:bg-slate-8 mt-2 mx-1 p1 shadow-md z-10">
        <IconButton
          icon="i-lucide:plus"
          label={t1("preset.controls.create")}
          onClick={createPreset}
        />
        <IconButton
          icon="i-lucide:chevron-up"
          label={t1("preset.controls.move_up")}
          disabled={
            currentText()?.preset_id == null || currentText()?.preset_id === 0
          }
          onClick={() => handleMovePresetUp(currentText()?.preset_id ?? 0)}
        />
        <IconButton
          icon="i-lucide:chevron-down"
          label={t1("preset.controls.move_down")}
          disabled={
            currentText()?.preset_id == null ||
            currentText()?.preset_id === projectPresetStore.length - 1
          }
          onClick={() => handleMovePresetDown(currentText()?.preset_id ?? 0)}
        />
        <div class="flex-1" />
        <IconButton
          icon="i-lucide:library"
          label={t1("preset.controls.manage")}
          onClick={() => setPresetManagerOpen(true)}
        />
        <IconButton
          icon="i-lucide:trash2"
          label={t1("preset.controls.delete")}
          tone="danger"
          disabled={currentText()?.preset_id == null}
          onClick={removePreset}
        />
      </div>
      <div class="size-full flex flex-col overflow-hidden">
        <div class="size-full gap-1 overflow-auto pl-0 pr-2 pt-1">
          <For each={projectPresetStore}>
            {(_, i) => (
              <PresetCard
                preset_idx={i()}
                selected={i() === currentText()?.preset_id}
                onClick={() => {
                  setTextPresetIdx(i());
                }}
              />
            )}
          </For>
        </div>

        <PresetManagerDialog
          open={presetManagerOpen()}
          onOpenChange={setPresetManagerOpen}
        />
      </div>

      <Accordion
        collapsible
        multiple
        defaultValue={["preset"]}
        value={expanded()}
        onChange={setExpanded}
      >
        <Accordion.Item
          value="preset"
          class="transition-all rounded-md bg-white dark:bg-slate-8 border border-slate-2 dark:border-slate-6 bg-transparent shadow-sm"
        >
          <Accordion.Header>
            <Accordion.Trigger
              class={`w-full flex select-none justify-between bg-transparent items-center hover:bg-white dark:hover:bg-slate-7 p1 px2 rounded-md ${style.trigger}`}
            >
              {t1("preset.title")}
              <div class={`i-lucide:chevron-down size-5 ${style.icon}`} />
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content
            class={`${style.accordion_content} b-t b-slate-2 dark:b-slate-6 py0 px2 flex flex-col`}
          >
            <Show
              when={currentPreset()}
              fallback={
                <div class="text-sm text-slate-5 p1 select-none cursor-default">
                  {projectPresetStore?.length
                    ? t1("preset.no_preset_selected")
                    : t1("preset.get_started")}
                </div>
              }
            >
              <div class="w-full h-1" />
              <span class="text-sm select-none cursor-default">
                {t1("preset.name")}
              </span>
              <TextField
                class="w-full"
                value={currentPreset()?.name}
                onChange={setPresetName}
              >
                <TextField.Input class="p1 px2 w-full b b-slate-2 dark:(b-slate-6 bg-slate-7) rounded-md outline-none focus:b-primary-5" />
              </TextField>
              {/* TODO: Don't repeat yourself */}
              <OptionSelector
                name={t1("preset.speaker")}
                options={availableSpeakerNames()}
                value={curMeta()?.name ?? ""}
                onChange={selectSpeakerByName}
                action={
                  <IconButton
                    icon="i-lucide:layout-grid"
                    iconSize="sm"
                    label={t1("speaker_selection.open")}
                    size="lg"
                    class="b b-slate-2 dark:b-slate-6"
                    onClick={() => setSpeakerSelectionOpen(true)}
                  />
                }
              />
              <OptionSelector
                name={t1("preset.style")}
                options={availableStyleNames()}
                value={curStyle()?.name ?? ""}
                onChange={setStyleByName}
              />
              <PresetSlider
                name={t1("preset.speed")}
                min={50}
                max={200}
                step={1}
                appendix="%"
                value={speed()!}
                setValue={setSpeed}
              />
              <PresetSlider
                name={t1("preset.pitch")}
                min={-0.5}
                max={0.5}
                step={0.01}
                value={pitch()!}
                setValue={setPitch}
              />
              <PresetSlider
                name={t1("preset.intonation")}
                min={0.0}
                max={2.0}
                step={0.01}
                value={intonation()!}
                setValue={setIntonation}
              />
              <PresetSlider
                name={t1("preset.volume")}
                min={0.0}
                max={2.0}
                step={0.01}
                value={volume()!}
                setValue={setVolume}
              />
              <div class="flex flex-row gap2">
                <PauseNumField
                  label={t1("preset.start_sli")}
                  value={startSli()}
                  setValue={setStartSli}
                />
                <PauseNumField
                  label={t1("preset.end_sli")}
                  value={endSli()}
                  setValue={setEndSli}
                />
              </div>
              <div class="h-2 w-full" />
            </Show>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>

      <SpeakerSelectionDialog
        open={speakerSelectionOpen()}
        onOpenChange={setSpeakerSelectionOpen}
        speakers={metas}
        selectedSpeakerUuid={curMeta()?.speaker_uuid ?? null}
        onSelect={(speaker) => {
          setStyleId(speaker.styles[0].id);
          setSpeakerSelectionOpen(false);
        }}
      />

      <div class="flex flex-row items-center gap-1">
        <DropdownMenu open={actionMenuOpen()} onOpenChange={setActionMenuOpen}>
          <DropdownMenu.Trigger
            aria-label={t1("menu.project_actions")}
            class="group p1 size-8 rounded-lg bg-white dark:bg-slate-8 shadow-md hover:bg-primary-5 ui-expanded:bg-primary-5 transition-transform outline-none"
          >
            <div class="i-lucide:kanban bg-slate-8 dark:bg-slate-1 size-full group-hover:bg-white ui-expanded:!bg-white" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Arrow size={8} />
            <DropdownMenu.Content class="bg-white dark:bg-slate-8 p-1 outline-none shadow-md rounded-md b b-slate-2 dark:b-slate-6">
              <DropdownMenu.Item
                class={`${style.menu_item}`}
                onClick={newProject}
              >
                {t1("menu.new_project")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class={`${style.menu_item}`}
                onClick={loadProject}
              >
                {t1("menu.load_project")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class={`${style.menu_item}`}
                onClick={saveProject}
              >
                {t1("menu.save_project")}
              </DropdownMenu.Item>
              <DropdownMenu.Separator class="mx-2 my-1" />
              <DropdownMenu.CheckboxItem
                checked={autoSave()}
                onChange={setAutoSave}
                class={`${style.menu_item}`}
              >
                {t1("menu.auto_save")}
                <DropdownMenu.ItemIndicator class="size-4">
                  <div class="i-lucide:check size-full" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.CheckboxItem>
              <DropdownMenu.Separator class="mx-2 my-1" />
              <DropdownMenu.Item
                class={`${style.menu_item}`}
                onClick={() => setAboutOpen(true)}
              >
                {t1("menu.about")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>

        <div class="flex items-center justify-start p-2 pl-0 gap-1">
          <ShortcutReferenceDialog />
          <ToggleGroup
            class="flex items-center"
            value={uiStore.page}
            onChange={(v) => {
              setUIStore("page", v as PageType);
            }}
          >
            <ToggleGroup.Item
              value="config"
              class="group size-8 p1 rounded-lg bg-white dark:bg-slate-8 shadow-md hover:bg-primary-5 ui-pressed:bg-primary-5 transition-transform"
            >
              <div class="i-lucide:cog bg-slate-8 dark:bg-slate-1 size-full group-hover:bg-white ui-pressed:!bg-white" />
            </ToggleGroup.Item>
          </ToggleGroup>
        </div>
      </div>
      <AboutDialog open={aboutOpen()} onOpenChange={setAboutOpen} />
    </div>
  );
}

function OptionSelector(props: {
  name: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  action?: JSX.Element;
}) {
  return (
    <Select
      options={props.options}
      value={props.value}
      onChange={(v) => {
        if (v !== null) props.onChange(v);
      }}
      itemComponent={(props) => (
        <Select.Item
          item={props.item}
          class="p1 flex flex-row items-center justify-between rounded-md ui-highlighted:(bg-primary-5 text-white) cursor-pointer"
        >
          <Select.ItemLabel>{props.item.rawValue}</Select.ItemLabel>
          <Select.ItemIndicator class="size-6 flex items-center justify-center">
            <div class="i-lucide:check" />
          </Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Label class="text-sm select-none cursor-default">
        {props.name}
      </Select.Label>
      <div class="flex w-full items-center gap1">
        <Select.Trigger
          class="flex flex-1 min-w-0 flex-row items-center justify-between px2 bg-white dark:bg-slate-8
                          h-8 bg-transparent border border-slate-2 rounded-md
                          hover:(bg-slate-1 dark:bg-slate-7) dark:border-slate-6"
        >
          <Select.Value<string>>
            {(state) => state.selectedOption()}
          </Select.Value>
          <Select.Icon>
            <div class="size-4 i-lucide:chevrons-up-down" />
          </Select.Icon>
        </Select.Trigger>
        {props.action}
      </div>
      <Select.Portal>
        <Select.Content class="bg-white dark:bg-slate-8 w-full rounded-lg border border-slate-2 dark:border-slate-6 overflow-y-auto max-h-[50vh]">
          <Select.Listbox class="bg-white dark:bg-slate-8 flex flex-col p1 overflow-y-hidden" />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}

type PresetSliderProps = {
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
  appendix?: string;
  checkable?: { checked: boolean; setChecked: (v: boolean) => void };
  setValue: (v: number) => void;
};

function PresetSlider(props: PresetSliderProps) {
  return (
    <Slider
      class="relative flex flex-col w-full select-none items-center py1"
      minValue={props.min}
      maxValue={props.max}
      step={props.step}
      value={[props.value]}
      disabled={!(props.checkable?.checked ?? true)}
      onChange={(v) => props.setValue(v[0])}
    >
      <div class="flex w-full text-sm items-center">
        <Show when={props.checkable}>
          <Checkbox
            class="size-4 rounded-sm b b-slate-3 mr-1 ui-checked:(!b-primary-5 bg-primary-5)"
            checked={props.checkable!.checked}
            onChange={(v) => props.checkable!.setChecked(v)}
          >
            <Checkbox.Input />
            <Checkbox.Control class="size-full rounded-md bg-transparent">
              <Checkbox.Indicator class="flex justify-center items-center size-full">
                <div class="i-lucide:check bg-white size-full" />
              </Checkbox.Indicator>
            </Checkbox.Control>
          </Checkbox>
        </Show>
        <Slider.Label>{props.name}</Slider.Label>
        <div class="flex-1" />
        <Slider.ValueLabel />
        {props.appendix ?? ""}
      </div>
      <div class="w-full flex p1">
        <Slider.Track class="w-full h-2 bg-slate-2 dark:bg-slate-6 rounded-full relative ui-disabled:cursor-not-allowed">
          <Slider.Fill class="absolute bg-primary-5 rounded-full h-full ui-disabled:bg-primary-2" />
          <Slider.Thumb class="block w-2 h-4 bg-primary-5 ui-disabled:bg-primary-2 rounded-sm -top-1 outline-none">
            <Slider.Input />
          </Slider.Thumb>
        </Slider.Track>
      </div>
    </Slider>
  );
}

function PauseNumField(props: {
  label: string;
  value?: number;
  setValue: (v: number) => void;
}) {
  const { t2 } = usei18n()!;

  return (
    <NumberField
      minValue={0}
      maxValue={1500}
      value={props.value}
      step={100}
      onChange={(i) => props.setValue(Number.parseInt(i, 10))}
      changeOnWheel={true}
      format={false}
      title="in millisecond"
      class="w-full"
    >
      <NumberField.Label>{props.label}</NumberField.Label>
      <div class="flex flex-row gap-1 items-center">
        <NumberField.Input class="h-8 w-full outline-none rounded-lg b b-slate-2 dark:(b-slate-6 bg-slate-7) focus:b-primary-3 px-1" />
        <div class="flex flex-col">
          <NumberField.IncrementTrigger
            as={IconButton}
            icon="i-lucide:chevron-up"
            label={t2("preset.controls.increase", { label: props.label })}
            size="xs"
          />
          <NumberField.DecrementTrigger
            as={IconButton}
            icon="i-lucide:chevron-down"
            label={t2("preset.controls.decrease", { label: props.label })}
            size="xs"
          />
        </div>
      </div>
    </NumberField>
  );
}

export default Sidebar;
