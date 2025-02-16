import { Accordion } from "@kobalte/core/accordion";
import { Button } from "@kobalte/core/button";
import { Checkbox } from "@kobalte/core/checkbox";
import { Select } from "@kobalte/core/select";
import { Slider } from "@kobalte/core/slider";
import { TextField } from "@kobalte/core/text-field";
import { ToggleGroup } from "@kobalte/core/toggle-group";
import _, { set } from "lodash";
import { For, JSX, Show, createMemo, createSignal } from "solid-js";
import { produce } from "solid-js/store";
import { Preset, StyleId } from "../binding";
import { useConfigStore } from "../contexts/config";
import { usei18n } from "../contexts/i18n";
import { useMetaStore } from "../contexts/meta";
import { useTextStore } from "../contexts/text";
import { PageType, useUIStore } from "../contexts/ui";
import style from "./sidebar.module.css";

interface CharacterCardProps extends JSX.HTMLAttributes<HTMLDivElement> {
  name: string;
  style: string;
  speaker_id: number;
}

function CharacterCard(props: CharacterCardProps) {
  const { uiStore } = useUIStore()!;
  const { textStore } = useTextStore()!;
  const selected = createMemo(
    () =>
      textStore[uiStore.selectedTextBlockIndex].style_id === props.speaker_id,
  );
  return (
    <div class="flex p-1 group" {...props}>
      <div
        class="flex flex-row justify-between items-center rounded-lg px2 p1 group-hover:bg-slate-2 overflow-hidden bg-slate-1 group-active:(bg-white scale-97) cursor-default select-none w-full"
        classList={{ "!bg-white shadow-md": selected() }}
      >
        <div class="flex flex-col">
          <div class="text-sm">{props.name}</div>
          <div class="text-xs">{props.style}</div>
        </div>
      </div>
    </div>
  );
}

interface PresetCardProps extends JSX.HTMLAttributes<HTMLDivElement> {
  preset: Preset;
}

function PresetCard(props: PresetCardProps) {
  return (
    <div
      class="flex flex-row justify-between items-center rounded-lg px2 p1
       hover:bg-slate-2 overflow-hidden bg-slate-1
        group-active:(bg-white scale-97) cursor-default select-none w-full
        "
      {...props}
    >
      <div>{props.preset.name} - {props.preset.style_id}</div>
    </div>
  );
}

