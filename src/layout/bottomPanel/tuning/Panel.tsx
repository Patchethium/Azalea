import type { Mora } from "$binding";
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
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from "solid-js";
import { createVirtualizer, observeElementRect } from "@tanstack/solid-virtual";

type TuningTimelineItem = {
  mora: Mora;
  phraseIndex: number;
  moraIndex: number;
  isPause: boolean;
};

export function TuningPanel(props: {
  waveformSynthesisNotice: WaveformSynthesisNotice | null;
}) {
  const { t1 } = usei18n()!;
  const panel = useTuningPanel(() => props.waveformSynthesisNotice);
  const [scrollElement, setScrollElement] = createSignal<HTMLDivElement | null>(
    null,
  );
  const timelineItems = createMemo<TuningTimelineItem[]>(() =>
    (panel.currentText()?.query?.accent_phrases ?? []).flatMap(
      (phrase, phraseIndex) => [
        ...phrase.moras.map((mora, moraIndex) => ({
          mora,
          phraseIndex,
          moraIndex,
          isPause: false,
        })),
        ...(phrase.pause_mora === null
          ? []
          : [
              {
                mora: phrase.pause_mora,
                phraseIndex,
                moraIndex: -1,
                isPause: true,
              },
            ]),
      ],
    ),
  );
  const itemSizes = createMemo(() =>
    timelineItems().map(
      ({ mora }) =>
        ((mora.consonant_length ?? 0) + mora.vowel_length) * panel.scale(),
    ),
  );
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return timelineItems().length;
    },
    getScrollElement: scrollElement,
    estimateSize: (index) => itemSizes()[index] ?? 0,
    horizontal: true,
    overscan: 5,
    initialRect: { width: 1, height: 1 },
    observeElementRect: (instance, callback) =>
      observeElementRect(instance, (rect) => {
        if (rect.width > 0) callback(rect);
      }),
  });

  createEffect(
    on(
      itemSizes,
      () => {
        virtualizer.measure();
      },
      { defer: true },
    ),
  );

  return (
    <>
      <div
        ref={(element) => {
          panel.setScrollAreaRef(element);
          setScrollElement(element);
        }}
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
            class="flex-1 relative"
            onMouseDown={(event) => panel.setStartX(event.clientX)}
            onMouseUp={panel.handleDragFinish}
            onMouseLeave={panel.handleDragFinish}
            onMouseMove={panel.handleDragging}
            style={{
              width: `${virtualizer.getTotalSize()}px`,
              "min-width": "100%",
            }}
            data-tuning-virtualizer
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
            <For each={virtualizer.getVirtualItems()}>
              {(virtualItem) => {
                const item = () => timelineItems()[virtualItem.index];
                return (
                  <Show when={item()}>
                    {(currentItem) => (
                      <div
                        class="absolute inset-y-0 left-0"
                        style={{
                          width: `${virtualItem.size}px`,
                          transform: `translateX(${virtualItem.start}px)`,
                        }}
                        data-index={virtualItem.index}
                        data-tuning-item
                      >
                        <TuningItem
                          mora={currentItem().mora}
                          startDraggingDur={(
                            origin: number,
                            mode: DraggingMode,
                          ) => {
                            panel.setDraggingData({
                              apIndex: currentItem().phraseIndex,
                              moraIndex: currentItem().moraIndex,
                              originData: origin,
                              mode: currentItem().isPause ? "pause" : mode,
                            });
                          }}
                          setPitch={(pitch) => {
                            if (currentItem().isPause) {
                              panel.setPauseLength(
                                currentItem().phraseIndex,
                                pitch,
                              );
                            } else if (panel.draggingData() === null) {
                              panel.setPitch(
                                currentItem().phraseIndex,
                                currentItem().moraIndex,
                                pitch,
                              );
                            }
                          }}
                          minPitch={
                            currentItem().isPause ? 0 : panel.minPitch()
                          }
                          maxPitch={
                            currentItem().isPause ? 0 : panel.maxPitch()
                          }
                          isPause={currentItem().isPause}
                        />
                      </div>
                    )}
                  </Show>
                );
              }}
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
