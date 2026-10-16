import { commands } from "$binding";
import { NumberField, NumberInput } from "@components/numberField";
import { AppDialogContent } from "@dialogs/AppContent";
import { clipPath, ModelManager, VoiceSetup } from "@dialogs/VoiceSetup";
import { AssetCacheSetting } from "@dialogs/config/AssetCacheSetting";
import {
  FontSelect,
  I18NSelect,
  PitchScaleSelect,
  PitchTuningModeSelect,
  PrimaryColorPicker,
  ThemeSelect,
  TitlebarStyleSelect,
} from "@dialogs/config/Basics";
import { ConfigItem, ConfigSectionTitle } from "@dialogs/config/Item";
import { ShortcutSettings } from "@dialogs/config/Shortcuts";
import { PathButton } from "@components/pathButton";
import { useToasts } from "@components/toast";
import { AppButton } from "@components/button";
import { Tooltip } from "@components/tooltip";
import { Button } from "@kobalte/core/button";
import { Dialog } from "@kobalte/core/dialog";
import { Switch } from "@kobalte/core/switch";
import { Tabs } from "@kobalte/core/tabs";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import _ from "lodash";
import { createSignal, For, Show } from "solid-js";
import {
  DEFAULT_PITCH_DRIFT_RANGE,
  DEFAULT_PITCH_NOISE_SIGMA,
  DEFAULT_PITCH_TUNING_MODE,
  DEFAULT_SYNTHESIS_DELAY_MS,
  MAX_PITCH_DRIFT_RANGE,
  MAX_PITCH_NOISE_SIGMA,
  MIN_PITCH_DRIFT_RANGE,
  MAX_SYNTHESIS_DELAY_MS,
} from "$constants";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { type ConfigSection, useUIStore } from "@contexts/ui";

const configSections = [
  {
    value: "interface",
    label: "config.ui",
    icon: "i-lucide:palette",
  },
  {
    value: "project",
    label: "config.project_export",
    icon: "i-lucide:folder-output",
  },
  {
    value: "voice",
    label: "config.voice",
    icon: "i-lucide:audio-lines",
  },
  {
    value: "synthesis",
    label: "config.synthesis",
    icon: "i-lucide:cpu",
  },
  {
    value: "shortcuts",
    label: "shortcuts.title",
    icon: "i-lucide:keyboard",
  },
] as const satisfies readonly {
  value: ConfigSection;
  label: string;
  icon: string;
}[];

const contentClass = "min-w-0 flex-1 overflow-y-auto px3 pb3 outline-none";

