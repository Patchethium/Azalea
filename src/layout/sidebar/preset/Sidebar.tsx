import { IconButton } from "@components/iconButton";
import { PRESET_PANEL_COLLAPSE_THRESHOLD } from "$constants";
import { usei18n } from "@contexts/i18n";
import Resizable from "@corvu/resizable";
import { PresetManagerDialog } from "@dialogs/PresetManager";
import { SpeakerSelectionDialog } from "@dialogs/SpeakerSelection";
import { Accordion } from "@kobalte/core/accordion";
import { TextField } from "@kobalte/core/text-field";
import { PresetCard } from "@layout/sidebar/preset/Card";
import {
  OptionSelector,
  PauseNumField,
  PresetSlider,
} from "@layout/sidebar/preset/Fields";
import { PresetToolbar } from "@layout/sidebar/preset/Toolbar";
import style from "@layout/sidebar/sidebar.module.css";
import type { SidebarControls } from "@layout/sidebar/useSidebar";
import { batch, createEffect, For, type JSX, Show } from "solid-js";

export function PresetSidebar(props: { controls: SidebarControls }) {
  const { t1 } = usei18n()!;
  const controls = props.controls;
  const PresetSplitter = (
    splitterProps: JSX.HTMLAttributes<HTMLDivElement>,
  ) => {
    const context = Resizable.useContext();
    createEffect(() => {
      if (
        controls.expanded().length > 0 &&
        controls.presetPanelMaxSize() > PRESET_PANEL_COLLAPSE_THRESHOLD &&
        context.sizes()[1] <= PRESET_PANEL_COLLAPSE_THRESHOLD
      ) {
        controls.collapsePresetPanel();
      }
    });
    return <div {...splitterProps} />;
  };

  return (
    <>
      <PresetToolbar controls={controls} />
      <Resizable
        as={PresetSplitter}
        ref={controls.setPresetSplitter}
        orientation="vertical"
        sizes={controls.presetPanelSizes()}
        onSizesChange={(sizes) => {
          if (sizes.length !== 2) return;
          const size = Math.min(sizes[1], controls.presetPanelMaxSize());
          if (Math.abs(controls.presetPanelSizes()[1] - size) > 0.000001) {
            controls.setPresetPanelSizes([1 - size, size]);
          }
          if (
            !controls.resizingPresetPanel() &&
            controls.expanded().length > 0 &&
            size > PRESET_PANEL_COLLAPSE_THRESHOLD
          ) {
            controls.setPresetPanelSize(size);
          }
        }}
        class={`${style.preset_splitter} size-full min-h-0`}
      >
        <Resizable.Panel
          class={`${style.preset_panel} min-h-0 overflow-hidden`}
          minSize={0.1}
        >
          <div class="size-full flex flex-col overflow-hidden">
            <div class="size-full gap-1 overflow-auto pl-0 pr-2 pt-1">
              <For each={controls.projectPresetStore}>
                {(preset, index) => (
                  <PresetCard
                    presetIndex={index()}
                    selected={preset.id === controls.currentText()?.preset_id}
                    onClick={() => controls.setTextPresetIdx(index())}
                  />
                )}
              </For>
            </div>
            <PresetManagerDialog
              open={controls.presetManagerOpen()}
              onOpenChange={controls.setPresetManagerOpen}
            />
          </div>
        </Resizable.Panel>
        <Resizable.Handle
          ref={controls.setPresetResizeHandle}
          onHandleDragStart={() => controls.setResizingPresetPanel(true)}
          onHandleDragEnd={controls.finishPresetPanelResize}
          onKeyDown={(event) => {
            if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
              controls.setResizingPresetPanel(true);
            }
          }}
          onKeyUp={controls.finishPresetPanelResize}
          aria-label={t1("preset.title")}
          disabled={controls.expanded().length === 0}
          data-collapsed={controls.expanded().length === 0 ? "" : undefined}
          data-resizing={controls.resizingPresetPanel() ? "" : undefined}
          data-preset-editor-resize-handle
          class={`${style.resize_handle} group basis-2 px-[2px] bg-transparent flex items-center justify-center`}
        >
          <div class="w-full h-[1px] rounded transition-colors bg-transparent group-hover:bg-primary-5 group-active:bg-primary-5" />
        </Resizable.Handle>
        <Resizable.Panel
          class={`${style.preset_panel} min-h-[30px] overflow-hidden`}
          minSize={PRESET_PANEL_COLLAPSE_THRESHOLD}
        >
          <Accordion
            collapsible
            multiple
            defaultValue={["preset"]}
            value={controls.expanded()}
            onChange={(value) => {
              if (value.length === 0) {
                controls.collapsePresetPanel();
                return;
              }
              const size = Math.min(
                controls.presetPanelSize(),
                controls.presetPanelMaxSize(),
              );
              batch(() => {
                controls.setExpanded(value);
                controls.setPresetPanelSizes([1 - size, size]);
              });
            }}
            class="h-full"
          >
            <Accordion.Item
              value="preset"
              class="h-full min-h-0 flex flex-col transition-all rounded-md bg-white dark:bg-slate-8 border border-slate-2 dark:border-slate-6 bg-transparent shadow-sm"
            >
              <Accordion.Header
                ref={controls.setPresetPanelHeader}
                data-preset-editor-header
                class="shrink-0"
              >
                <Accordion.Trigger
                  class={`w-full flex select-none justify-between bg-transparent items-center hover:bg-white dark:hover:bg-slate-7 p1 px2 rounded-md ${style.trigger}`}
                >
                  {t1("preset.title")}
                  <div class={`i-lucide:chevron-down size-5 ${style.icon}`} />
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content
                class={`${style.accordion_content} min-h-0 flex-1 b-t b-slate-2 dark:b-slate-6 py0 px2 flex flex-col`}
              >
                <div
                  ref={controls.setPresetPanelContent}
                  data-preset-editor-content
                  class="flex flex-col"
                >
                  <Show
                    when={controls.currentPreset()}
                    fallback={
                      <div class="text-sm text-slate-5 p1 select-none cursor-default">
                        {controls.projectPresetStore.length
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
                      value={controls.currentPreset()?.name}
                      onChange={controls.setPresetName}
                    >
                      <TextField.Input
                        placeholder={t1("preset.placeholder_name")}
                        class="p1 px2 w-full b b-slate-2 dark:(b-slate-6 bg-slate-7) rounded-md outline-none focus:b-primary-5"
                      />
                    </TextField>
                    <OptionSelector
                      name={t1("preset.speaker")}
                      options={controls.availableSpeakerNames()}
                      value={controls.curMeta()?.name ?? ""}
                      onChange={controls.selectSpeakerByName}
                      action={
                        <IconButton
                          icon="i-lucide:layout-grid"
                          iconSize="sm"
                          label={t1("speaker_selection.open")}
                          size="lg"
                          class="b b-slate-2 dark:b-slate-6"
                          onClick={() => controls.setSpeakerSelectionOpen(true)}
                        />
                      }
                    />
                    <OptionSelector
                      name={t1("preset.style")}
                      options={controls.availableStyleNames()}
                      value={controls.curStyle()?.name ?? ""}
                      onChange={controls.setStyleByName}
                    />
                    <PresetSlider
                      name={t1("preset.speed")}
                      min={50}
                      max={200}
                      step={1}
                      appendix="%"
                      value={controls.speed()!}
                      setValue={controls.setSpeed}
                    />
                    <PresetSlider
                      name={t1("preset.pitch")}
                      min={-0.5}
                      max={0.5}
                      step={0.01}
                      value={controls.pitch()!}
                      setValue={controls.setPitch}
                    />
                    <PresetSlider
                      name={t1("preset.intonation")}
                      min={0}
                      max={2}
                      step={0.01}
                      value={controls.intonation()!}
                      setValue={controls.setIntonation}
                    />
                    <PresetSlider
                      name={t1("preset.volume")}
                      min={0}
                      max={2}
                      step={0.01}
                      value={controls.volume()!}
                      setValue={controls.setVolume}
                    />
                    <div class="flex flex-row gap2">
                      <PauseNumField
                        label={t1("preset.start_sli")}
                        value={controls.startSli()}
                        setValue={controls.setStartSli}
                      />
                      <PauseNumField
                        label={t1("preset.end_sli")}
                        value={controls.endSli()}
                        setValue={controls.setEndSli}
                      />
                    </div>
                    <div class="h-2 w-full" />
                  </Show>
                </div>
              </Accordion.Content>
            </Accordion.Item>
          </Accordion>
        </Resizable.Panel>
      </Resizable>
      <SpeakerSelectionDialog
        open={controls.speakerSelectionOpen()}
        onOpenChange={controls.setSpeakerSelectionOpen}
        speakers={controls.metas}
        selectedSpeakerUuid={controls.curMeta()?.speaker_uuid ?? null}
        onSelect={(speaker) => {
          controls.setStyleId(speaker.styles[0].id);
          controls.setSpeakerSelectionOpen(false);
        }}
      />
    </>
  );
}
