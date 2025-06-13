import { Accordion } from "@kobalte/core/accordion";
import { Button } from "@kobalte/core/button";
import { Checkbox } from "@kobalte/core/checkbox";
import { Select } from "@kobalte/core/select";
import { Slider } from "@kobalte/core/slider";
import { ToggleGroup } from "@kobalte/core/toggle-group";
import { TextField } from "@kobalte/core/text-field";
import { NumberField } from "@kobalte/core/number-field";
import _ from "lodash";
import { For, JSX, Show, createMemo, createSignal } from "solid-js";
import { produce } from "solid-js/store";
import { Preset, StyleId } from "../binding";
import { useConfigStore } from "../contexts/config";
import { usei18n } from "../contexts/i18n";
import { useMetaStore } from "../contexts/meta";
import { useTextStore } from "../contexts/text";
import { PageType, useUIStore } from "../contexts/ui";
import style from "./sidebar.module.css";

interface PresetCardProps extends JSX.HTMLAttributes<HTMLDivElement> {
  preset_idx: number;
  selected: boolean;
}

function PresetCard(props: PresetCardProps) {
  const { config } = useConfigStore()!;
  const { metas } = useMetaStore()!;
  const preset = createMemo(() => {
    if (config.presets === undefined || config.presets.length === 0) {
      return null;
    }
    return config.presets[props.preset_idx];
  });
  const speaker = createMemo(() =>
    metas.find((meta) =>
      meta.styles.find((style) => style.id === preset()?.style_id)
    )
  );
  const style = createMemo(
    () =>
      speaker()?.styles.find((style) => style.id === preset()?.style_id)?.name
  );

  return (
    <div class="p1 group" {...props}>
      <div
        class="items-start rounded-r-md p1 pl2 group-hover:bg-slate-2 overflow-hidden bg-white border-l-2 border-slate-1
        cursor-default select-none w-full min-h-[fit-content] group-active:bg-white flex flex-col"
        classList={{
          "shadow-md group-hover:bg-white !border-blue-5": props.selected,
        }}
      >
        <div>{preset()?.name ?? ""}</div>
        <div class="text-xs text-slate-5 flex flex-row items-center">
          {speaker()?.name}
          <span class="mx-1">{">"}</span>
          {style()}
        </div>
      </div>
    </div>
  );
}