export function ConfigPage() {
  const { t1 } = usei18n()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const {
    config,
    setConfig,
    pitchRulerEnabled,
    setPitchRulerEnabled,
    playbackTimelineEnabled,
    setPlaybackTimelineEnabled,
    spectrogramPreviewEnabled,
    setSpectrogramPreviewEnabled,
    setupSource,
  } = useConfigStore()!;

  return (
    <Dialog
      open={uiStore.page === "config"}
      onOpenChange={(open) => setUIStore("page", open ? "config" : null)}
    >
      <AppDialogContent
        title={t1("config.title")}
        closeLabel={t1("config.close")}
        class="h-[min(80vh,36rem)] w-[min(90vw,44rem)]"
      >
        <Tabs
          orientation="vertical"
          value={uiStore.configSection}
          onChange={(value) =>
            setUIStore("configSection", value as ConfigSection)
          }
          class="flex min-h-0 flex-1"
        >
          <Tabs.List
            aria-label={t1("config.sections")}
            class="flex w-44 shrink-0 flex-col gap1 overflow-y-auto b-r b-slate-2 p2 outline-none select-none dark:b-slate-6"
          >
            <For each={configSections}>
              {(section) => (
                <Tabs.Trigger
                  value={section.value}
                  class="flex items-center gap2 rounded-md bg-transparent px2 py1.5 text-left text-sm outline-none hover:bg-primary-1 dark:hover:bg-primary-9 focus-visible:(ring-2 ring-primary-2) ui-selected:(bg-primary-5 text-white hover:bg-primary-6) dark:ui-selected:(bg-primary-5 hover:bg-primary-6)"
                >
                  <div
                    aria-hidden="true"
                    class={`${section.icon} size-4 shrink-0`}
                  />
                  {t1(section.label)}
                </Tabs.Trigger>
              )}
            </For>
          </Tabs.List>
          <Tabs.Content value="interface" class={contentClass}>
            <ConfigItem label={t1("config.lang")}>
              <I18NSelect />
            </ConfigItem>
            <ConfigItem label={t1("config.font")}>
              <FontSelect />
            </ConfigItem>
            <ConfigItem label={t1("config.theme")}>
              <ThemeSelect />
            </ConfigItem>
            <ConfigItem label={t1("config.titlebar_style")}>
              <TitlebarStyleSelect />
            </ConfigItem>
            <ConfigItem label={t1("config.playback_timeline")}>
              <Switch
                checked={playbackTimelineEnabled()}
                onChange={setPlaybackTimelineEnabled}
                class="inline-flex items-center select-none cursor-pointer justify-center"
              >
                <Switch.Input
                  aria-label={t1("config.playback_timeline")}
                  class="outline-2px"
                />
                <Switch.Control class="bg-slate-3 dark:bg-slate-6 rounded-full w-12 h-6 p1 ui-checked:(bg-primary-5) dark:ui-checked:bg-primary-5">
                  <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:(translate-x-6)" />
                </Switch.Control>
              </Switch>
            </ConfigItem>
            <ConfigItem label={t1("config.pitch_ruler")}>
              <Switch
                checked={pitchRulerEnabled()}
                onChange={setPitchRulerEnabled}
                class="inline-flex items-center select-none cursor-pointer justify-center"
              >
                <Switch.Input
                  aria-label={t1("config.pitch_ruler")}
                  class="outline-2px"
                />
                <Switch.Control class="bg-slate-3 dark:bg-slate-6 rounded-full w-12 h-6 p1 ui-checked:(bg-primary-5) dark:ui-checked:bg-primary-5">
                  <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:(translate-x-6)" />
                </Switch.Control>
              </Switch>
            </ConfigItem>
            <ConfigItem label={t1("config.pitch_scale")}>
              <PitchScaleSelect />
            </ConfigItem>
            <ConfigItem
              label={t1("config.pitch_tuning_mode")}
              description={t1("config.pitch_tuning_description")}
            >
              <PitchTuningModeSelect />
            </ConfigItem>
            <Show
              when={
                (config.ui.pitch_tuning_mode ?? DEFAULT_PITCH_TUNING_MODE) ===
                "Relative"
              }
            >
              <ConfigItem label={t1("config.pitch_drift_range")} nested>
                <div class="flex items-center gap1">
                  <Show
                    when={
                      (config.ui.pitch_drift_range ??
                        DEFAULT_PITCH_DRIFT_RANGE) !== DEFAULT_PITCH_DRIFT_RANGE
                    }
                  >
                    <Tooltip content={t1("config.reset_pitch_drift_range")}>
                      <button
                        type="button"
                        aria-label={t1("config.reset_pitch_drift_range")}
                        onClick={() =>
                          setConfig(
                            "ui",
                            "pitch_drift_range",
                            DEFAULT_PITCH_DRIFT_RANGE,
                          )
                        }
                        class="size-8 flex items-center justify-center rounded-md bg-transparent outline-none hover:bg-slate-1 focus-visible:(ring-2 ring-primary-2) dark:hover:bg-slate-7"
                      >
                        <div class="i-lucide:rotate-ccw size-4" />
                      </button>
                    </Tooltip>
                  </Show>
                  <div class="w-28">
                    <NumberInput
                      label={t1("config.pitch_drift_range")}
                      hideLabel
                      value={
                        config.ui.pitch_drift_range ?? DEFAULT_PITCH_DRIFT_RANGE
                      }
                      setValue={(value) =>
                        setConfig("ui", "pitch_drift_range", value)
                      }
                      min={MIN_PITCH_DRIFT_RANGE}
                      max={MAX_PITCH_DRIFT_RANGE}
                      step={1}
                    />
                  </div>
                </div>
              </ConfigItem>
            </Show>
            <ConfigItem label={t1("config.primary_color")}>
              <PrimaryColorPicker />
            </ConfigItem>
          </Tabs.Content>
          <Tabs.Content value="project" class={contentClass}>
            <ConfigSectionTitle label={t1("config.project")} />
            <ConfigItem label={t1("config.auto_save")}>
              <Switch
                checked={config.ui.auto_save ?? false}
                onChange={(value) => setConfig("ui", "auto_save", value)}
                class="inline-flex items-center select-none cursor-pointer justify-center"
              >
                <Switch.Input
                  aria-label={t1("config.auto_save")}
                  class="outline-2px"
                />
                <Switch.Control class="bg-slate-3 dark:bg-slate-6 rounded-full w-12 h-6 p1 ui-checked:(bg-primary-5) dark:ui-checked:bg-primary-5">
                  <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:(translate-x-6)" />
                </Switch.Control>
              </Switch>
            </ConfigItem>
            <ConfigSectionTitle label={t1("config.audio_export")} />
            <ConfigItem label={t1("config.default_export_dir")}>
              <Switch
                checked={config.ui.default_export_dir_enabled ?? false}
                onChange={(v) =>
                  setConfig("ui", "default_export_dir_enabled", v)
                }
                class="inline-flex items-center select-none cursor-pointer justify-center"
              >
                <Switch.Input
                  aria-label={t1("config.enable_export_dir")}
                  class="outline-2px"
                />
                <Switch.Control class="bg-slate-3 dark:bg-slate-6 rounded-full w-12 h-6 p1 ui-checked:(bg-primary-5) dark:ui-checked:bg-primary-5">
                  <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:(translate-x-6)" />
                </Switch.Control>
              </Switch>
            </ConfigItem>
            <Show when={config.ui.default_export_dir_enabled}>
              <ConfigItem label={t1("config.export_dir_path")} nested>
                <DefaultExportDirSetting />
              </ConfigItem>
              <ConfigItem label={t1("config.silent_save")} nested>
                <Switch
                  checked={config.ui.silent_save ?? false}
                  disabled={config.ui.default_export_dir == null}
                  onChange={(value) => setConfig("ui", "silent_save", value)}
                  class="inline-flex cursor-pointer select-none items-center justify-center ui-disabled:(cursor-not-allowed opacity-50)"
                >
                  <Switch.Input
                    aria-label={t1("config.silent_save")}
                    class="outline-2px"
                  />
                  <Switch.Control class="h-6 w-12 rounded-full bg-slate-3 p1 ui-checked:bg-primary-5 dark:bg-slate-6 dark:ui-checked:bg-primary-5">
                    <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:translate-x-6" />
                  </Switch.Control>
                </Switch>
              </ConfigItem>
            </Show>
            <ConfigItem label={t1("config.prevent_overwrite")}>
              <Switch
                checked={config.ui.prevent_overwrite ?? false}
                onChange={(value) =>
                  setConfig("ui", "prevent_overwrite", value)
                }
                class="inline-flex cursor-pointer select-none items-center justify-center"
              >
                <Switch.Input
                  aria-label={t1("config.prevent_overwrite")}
                  class="outline-2px"
                />
                <Switch.Control class="h-6 w-12 rounded-full bg-slate-3 p1 ui-checked:bg-primary-5 dark:bg-slate-6 dark:ui-checked:bg-primary-5">
                  <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:translate-x-6" />
                </Switch.Control>
              </Switch>
            </ConfigItem>
            <ConfigItem label={t1("config.export_text")}>
              <Switch
                checked={config.ui.export_text ?? true}
                onChange={(value) => setConfig("ui", "export_text", value)}
                class="inline-flex cursor-pointer select-none items-center justify-center"
              >
                <Switch.Input
                  aria-label={t1("config.export_text")}
                  class="outline-2px"
                />
                <Switch.Control class="h-6 w-12 rounded-full bg-slate-3 p1 ui-checked:bg-primary-5 dark:bg-slate-6 dark:ui-checked:bg-primary-5">
                  <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:translate-x-6" />
                </Switch.Control>
              </Switch>
            </ConfigItem>
            <ConfigItem label={t1("config.export_lab")}>
              <Switch
                checked={config.ui.export_lab ?? false}
                onChange={(value) => setConfig("ui", "export_lab", value)}
                class="inline-flex cursor-pointer select-none items-center justify-center"
              >
                <Switch.Input
                  aria-label={t1("config.export_lab")}
                  class="outline-2px"
                />
                <Switch.Control class="h-6 w-12 rounded-full bg-slate-3 p1 ui-checked:bg-primary-5 dark:bg-slate-6 dark:ui-checked:bg-primary-5">
                  <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:translate-x-6" />
                </Switch.Control>
              </Switch>
            </ConfigItem>
            <ConfigItem label={t1("config.truncation_len")}>
              <NumberField
                minValue={0}
                step={1}
                value={config.ui.name_truncation_len}
                onChange={(v) =>
                  setConfig("ui", "name_truncation_len", Number.parseInt(v, 10))
                }
                changeOnWheel={true}
                format={false}
                class="flex flex-row items-center justify-center gap-1"
              >
                <Show when={config.ui.name_truncation_len === 0}>
                  <NumberField.Label class="text-slate-6">
                    {_.capitalize(t1("config.no_truncation"))}
                  </NumberField.Label>
                </Show>
                <div class="flex flex-row gap-1 items-center w-16">
                  <NumberField.Input class="h-8 w-full outline-none rounded-lg b b-slate-2 dark:(b-slate-6 bg-slate-8) focus:b-primary-3 px-1" />
                  <div class="flex flex-col">
                    <NumberField.IncrementTrigger
                      aria-label="Increment"
                      class="size-4 bg-transparent group"
                    >
                      <div class="i-lucide:chevron-up size-full group-hover:bg-primary-5 group-active:bg-primary-7" />
                    </NumberField.IncrementTrigger>
                    <NumberField.DecrementTrigger
                      aria-label="Decrement"
                      class="size-4 bg-transparent group"
                    >
                      <div class="i-lucide:chevron-down size-full group-hover:bg-primary-5 group-active:bg-primary-7" />
                    </NumberField.DecrementTrigger>
                  </div>
                </div>
              </NumberField>
            </ConfigItem>
          </Tabs.Content>
          {/* Stay mounted so switching sections keeps running downloads. */}
          <Tabs.Content
            value="voice"
            forceMount
            hidden={uiStore.configSection !== "voice"}
            class={contentClass}
            // The model manager's sticky footer sits flush with the bottom
            // edge; scroll padding would leave a gap below it.
            classList={{ "!pb0": setupSource() === "Downloaded" }}
          >
            <VoiceSetup />
            <Show when={setupSource() === "Downloaded"}>
              <ModelManager active={uiStore.page === "config"} />
            </Show>
            {/* Managed downloads keep icons alongside their models. */}
            <Show when={setupSource() !== "Downloaded"}>
              <ConfigSectionTitle label={t1("config.storage")} />
              <AssetCacheSetting open={uiStore.page === "config"} />
            </Show>
          </Tabs.Content>
          <Tabs.Content value="synthesis" class={contentClass}>
            <ConfigItem label={t1("config.cpu_num_threads")}>
              <CPUThreadSetting />
            </ConfigItem>
            <ConfigItem
              label={t1("config.pitch_noise_enabled")}
              description={t1("config.pitch_noise_description")}
              experimental
            >
              <Switch
                checked={config.ui.pitch_noise_enabled ?? false}
                onChange={(value) =>
                  setConfig("ui", "pitch_noise_enabled", value)
                }
                class="inline-flex items-center select-none cursor-pointer justify-center"
              >
                <Switch.Input
                  aria-label={t1("config.pitch_noise_enabled")}
                  class="outline-2px"
                />
                <Switch.Control class="bg-slate-3 dark:bg-slate-6 rounded-full w-12 h-6 p1 ui-checked:(bg-primary-5) dark:ui-checked:bg-primary-5">
                  <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:(translate-x-6)" />
                </Switch.Control>
              </Switch>
            </ConfigItem>
            <Show when={config.ui.pitch_noise_enabled}>
              <ConfigItem label={t1("config.pitch_noise_sigma")} nested>
                <div class="flex items-center gap1">
                  <Show
                    when={
                      (config.ui.pitch_noise_sigma ??
                        DEFAULT_PITCH_NOISE_SIGMA) !== DEFAULT_PITCH_NOISE_SIGMA
                    }
                  >
                    <Tooltip content={t1("config.reset_pitch_noise_sigma")}>
                      <button
                        type="button"
                        aria-label={t1("config.reset_pitch_noise_sigma")}
                        onClick={() =>
                          setConfig(
                            "ui",
                            "pitch_noise_sigma",
                            DEFAULT_PITCH_NOISE_SIGMA,
                          )
                        }
                        class="size-8 flex items-center justify-center rounded-md bg-transparent outline-none hover:bg-slate-1 focus-visible:(ring-2 ring-primary-2) dark:hover:bg-slate-7"
                      >
                        <div class="i-lucide:rotate-ccw size-4" />
                      </button>
                    </Tooltip>
                  </Show>
                  <div class="w-28">
                    <NumberInput
                      label={t1("config.pitch_noise_sigma")}
                      hideLabel
                      decimal
                      value={
                        config.ui.pitch_noise_sigma ?? DEFAULT_PITCH_NOISE_SIGMA
                      }
                      setValue={(value) =>
                        setConfig("ui", "pitch_noise_sigma", value)
                      }
                      min={0}
                      max={MAX_PITCH_NOISE_SIGMA}
                      step={0.01}
                    />
                  </div>
                </div>
              </ConfigItem>
            </Show>
            <ConfigItem
              label={t1("config.pitch_completion_enabled")}
              description={t1("config.pitch_completion_description")}
              experimental
            >
              <Switch
                checked={config.ui.pitch_completion_enabled ?? false}
                onChange={(value) =>
                  setConfig("ui", "pitch_completion_enabled", value)
                }
                class="inline-flex items-center select-none cursor-pointer justify-center"
              >
                <Switch.Input
                  aria-label={t1("config.pitch_completion_enabled")}
                  class="outline-2px"
                />
                <Switch.Control class="bg-slate-3 dark:bg-slate-6 rounded-full w-12 h-6 p1 ui-checked:bg-primary-5 dark:ui-checked:bg-primary-5">
                  <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:translate-x-6" />
                </Switch.Control>
              </Switch>
            </ConfigItem>
            <ConfigItem label={t1("config.background_buffering")} experimental>
              <Switch
                checked={config.ui.buffer_render}
                onChange={(v) => setConfig("ui", "buffer_render", v)}
                class="inline-flex items-center select-none cursor-pointer justify-center"
              >
                <Switch.Input
                  aria-label={t1("config.background_buffering")}
                  class="outline-2px"
                />
                <Switch.Control class="bg-slate-3 dark:bg-slate-6 rounded-full w-12 h-6 p1 ui-checked:(bg-primary-5) dark:ui-checked:bg-primary-5">
                  <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:(translate-x-6)" />
                </Switch.Control>
              </Switch>
            </ConfigItem>
            <Show when={config.ui.buffer_render}>
              <ConfigItem label={t1("config.synthesis_delay")} nested>
                <SynthesisDelayField />
              </ConfigItem>
              <ConfigItem
                label={t1("config.nonblocking_synthesis")}
                experimental
                nested
              >
                <Switch
                  checked={config.ui.nonblocking_synthesis}
                  onChange={(v) => setConfig("ui", "nonblocking_synthesis", v)}
                  class="inline-flex items-center select-none cursor-pointer justify-center"
                >
                  <Switch.Input
                    aria-label={t1("config.nonblocking_synthesis")}
                    class="outline-2px"
                  />
                  <Switch.Control class="bg-slate-3 dark:bg-slate-6 rounded-full w-12 h-6 p1 ui-checked:(bg-primary-5) dark:ui-checked:bg-primary-5">
                    <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:(translate-x-6)" />
                  </Switch.Control>
                </Switch>
              </ConfigItem>
            </Show>
            <ConfigItem label={t1("config.spectrogram_preview")} experimental>
              <Switch
                checked={spectrogramPreviewEnabled()}
                onChange={setSpectrogramPreviewEnabled}
                class="inline-flex items-center select-none cursor-pointer justify-center"
              >
                <Switch.Input
                  aria-label={t1("config.spectrogram_preview")}
                  class="outline-2px"
                />
                <Switch.Control class="bg-slate-3 dark:bg-slate-6 rounded-full w-12 h-6 p1 ui-checked:(bg-primary-5) dark:ui-checked:bg-primary-5">
                  <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:(translate-x-6)" />
                </Switch.Control>
              </Switch>
            </ConfigItem>
          </Tabs.Content>
          <Tabs.Content value="shortcuts" class={contentClass}>
            <ShortcutSettings />
          </Tabs.Content>
        </Tabs>
        <div class="flex justify-end b-t b-slate-2 px3 py2 dark:b-slate-6">
          <Button
            type="button"
            onClick={() => void commands.openConfigDir()}
            class="flex items-center gap1 rounded-md bg-transparent px2 py1 text-sm outline-none hover:bg-slate-2 focus-visible:(ring-2 ring-primary-2) dark:hover:bg-slate-7"
          >
            <div class="i-lucide:folder-open size-4" />
            {t1("config.open_config_dir")}
          </Button>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}

function DefaultExportDirSetting() {
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;
  const toasts = useToasts();
  const [picking, setPicking] = createSignal(false);
  const dir = () => config.ui.default_export_dir;

  const pick = async () => {
    setPicking(true);
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: dir() ?? undefined,
    });
    setPicking(false);
    if (typeof selected === "string") {
      setConfig("ui", "default_export_dir", selected);
      setConfig("ui", "default_export_dir_enabled", true);
    }
  };

  const openDir = async (path: string) => {
    try {
      const result = await commands.openPathLocation(path);
      if (result.status === "error") {
        toasts.error(t1("toast.error.open_output_dir"), result.error);
      }
    } catch (error) {
      toasts.error(t1("toast.error.open_output_dir"), error);
    }
  };

  return (
    <div class="flex min-w-0 items-center gap-1">
      <Show
        when={dir()}
        fallback={
          <span class="text-sm text-slate-5 dark:text-slate-4">
            {t1("config.no_default_export_dir")}
          </span>
        }
      >
        {(path) => (
          <PathButton
            path={path()}
            display={clipPath(path())}
            class="max-w-48"
            onClick={() => void openDir(path())}
          />
        )}
      </Show>
      <Tooltip content={t1("config.pick_export_dir")}>
        <AppButton
          size="sm"
          disabled={picking()}
          aria-busy={picking()}
          aria-label={t1("config.pick_export_dir")}
          onClick={() => void pick()}
          class="flex shrink-0 items-center gap1"
        >
          <div
            aria-hidden="true"
            class={
              picking()
                ? "i-lucide:loader-circle size-4 animate-spin"
                : "i-lucide:folder-open size-4"
            }
          />
          {t1("config.pick_export_dir_short")}
        </AppButton>
      </Tooltip>
    </div>
  );
}

