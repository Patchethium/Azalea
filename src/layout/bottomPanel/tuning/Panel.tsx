import type { Mora } from "$binding";
import { DEFAULT_BOTTOM_DURATION_HEIGHT } from "$constants";
import { useConfigStore } from "@contexts/config";
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
  onCleanup,
  Show,
} from "solid-js";
import { createVirtualizer, observeElementRect } from "@tanstack/solid-virtual";

const MIN_DURATION_HEIGHT = 24;
const MIN_PITCH_HEIGHT = 48;
const DURATION_RESIZE_STEP = 8;

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
  const { config, setConfig } = useConfigStore()!;
  const panel = useTuningPanel(() => props.waveformSynthesisNotice);
  const [scrollElement, setScrollElement] = createSignal<HTMLDivElement | null>(
    null,
  );
  const durationHeight = () =>
    config.ui.bottom_duration_height ?? DEFAULT_BOTTOM_DURATION_HEIGHT;
  const setDurationHeight = (height: number) =>
    setConfig("ui", "bottom_duration_height", Math.round(height));
  const [maxDurationHeight, setMaxDurationHeight] =
    createSignal(durationHeight());
  let timelineElement!: HTMLDivElement;
  let resizingDuration = false;

  const updateDurationBounds = () => {
    if (timelineElement.clientHeight === 0) return maxDurationHeight();
    const max = Math.max(
      MIN_DURATION_HEIGHT,
      timelineElement.clientHeight - MIN_PITCH_HEIGHT,
    );
    setMaxDurationHeight(max);
    const height = Math.min(
      Math.max(durationHeight(), MIN_DURATION_HEIGHT),
      max,
    );
    if (height !== durationHeight()) setDurationHeight(height);
    return max;
  };

  const resizeDuration = (clientY: number) => {
    const max = updateDurationBounds();
    setDurationHeight(
      Math.min(
        Math.max(
          timelineElement.getBoundingClientRect().bottom - clientY,
          MIN_DURATION_HEIGHT,
        ),
        max,
      ),
    );
  };

  createEffect(() => {
    if (!panel.queryExists()) return;
    const observer = new ResizeObserver(updateDurationBounds);
    observer.observe(timelineElement);
    onCleanup(() => observer.disconnect());
  });
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
            ref={(element) => {
              timelineElement = element;
            }}
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
                  durationHeight={durationHeight()}
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
                          durationHeight={durationHeight()}
                          isPause={currentItem().isPause}
                        />
                      </div>
                    )}
                  </Show>
                );
              }}
            </For>
            <button
              type="button"
              role="separator"
              aria-label={t1("bottom.resize_duration")}
              aria-orientation="vertical"
              aria-valuemin={MIN_DURATION_HEIGHT}
              aria-valuemax={maxDurationHeight()}
              aria-valuenow={durationHeight()}
              aria-valuetext={`${durationHeight()}px`}
              data-duration-resize-handle
              class="group absolute left-0 right-0 z-2 h-2 touch-none cursor-ns-resize flex items-center border-0 bg-transparent p-0"
              style={{
                bottom: `${durationHeight()}px`,
                transform: "translateY(50%)",
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                resizingDuration = true;
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!resizingDuration) return;
                event.stopPropagation();
                resizeDuration(event.clientY);
              }}
              onLostPointerCapture={() => {
                resizingDuration = false;
              }}
              onKeyDown={(event) => {
                const delta =
                  event.key === "ArrowUp"
                    ? DURATION_RESIZE_STEP
                    : event.key === "ArrowDown"
                      ? -DURATION_RESIZE_STEP
                      : 0;
                if (delta === 0) return;
                event.preventDefault();
                event.stopPropagation();
                const max = updateDurationBounds();
                setDurationHeight(
                  Math.min(
                    Math.max(durationHeight() + delta, MIN_DURATION_HEIGHT),
                    max,
                  ),
                );
              }}
            >
              <span class="block h-px w-full bg-transparent transition-colors group-hover:bg-primary-5 group-active:bg-primary-5 group-focus-visible:bg-primary-5" />
            </button>
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