function Sidebar() {
  const { metas, availableStyleIds } = useMetaStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const { textStore, setTextStore } = useTextStore()!;
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;

  const setStyleId = (styleId: StyleId) => {
    if (styleId in availableStyleIds()) {
      setConfig("presets", currentText().presetId!, "style_id", styleId);
    }
  };

  const [expanded, setExpanded] = createSignal(["preset"]);

  const currentText = () => textStore[uiStore.selectedTextBlockIndex];

  const currentPreset = createMemo(() => {
    if (config.presets === undefined || config.presets.length === 0) {
      return null;
    }
    return config.presets[currentText().presetId!];
  });

  const curMeta = () =>
    metas.find((meta) =>
      meta.styles.find((style) => style.id === currentPreset()?.style_id)
    );

  const curStyle = () =>
    curMeta()?.styles.find((style) => style.id === currentPreset()?.style_id);

  const availableStyleNames = () =>
    _.flatMap(curMeta()?.styles.map((s) => s.name)) ?? [];

  const availableSpeakerNames = () => {
    return metas.map((meta) => meta.name);
  };

  const selectSpeakerByName = (name: string) => {
    const speaker = metas.find((meta) => meta.name === name);
    if (speaker) {
      setConfig(
        "presets",
        currentText().presetId!,
        "style_id",
        speaker.styles[0].id
      );
    }
  };

  const setStyleByName = (name: string) => {
    const style = curMeta()?.styles.find((s) => s.name === name);
    if (style) setStyleId(style.id);
  };

  const createPresetSetter = (key: keyof Preset) => (value: number) => {
    setConfig("presets", currentText().presetId!, key, value);
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
    setConfig("presets", currentText().presetId!, "name", name);
  };

  const setTextPresetIdx = (preset_idx: number) => {
    setTextStore(
      produce((draft) => {
        draft[uiStore.selectedTextBlockIndex].presetId = preset_idx;
      })
    );
  };

  const createPreset = () => {
    const preset: Preset = {
      name: t1("preset.new_preset"),
      style_id: currentPreset()?.style_id ?? 0,
      speed: 100,
      pitch: 0.0,
      intonation: 1.0,
      volume: 1.0,
      start_slience: 0,
      end_slience: 0,
    };
    if (config.presets === undefined) {
      setConfig("presets", [preset]);
    } else {
      setConfig("presets", config.presets.length, preset);
    }
    // focuse on the new preset
    setTextPresetIdx((config.presets?.length ?? 1) - 1);
  };

  const removePreset = () => {
    const idx = currentText().presetId;
    if (idx !== undefined)
      // set every text block that uses this preset to use null as preset_id
      setTextStore(
        produce((draft) => {
          for (let i = 0; i < draft.length; i++) {
            if (draft[i].presetId === idx) {
              draft[i].presetId = undefined;
            }
          }
        })
      );
    setConfig(
      "presets",
      config.presets?.filter((_, i) => i !== idx)
    );
  };

  return (
    <div class="size-full bg-transparent flex flex-col gap-1 pl2 pr0 overflow-y-hidden">
      <Show
        when={uiStore.page == null}
        fallback={
          <div class="size-full items-start justify-start p-3 overflow-y-hidden">
            <div class="text-lg font-bold">{t1("config.title")}</div>
            <div class="text-sm">{t1("config.sidebar_desp")}</div>
          </div>
        }
      >
        <div class="w-auto flex items-center rounded-md bg-white mt-2 mx-1 p1 shadow-md z-10">
          <Button
            class="size-6 i-lucide:plus hover:bg-blue-5 active:bg-blue-6"
            onClick={createPreset}
          />
          <Button class="size-6 i-lucide:folder-plus hover:bg-blue-5 active:bg-blue-6" />
          <div class="flex-1" />
          <Button
            class="size-6 i-lucide:trash2 hover:bg-red-5 active:bg-red-6"
            onClick={removePreset}
          />
        </div>
        <div class="size-full flex flex-col overflow-hidden">
          <div class="size-full gap-1 overflow-auto p-1">
            <For each={config.presets}>
              {(_, i) => (
                <PresetCard
                  preset_idx={i()}
                  selected={i() === currentText().presetId}
                  onClick={() => {
                    setTextPresetIdx(i());
                  }}
                />
              )}
            </For>
          </div>
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
            class="transition-all rounded-md bg-white border border-slate-2 bg-transparent shadow-sm"
          >
            <Accordion.Header>
              <Accordion.Trigger
                class={`w-full flex select-none justify-between bg-transparent items-center hover:bg-white p1 px2 rounded-md ${style.trigger}`}
              >
                {t1("preset.title")}
                <div class={`i-lucide:chevron-down size-5 ${style.icon}`} />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content
              class={`${style.accordion_content} b-t b-slate-2 py0 px2 flex flex-col`}
            >
              <Show
                when={currentPreset()}
                fallback={
                  <div class="text-sm text-slate-5 p1 select-none cursor-default">
                    {config.presets?.length
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
                  <TextField.Input class="p1 px2 w-full b b-slate-2 rounded-md outline-none focus:b-blue-5" />
                </TextField>
                {/* TODO: Don't repeat yourself */}
                <OptionSelector
                  name={t1("preset.speaker")}
                  options={availableSpeakerNames()}
                  value={curMeta()?.name ?? ""}
                  onChange={selectSpeakerByName}
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
      </Show>

      <ToggleGroup
        class="flex items-center justify-start p-2 pl-0"
        value={uiStore.page}
        onChange={(v) => {
          setUIStore("page", v as PageType);
        }}
      >
        <ToggleGroup.Item
          value="config"
          class="group size-8 p1 rounded-lg bg-white shadow-md hover:bg-blue-5 ui-pressed:bg-blue-5 transition-transform"
        >
          <div class="i-lucide:cog bg-slate-8 size-full group-hover:bg-white ui-pressed:!bg-white" />
        </ToggleGroup.Item>
      </ToggleGroup>
    </div>
  );
}

function OptionSelector(props: {
  name: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
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
          class="p1 flex flex-row items-center justify-between rounded-md ui-highlighted:(bg-blue-5 text-white) cursor-pointer"
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
      <Select.Trigger
        class="flex flex-row items-center justify-between px2 w-full bg-white
                        h-8 bg-transparent border border-slate-2 rounded-md
                        hover:(bg-slate-1)"
      >
        <Select.Value<string>>{(state) => state.selectedOption()}</Select.Value>
        <Select.Icon>
          <div class="size-4 i-lucide:chevrons-up-down" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content class="bg-white w-full rounded-lg border border-slate-2 overflow-y-auto max-h-[50vh]">
          <Select.Listbox class="bg-white flex flex-col p1 overflow-y-hidden" />
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
            class="size-4 rounded-sm b b-slate-3 mr-1 ui-checked:(!b-blue-5 bg-blue-5)"
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
        <Slider.Track class="w-full h-2 bg-slate-2 rounded-full relative ui-disabled:cursor-not-allowed">
          <Slider.Fill class="absolute bg-blue-5 rounded-full h-full ui-disabled:bg-blue-2" />
          <Slider.Thumb class="block w-2 h-4 bg-blue-5 ui-disabled:bg-blue-2 rounded-sm -top-1 outline-none">
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
  return (
    <NumberField
      minValue={0}
      maxValue={1500}
      value={props.value}
      step={100}
      onChange={(i) => props.setValue(Number.parseInt(i))}
      changeOnWheel={true}
      format={false}
      title="in millisecond"
      class="w-full"
    >
      <NumberField.Label>{props.label}</NumberField.Label>
      <div class="flex flex-row gap-1 items-center">
        <NumberField.Input class="h-8 w-full outline-none rounded-lg b b-slate-2 focus:b-blue-3 px-1" />
        <div class="flex flex-col">
          <NumberField.IncrementTrigger
            aria-label="Increment"
            class="size-4 bg-transparent group"
          >
            <div class="i-lucide:chevron-up size-full group-hover:bg-blue-5 group-active:bg-blue-7" />
          </NumberField.IncrementTrigger>
          <NumberField.DecrementTrigger
            aria-label="Decrement"
            class="size-4 bg-transparent group"
          >
            <div class="i-lucide:chevron-down size-full group-hover:bg-blue-5 group-active:bg-blue-7" />
          </NumberField.DecrementTrigger>
        </div>
      </div>
    </NumberField>
  );
}

export default Sidebar;