function SynthesisDelayField() {
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;
  const delay = () =>
    config.ui.synthesis_delay_ms ?? DEFAULT_SYNTHESIS_DELAY_MS;
  return (
    <NumberField
      minValue={0}
      maxValue={MAX_SYNTHESIS_DELAY_MS}
      step={50}
      value={delay()}
      onChange={(value) => {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
          setConfig(
            "ui",
            "synthesis_delay_ms",
            Math.min(Math.max(parsed, 0), MAX_SYNTHESIS_DELAY_MS),
          );
        }
      }}
      changeOnWheel={true}
      format={false}
      class="flex items-center gap-2"
    >
      <div class="flex w-24 items-center gap-1">
        <NumberField.Input
          aria-label={t1("config.synthesis_delay")}
          class="h-8 w-full rounded-lg b b-slate-2 px-1 outline-none focus:b-primary-3 dark:(b-slate-6 bg-slate-8)"
        />
        <div class="flex flex-col">
          <NumberField.IncrementTrigger
            aria-label="Increment"
            class="size-4 bg-transparent group"
          >
            <div class="i-lucide:chevron-up size-full group-hover:bg-primary-5 group-active:bg-primary-7" />
          </NumberField.IncrementTrigger>
          <NumberField.DecrementTrigger
            aria-label="Decrement"
            class="size-4 bg-transparent group"
          >
            <div class="i-lucide:chevron-down size-full group-hover:bg-primary-5 group-active:bg-primary-7" />
          </NumberField.DecrementTrigger>
        </div>
      </div>
      <span class="text-sm text-slate-5 dark:text-slate-4">
        {t1("config.milliseconds")}
      </span>
    </NumberField>
  );
}

