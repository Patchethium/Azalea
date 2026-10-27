import { Tabs } from "@kobalte/core/tabs";
import { ControlBar } from "@layout/bottomPanel/ControlBar";
import { PhonemePanel } from "@layout/bottomPanel/PhonemePanel";
import { PostPanel } from "@layout/bottomPanel/post/Panel";
import { TuningPanel } from "@layout/bottomPanel/tuning/Panel";
import type { WaveformSynthesisNotice } from "@layout/bottomPanel/types";
import { createEffect, createSignal, Show } from "solid-js";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { useTextStore } from "@contexts/text";
import { type BottomPanelType, useUIStore } from "@contexts/ui";

function BottomPanel(props: { disabled?: boolean }) {
  const { t1 } = usei18n()!;
  const { selectedTextBlock } = useTextStore()!;
  const [waveformSynthesisNotice, setWaveformSynthesisNotice] =
    createSignal<WaveformSynthesisNotice | null>(null);
  const { uiStore, setUIStore } = useUIStore()!;
  const { postProcessingEnabled } = useConfigStore()!;
  // The post tab is experimental and hidden unless enabled in the config.
  createEffect(() => {
    if (!postProcessingEnabled() && uiStore.bottomPanel === "post") {
      setUIStore("bottomPanel", "tuning");
    }
  });

  return (
    <fieldset
      disabled={props.disabled}
      aria-disabled={props.disabled}
      aria-label={[
        t1("bottom.accent"),
        t1("bottom.tuning"),
        ...(postProcessingEnabled() ? [t1("bottom.post")] : []),
      ].join(" / ")}
      class="m0 min-w-0 size-full border-0 p0"
    >
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
          class="size-full relative flex flex-col bg-white dark:bg-slate-8 border border-slate-2 dark:border-slate-6 rounded-lg overflow-hidden outline-none select-none"
          orientation="horizontal"
          value={uiStore.bottomPanel}
          onChange={(panel) =>
            setUIStore("bottomPanel", panel as BottomPanelType)
          }
          defaultValue="accent"
        >
          <ControlBar
            disabled={props.disabled}
            onWaveformSynthesized={setWaveformSynthesisNotice}
          />
          <div class="absolute left-0 top-0">
            <Tabs.List class="w-full flex flex-row items-center relative p-1 outline-none select-none">
              <Tabs.Trigger
                disabled={props.disabled}
                class="bg-transparent enabled:hover:bg-slate-1 dark:enabled:hover:bg-slate-7 disabled:cursor-not-allowed px-2 rounded-md outline-none select-none"
                value="accent"
              >
                {t1("bottom.accent")}
              </Tabs.Trigger>
              <Tabs.Trigger
                disabled={props.disabled}
                class="bg-transparent enabled:hover:bg-slate-1 dark:enabled:hover:bg-slate-7 disabled:cursor-not-allowed px-2 rounded-md outline-none select-none"
                value="tuning"
              >
                {t1("bottom.tuning")}
              </Tabs.Trigger>
              <Show when={postProcessingEnabled()}>
                <Tabs.Trigger
                  disabled={props.disabled}
                  class="bg-transparent enabled:hover:bg-slate-1 dark:enabled:hover:bg-slate-7 disabled:cursor-not-allowed px-2 rounded-md outline-none select-none"
                  value="post"
                >
                  {t1("bottom.post")}
                </Tabs.Trigger>
              </Show>
              <Tabs.Indicator class="bg-primary-5 h-1px absolute transition-all bottom-0 left-0" />
            </Tabs.List>
          </div>
          <Tabs.Content
            class="flex-1 size-full"
            value="accent"
            inert={props.disabled}
          >
            <Show
              when={!props.disabled}
              fallback={
                <div class="size-full flex items-center justify-center text-slate-4">
                  {t1("bottom.no_query")}
                </div>
              }
            >
              <PhonemePanel />
            </Show>
          </Tabs.Content>
          <Tabs.Content
            class="flex-1 size-full"
            value="tuning"
            inert={props.disabled}
          >
            <Show
              when={!props.disabled}
              fallback={
                <div class="size-full flex items-center justify-center text-slate-4">
                  {t1("bottom.no_query")}
                </div>
              }
            >
              <TuningPanel
                waveformSynthesisNotice={waveformSynthesisNotice()}
              />
            </Show>
          </Tabs.Content>
          <Show when={postProcessingEnabled()}>
            <Tabs.Content
              class="flex-1 size-full min-h-0"
              value="post"
              inert={props.disabled}
            >
              <Show
                when={!props.disabled}
                fallback={
                  <div class="size-full flex items-center justify-center text-slate-4">
                    {t1("bottom.no_query")}
                  </div>
                }
              >
                <PostPanel />
              </Show>
            </Tabs.Content>
          </Show>
        </Tabs>
      </Show>
    </fieldset>
  );
}

export { BottomPanel };
export { SpectrogramCanvas } from "@layout/bottomPanel/tuning/Timeline";
