import { usei18n } from "@contexts/i18n";
import { Slider } from "@kobalte/core/slider";
import {
  SpectrogramCanvas,
  TuningItem,
} from "@layout/bottomPanel/tuning/Timeline";
import { useTuningPanel } from "@layout/bottomPanel/tuning/usePanel";
import type {
  DraggingMode,
  WaveformSynthesisNotice,
} from "@layout/bottomPanel/types";
import { For, Show } from "solid-js";

export function TuningPanel(props: {
  waveformSynthesisNotice: WaveformSynthesisNotice | null;
}) {
  const { t1 } = usei18n()!;
  const panel = useTuningPanel(() => props.waveformSynthesisNotice);

  return (
    <>
      <div
        ref={panel.setScrollAreaRef}
        onWheel={panel.handleWheel}
        onScroll={panel.handleScroll}
        data-bottom-panel-scroll="tuning"
        class="size-full relative flex flex-col left-0 top-0 overflow-x-auto overflow-y-hidden cursor-default"
        classList={{
          "!overflow-x-hidden !cursor-ew-resize": panel.draggingData() !== null,
        }}
      >
        <Show
          when={panel.queryExists()}
          fallback={
            <div class="flex size-full items-center justify-center select-none cursor-default">
              {t1("bottom.no_query")}
            </div>
          }
        >
          <div
            class="flex flex-row flex-1 relative"
            onMouseDown={(event) => panel.setStartX(event.clientX)}
            onMouseUp={panel.handleDragFinish}
            onMouseLeave={panel.handleDragFinish}
            onMouseMove={panel.handleDragging}
            style={{ "min-width": "min-content" }}
          >
            <Show when={panel.spectrogram()}>
              {(preview) => (
                <SpectrogramCanvas
                  preview={preview()}
                  width={panel.timelineDuration() * panel.scale()}
                  preSilence={
                    panel.currentModifiedQuery()?.prePhonemeLength ?? 0
                  }
                  postSilence={
                    panel.currentModifiedQuery()?.postPhonemeLength ?? 0
                  }
                  stale={panel.spectrogramStale()}
                />
              )}
            </Show>
            <For each={panel.currentText()?.query?.accent_phrases}>
              {(phrase, phraseIndex) => (
                <>
                  <For each={phrase.moras}>
                    {(mora, moraIndex) => (
                      <TuningItem
                        mora={mora}
                        startDraggingDur={(
                          origin: number,
                          mode: DraggingMode,
                        ) => {
                          panel.setDraggingData({
                            apIndex: phraseIndex(),
                            moraIndex: moraIndex(),
                            originData: origin,
                            mode,
                          });
                        }}
                        setPitch={(pitch) => {
                          if (panel.draggingData() === null) {
                            panel.setPitch(phraseIndex(), moraIndex(), pitch);
                          }
                        }}
                        minPitch={panel.minPitch()}
                        maxPitch={panel.maxPitch()}
                      />
                    )}
                  </For>
                  <Show when={phrase.pause_mora != null}>
                    <TuningItem
                      mora={phrase.pause_mora!}
                      startDraggingDur={(origin) => {
                        panel.setDraggingData({
                          apIndex: phraseIndex(),
                          moraIndex: -1,
                          originData: origin,
                          mode: "pause",
                        });
                      }}
                      setPitch={(duration) =>
                        panel.setPauseLength(phraseIndex(), duration)
                      }
                      minPitch={0}
                      maxPitch={0}
                      isPause
                    />
                  </Show>
                </>
              )}
            </For>
          </div>
        </Show>
      </div>
      <div class="h-6 w-full b-dashed b-slate-3 dark:b-slate-6 flex items-center px-2 justify-between">
        <Show when={panel.queryExists()}>
          <Slider
            class="relative flex flex-col w-20% select-none items-center group"
            minValue={panel.minScale}
            maxValue={panel.maxScale}
            value={[panel.scale()]}
            onChange={(value) => panel.setScale(value[0])}
          >
            <Slider.Track class="w-full h-2 bg-slate-2 dark:bg-slate-6 rounded-full relative">
              <Slider.Fill class="absolute bg-slate-3 dark:bg-slate-5 rounded-full h-full group-hover:bg-primary-5" />
              <Slider.Thumb class="block size-4 bg-transparent rounded-full -top-1 outline-none">
                <Slider.Input />
              </Slider.Thumb>
            </Slider.Track>
          </Slider>
        </Show>
      </div>
    </>
  );
}