function CPUThreadSetting() {
  const {
    cpuNumThreads,
    setCpuNumThreads,
    setupChangePending,
    coreSwitching,
    reinitializeCore,
    committedCpuNumThreads,
  } = useConfigStore()!;
  const { t1 } = usei18n()!;
  const [status, setStatus] = createSignal<"idle" | "loading" | "error">(
    "idle",
  );
  const threads = cpuNumThreads;
  const threadsChanged = () =>
    threads() !== (committedCpuNumThreads() ?? threads());

  const updateThreads = (value: string) => {
    if (status() === "error") setStatus("idle");
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed))
      setCpuNumThreads(Math.min(Math.max(parsed, 0), 65535));
  };

  const reinit = async () => {
    setStatus("loading");
    const ok = await reinitializeCore();
    setStatus(ok ? "idle" : "error");
  };

  return (
    <div class="flex items-center gap-2">
      <Show when={threadsChanged()}>
        <Tooltip content={t1("config.reinitialize_core")}>
          <Button
            type="button"
            aria-label={t1("config.reinitialize_core")}
            disabled={
              status() === "loading" || coreSwitching() || setupChangePending()
            }
            onClick={() => void reinit()}
            class="size-8 flex items-center justify-center rounded-md bg-transparent outline-none hover:bg-slate-1 focus-visible:(ring-2 ring-primary-2) dark:hover:bg-slate-7"
          >
            <div
              class={
                status() === "loading"
                  ? "i-lucide:loader-circle size-4 animate-spin"
                  : status() === "error"
                    ? "i-lucide:triangle-alert size-4 text-red-6 dark:text-red-4"
                    : "i-lucide:refresh-cw size-4"
              }
            />
          </Button>
        </Tooltip>
      </Show>
      <NumberField
        minValue={0}
        maxValue={65535}
        step={1}
        value={threads()}
        onChange={updateThreads}
        changeOnWheel={true}
        format={false}
        class="flex items-center gap-2"
      >
        <div class="flex w-24 items-center gap-1">
          <NumberField.Input
            aria-label={t1("config.cpu_num_threads")}
            class="h-8 w-full rounded-lg b b-slate-2 px-1 outline-none focus:b-primary-3 dark:(b-slate-6 bg-slate-8)"
          />
          <div class="flex flex-col">
            <NumberField.IncrementTrigger
              aria-label="Increment"
              class="size-4 bg-transparent group"
            >
              <div class="i-lucide:chevron-up size-full group-hover:bg-primary-5 group-active:bg-primary-7" />
            </NumberField.IncrementTrigger>
            <NumberField.DecrementTrigger
              aria-label="Decrement"
              class="size-4 bg-transparent group"
            >
              <div class="i-lucide:chevron-down size-full group-hover:bg-primary-5 group-active:bg-primary-7" />
            </NumberField.DecrementTrigger>
          </div>
        </div>
        <Show when={threads() === 0}>
          <span class="text-sm text-slate-5 dark:text-slate-4">
            {t1("config.auto")}
          </span>
        </Show>
      </NumberField>
    </div>
  );
}

export default ConfigPage;
export { I18NSelect };
