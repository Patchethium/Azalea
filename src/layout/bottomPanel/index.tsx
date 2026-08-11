import { Tabs } from "@kobalte/core/tabs";
import { ControlBar } from "@layout/bottomPanel/ControlBar";
import { PhonemePanel } from "@layout/bottomPanel/PhonemePanel";
import { TuningPanel } from "@layout/bottomPanel/tuning/Panel";
import type { WaveformSynthesisNotice } from "@layout/bottomPanel/types";
import { createSignal, Show } from "solid-js";
import { usei18n } from "../../contexts/i18n";
import { useTextStore } from "../../contexts/text";
import { type BottomPanelType, useUIStore } from "../../contexts/ui";

function BottomPanel() {
  const { t1 } = usei18n()!;
  const { selectedTextBlock } = useTextStore()!;
  const [waveformSynthesisNotice, setWaveformSynthesisNotice] =
    createSignal<WaveformSynthesisNotice | null>(null);
  const { uiStore, setUIStore } = useUIStore()!;

  return (
    <Show
      when={selectedTextBlock()}
      fallback={
        <div class="size-full flex items-center justify-center rounded-lg border border-slate-2 bg-white text-sm text-slate-5 dark:(border-slate-6 bg-slate-8 text-slate-4)">
          {t1("bottom.no_block")}
        </div>
      }
    >
      <Tabs
        aria-label="Bottom Panel Tabs"
        class="size-full flex flex-col bg-white dark:bg-slate-8 border border-slate-2 dark:border-slate-6 rounded-lg overflow-hidden outline-none select-none"
        orientation="horizontal"
        value={uiStore.bottomPanel}
        onChange={(panel) =>
          setUIStore("bottomPanel", panel as BottomPanelType)
        }
        defaultValue="accent"
      >
        <ControlBar onWaveformSynthesized={setWaveformSynthesisNotice} />
        <div class="absolute">
          <Tabs.List class="w-full flex flex-row items-center relative p-1 outline-none select-none">
            <Tabs.Trigger
              class="bg-transparent hover:bg-slate-1 dark:hover:bg-slate-7 px-2 rounded-md outline-none select-none"
              value="accent"
            >
              {t1("bottom.accent")}
            </Tabs.Trigger>
            <Tabs.Trigger
              class="bg-transparent hover:bg-slate-1 dark:hover:bg-slate-7 px-2 rounded-md outline-none select-none"
              value="tuning"
            >
              {t1("bottom.tuning")}
            </Tabs.Trigger>
            <Tabs.Indicator class="bg-primary-5 h-1px absolute transition-all bottom-0 left-0" />
          </Tabs.List>
        </div>
        <Tabs.Content class="flex-1 size-full" value="accent">
          <PhonemePanel />
        </Tabs.Content>
        <Tabs.Content class="flex-1 size-full" value="tuning">
          <TuningPanel waveformSynthesisNotice={waveformSynthesisNotice()} />
        </Tabs.Content>
      </Tabs>
    </Show>
  );
}

export { BottomPanel };
export { SpectrogramCanvas } from "@layout/bottomPanel/tuning/Timeline";
