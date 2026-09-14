// Adapted from src/layout/bottomPanel/tuning/Panel.tsx; see ../README.md.
import type { Mora, DraggingMode } from "../types";
import { Slider } from "@kobalte/core/slider";
import { TuningItem } from "./Timeline";
import type { useTuningPanel } from "./usePanel";
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
  panel: ReturnType<typeof useTuningPanel>;
}) {
  const panel = props.panel;
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
        class="min-h-0 flex-1 relative flex flex-col left-0 top-0 overflow-x-auto overflow-y-hidden cursor-default"
        classList={{
          "!overflow-x-hidden !cursor-ew-resize": panel.draggingData() !== null,
        }}
      >
        <Show
          when={panel.queryExists()}
          fallback={
            <div class="flex size-full items-center justify-center select-none cursor-default">
              No sample to tune.
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
                          scale={panel.scale()}
                          setDuration={(mode, value) =>
                            panel.setDuration(
                              currentItem().phraseIndex,
                              currentItem().moraIndex,
                              currentItem().isPause ? "pause" : mode,
                              value,
                            )
                          }
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
      <div class="h-6 shrink-0 w-full b-dashed b-slate-3 dark:b-slate-6 flex items-center px-2 justify-between">
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
              <Slider.Thumb
                aria-label="Timeline zoom"
                class="block size-4 bg-transparent rounded-full -top-1 outline-none"
              >
                <Slider.Input aria-hidden="true" />
              </Slider.Thumb>
            </Slider.Track>
          </Slider>
        </Show>
      </div>
    </>
  );
}
