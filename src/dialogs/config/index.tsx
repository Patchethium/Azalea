import { AppDialogContent } from "@dialogs/AppContent";
import { AssetCacheSetting } from "@dialogs/config/AssetCacheSetting";
import {
  I18NSelect,
  PrimaryColorPicker,
  ThemeSelect,
} from "@dialogs/config/Basics";
import { ConfigItem } from "@dialogs/config/Item";
import { IconButton } from "@components/iconButton";
import { Dialog } from "@kobalte/core/dialog";
import { NumberField } from "@kobalte/core/number-field";
import { Switch } from "@kobalte/core/switch";
import _ from "lodash";
import { createSignal, Show } from "solid-js";
import {
  DEFAULT_CPU_NUM_THREADS,
  DEFAULT_SYNTHESIS_DELAY_MS,
  MAX_SYNTHESIS_DELAY_MS,
} from "$constants";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { useUIStore } from "@contexts/ui";

export function ConfigPage() {
  const { t1 } = usei18n()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const {
    config,
    setConfig,
    customTitlebarEnabled,
    setCustomTitlebarEnabled,
    playbackTimelineEnabled,
    setPlaybackTimelineEnabled,
    spectrogramPreviewEnabled,
    setSpectrogramPreviewEnabled,
  } = useConfigStore()!;

  return (
    <Dialog
      open={uiStore.page === "config"}
      onOpenChange={(open) => setUIStore("page", open ? "config" : null)}
    >
      <AppDialogContent
        title={t1("config.title")}
        closeLabel={t1("config.close")}
        class="w-[min(90vw,32rem)]"
      >
        <div class="flex-1 overflow-auto px3 pb3">
          <ConfigSectionTitle label={t1("config.general")} />
          <ConfigItem label={t1("config.lang")}>
            <I18NSelect />
          </ConfigItem>
          <ConfigItem label={t1("config.theme")}>
            <ThemeSelect />
          </ConfigItem>
          <ConfigItem label={t1("config.custom_titlebar")}>
            <Switch
              checked={customTitlebarEnabled()}
              onChange={setCustomTitlebarEnabled}
              class="inline-flex items-center select-none cursor-pointer justify-center"
            >
              <Switch.Input
                aria-label={t1("config.custom_titlebar")}
                class="outline-2px"
              />
              <Switch.Control class="bg-slate-3 dark:bg-slate-6 rounded-full w-12 h-6 p1 ui-checked:(bg-primary-5) dark:ui-checked:bg-primary-5">
                <Switch.Thumb class="size-4 rounded-full bg-white transition-transform transition-duration-200 ui-checked:(translate-x-6)" />
              </Switch.Control>
            </Switch>
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
          <ConfigItem label={t1("config.primary_color")}>
            <PrimaryColorPicker />
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
          <ConfigSectionTitle label={t1("config.storage")} />
          <AssetCacheSetting open={uiStore.page === "config"} />
          <ConfigSectionTitle label={t1("config.synthesis")} />
          <ConfigItem label={t1("config.cpu_num_threads")}>
            <CPUThreadSetting />
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
        </div>
      </AppDialogContent>
    </Dialog>
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
  const { config, setConfig, reinitializeCore } = useConfigStore()!;
  const { t1 } = usei18n()!;
  const [status, setStatus] = createSignal<"idle" | "loading" | "error">(
    "idle",
  );
  const [committedThreads, setCommittedThreads] = createSignal(
    config.core?.cpu_num_threads ?? DEFAULT_CPU_NUM_THREADS,
  );
  const threads = () => config.core?.cpu_num_threads ?? DEFAULT_CPU_NUM_THREADS;
  const threadsChanged = () => threads() !== committedThreads();

  const updateThreads = (value: string) => {
    if (status() === "error") setStatus("idle");
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && config.core !== null) {
      setConfig(
        "core",
        "cpu_num_threads",
        Math.min(Math.max(parsed, 0), 65535),
      );
    }
  };

  const reinit = async () => {
    setStatus("loading");
    const ok = await reinitializeCore();
    setStatus(ok ? "idle" : "error");
    if (ok) {
      setCommittedThreads(threads());
    }
  };

  return (
    <div class="flex items-center gap-2">
      <IconButton
        icon={
          status() === "loading"
            ? "i-lucide:loader-circle animate-spin"
            : status() === "error"
              ? "i-lucide:triangle-alert text-red-6 dark:text-red-4"
              : "i-lucide:refresh-cw"
        }
        label={t1("config.reinitialize_core")}
        disabled={
          status() === "loading" || config.core === null || !threadsChanged()
        }
        onClick={() => void reinit()}
      />
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

function ConfigSectionTitle(props: { label: string }) {
  return (
    <h2 class="px2 pb1 pt4 first:pt1 text-xs font-semibold uppercase tracking-wide text-slate-5 dark:text-slate-4">
      {props.label}
    </h2>
  );
}

export default ConfigPage;
export { I18NSelect };