function Sidebar() {
  const { metas, availableSpeakerIds } = useMetaStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const { textStore, setTextStore } = useTextStore()!;
  const { t1 } = usei18n()!;

  const setStyleId = (styleId: StyleId) => {
    if (styleId in availableSpeakerIds()) {
      setTextStore(
        uiStore.selectedTextBlockIndex,
        produce((draft) => {
          draft.style_id = styleId;
        }),
      );
    }
  };

  const [expanded, setExpanded] = createSignal(["preset"]);
  const curText = () => textStore[uiStore.selectedTextBlockIndex];
  const curMeta = () =>
    metas.find((meta) =>
      meta.styles.find((style) => style.id === curText().style_id),
    );
  const curStyle = () =>
    curMeta()?.styles.find((style) => style.id === curText().style_id);
  const availableStyleNames = () =>
    _.flatMap(curMeta()?.styles.map((s) => s.name)) ?? [];
  const setStyleByName = (name: string) => {
    const style = curMeta()?.styles.find((s) => s.name === name);
    if (style) setStyleId(style.id);
  };
  const { config, setConfig } = useConfigStore()!;

  const [speed, setSpeed] = createSignal(50);
  const [pitch, setPitch] = createSignal(0.5);
  const [pauseScaleChecked, setPauseScaleChecked] = createSignal(false);
  const [pauseScale, setPauseScale] = createSignal(0.5);

  const createPreset = () => {
    const preset: Preset = {
      name: "New Preset",
      style_id: curText().style_id ?? 0,
      speed: 100,
      pitch: 0.0,
      pause_scale_enabled: false,
      pause_scale: 100,
      start_slience: 0,
      end_slience: 0,
    };
    setConfig("presets", [...config.presets, preset]);
  };

  return (
    <div class="size-full bg-transparent overflow-y-hidden flex flex-col pl2 pr0">
      <Show
        when={uiStore.page == null}
        fallback={
          <div class="size-full flex flex-col items-start justify-start p-3">
            <div class="text-lg font-bold">{t1("config.title")}</div>
            <div class="text-sm">{t1("config.sidebar_desp")}</div>
          </div>
        }
      >
        <div class="w-auto flex items-center px1 rounded-md bg-white mt-2 p1 shadow-md z-10">
          <Button
            class="size-6 i-lucide:plus hover:bg-blue-5 active:bg-blue-6"
            onClick={createPreset}
          />
          <Button class="size-6 i-lucide:folder-plus hover:bg-blue-5 active:bg-blue-6" />
          <div class="flex-1" />
          <Button class="size-6 i-lucide:trash2 hover:bg-red-5 active:bg-red-6" />
        </div>
        <div class="flex-1 overflow-y-auto py2">
          <For each={config.presets}>
            {(preset) => (
              <PresetCard
                preset={preset}
                onClick={() => {
                  setSpeed(preset.speed);
                  setPitch(preset.pitch);
                  setPauseScaleChecked(preset.pause_scale_enabled);
                  setPauseScale(preset.pause_scale);
                }}
              />
            )}
          </For>
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
                Preset
                <div class={`i-lucide:chevron-down size-5 ${style.icon}`} />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content
              class={`${style.accordion_content} b-t b-slate-2 py0 px2 flex flex-col`}
            >
              <div class="w-full h-1" />
              <span class="text-sm">Character</span>
              {curMeta()?.name ?? ""}
              {/* TODO: Don't repeat yourself */}
              <Select
                options={availableStyleNames()}
                value={curStyle()?.name}
                onChange={(v) => {
                  if (v !== null) setStyleByName(v);
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
                <Select.Label class="text-sm">Style</Select.Label>
                <Select.Trigger
                  class="flex flex-row items-center justify-between px2 w-full bg-white
                        h-8 bg-transparent border border-slate-2 rounded-md
                        hover:(bg-slate-1)"
                >
                  <Select.Value<string>>
                    {(state) => state.selectedOption()}
                  </Select.Value>
                  <Select.Icon>
                    <div class="size-4 i-lucide:chevrons-up-down" />
                  </Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content class="bg-white w-full rounded-lg border border-slate-2">
                    <Select.Listbox class="flex flex-col p1" />
                  </Select.Content>
                </Select.Portal>
              </Select>
              <PresetSlider
                name="Speed"
                min={0}
                max={100}
                step={1}
                appendix="%"
                value={speed()}
                setValue={setSpeed}
              />
              <PresetSlider
                name="Pitch"
                min={-1}
                max={1}
                step={0.1}
                value={pitch()}
                setValue={setPitch}
              />
              <PresetSlider
                name="Variance"
                min={-1}
                max={1}
                step={0.1}
                value={pitch()}
                setValue={setPitch}
              />
              <PresetSlider
                name="Pause Scale"
                min={-1}
                max={1}
                step={0.1}
                checkable={{
                  checked: pauseScaleChecked(),
                  setChecked: setPauseScaleChecked,
                }}
                value={pauseScale()}
                setValue={setPauseScale}
              />
              <PresetSlider
                name="Start Slience"
                min={-1}
                max={1}
                step={0.1}
                value={pitch()}
                setValue={setPitch}
              />
              <PresetSlider
                name="End Slience"
                min={-1}
                max={1}
                step={0.1}
                value={pitch()}
                setValue={setPitch}
              />
              <div class="h-2 w-full" />
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
          class="group size-8 p1 rounded-lg bg-white shadow-md hover:bg-blue-5 ui-pressed:bg-blue-5 transition-transform active:scale-95"
        >
          <div class="i-lucide:cog bg-slate-8 size-full group-hover:bg-white ui-pressed:!bg-white" />
        </ToggleGroup.Item>
      </ToggleGroup>
    </div>
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

export default Sidebar;
