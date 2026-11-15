import {
  DEFAULT_BOTTOM_DURATION_HEIGHT,
  DEFAULT_PRIMARY_COLOR,
  TUNING_TRAILING_SPACE_RATIO,
} from "$constants";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { Slider } from "@kobalte/core/slider";
import { primaryRgb } from "@layout/bottomPanel/spectrogramBitmap";
import { SpectrogramCanvas } from "@layout/bottomPanel/tuning/Timeline";
import { useTuningPanel } from "@layout/bottomPanel/tuning/usePanel";
import type { WaveformSynthesisNotice } from "@layout/bottomPanel/types";
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import {
  hitTest,
  isWhisper,
  type PitchMapping,
  positionToPitch,
  resetTarget,
  type StrokePoint,
  strokePositions,
  type TuningColumn,
  timelineWidth,
  tuningColumns,
} from "./layout";
import { PITCH_RULER_WIDTH, PitchRuler } from "./PitchRuler";
import {
  buildScene,
  drawScene,
  readSceneColors,
  type TuningHover,
} from "./scene";

const MIN_DURATION_HEIGHT = 24;
const MIN_PITCH_HEIGHT = 48;
const DURATION_RESIZE_STEP = 8;

/** What the pointer is doing between a press on the canvas and its release. */
type Gesture =
  | {
      /** Painting pitches, or resetting them to the prediction. */
      kind: "paint" | "reset";
      last: StrokePoint;
      /** The right-most mora edited so far, which completion preserves. */
      through: TuningColumn | null;
    }
  | { kind: "duration" };

export function TuningPanel(props: {
  waveformSynthesisNotice: WaveformSynthesisNotice | null;
}) {
  const { t1 } = usei18n()!;
  const { config, setConfig, pitchRulerEnabled, spectrogramPreviewEnabled } =
    useConfigStore()!;
  const panel = useTuningPanel(() => props.waveformSynthesisNotice);
  const durationHeight = () =>
    config.ui.bottom_duration_height ?? DEFAULT_BOTTOM_DURATION_HEIGHT;
  const setDurationHeight = (height: number) =>
    setConfig("ui", "bottom_duration_height", Math.round(height));
  const [maxDurationHeight, setMaxDurationHeight] =
    createSignal(durationHeight());
  const [timelineHeight, setTimelineHeight] = createSignal(0);
  const [viewportWidth, setViewportWidth] = createSignal(0);
  const [scrollLeft, setScrollLeft] = createSignal(0);
  const [canvasElement, setCanvasElement] = createSignal<HTMLCanvasElement>();
  const [hover, setHover] = createSignal<TuningHover>(null, {
    equals: (a, b) => a?.index === b?.index && a?.part === b?.part,
  });
  // Bumped when the theme, primary color or fonts change under the canvas.
  const [styleRevision, setStyleRevision] = createSignal(0);
  let scrollElement!: HTMLDivElement;
  let timelineElement!: HTMLDivElement;
  let resizingDuration = false;
  let gesture: Gesture | null = null;

  const updateDurationBounds = () => {
    setViewportWidth(scrollElement.clientWidth);
    setTimelineHeight(timelineElement.clientHeight);
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
    updateDurationBounds();
    setScrollLeft(scrollElement.scrollLeft);
    const observer = new ResizeObserver(updateDurationBounds);
    observer.observe(scrollElement);
    observer.observe(timelineElement);
    onCleanup(() => observer.disconnect());
  });

  onMount(() => {
    const restyle = () => setStyleRevision((revision) => revision + 1);
    const observer = new MutationObserver(restyle);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    onCleanup(() => observer.disconnect());
    let mounted = true;
    onCleanup(() => {
      mounted = false;
    });
    void document.fonts?.ready.then(() => {
      if (mounted) restyle();
    });
  });

  // Zooming keeps the time at the left edge of the view where it is. This runs
  // before the drawing effect, so the canvas never shows the old offset.
  createEffect(
    on(panel.scale, (scale, previous) => {
      if (previous === undefined || !panel.queryExists()) return;
      scrollElement.scrollLeft = (scrollElement.scrollLeft * scale) / previous;
      setScrollLeft(scrollElement.scrollLeft);
      // The playback timeline follows the shared position without waiting
      // for the scroll event.
      panel.syncScroll(scrollElement.scrollLeft);
    }),
  );

  const columns = createMemo(() =>
    tuningColumns(
      panel.currentText()?.query?.accent_phrases ?? [],
      panel.scale(),
    ),
  );
  const contentWidth = () => timelineWidth(columns());
  const mapping = createMemo<PitchMapping>(() => ({
    pitchScale: panel.pitchScale(),
    driftScale: panel.tuningMode() === "Relative" ? panel.driftScale() : null,
  }));
  const hasPitchSpan = () => panel.pitchScale().max > panel.pitchScale().min;
  /**
   * Empty room after the last mora: half the visible panel, so the end of the
   * timeline can be scrolled to its middle, and never less than the ruler.
   */
  const trailingSpace = () =>
    Math.max(
      Math.round(viewportWidth() * TUNING_TRAILING_SPACE_RATIO),
      hasPitchSpan() ? PITCH_RULER_WIDTH : 0,
    );
  /** Height of the pitch area above the duration strip. */
  const plotHeight = () =>
    isWhisper(mapping()) ? 0 : Math.max(0, timelineHeight() - durationHeight());
  const baselineFor = (column: TuningColumn) =>
    column.isPause
      ? null
      : panel.baselineFor(column.phraseIndex, column.moraIndex);

  createEffect(() => {
    const canvas = canvasElement();
    const width = viewportWidth();
    const height = timelineHeight();
    if (canvas === undefined || width === 0 || height === 0) return;
    styleRevision();
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawScene(
      context,
      buildScene({
        columns: columns(),
        scrollLeft: scrollLeft(),
        width,
        height,
        durationHeight: durationHeight(),
        mapping: mapping(),
        baselineFor,
        hover: hover(),
      }),
      readSceneColors(
        canvas,
        primaryRgb(config.ui.primary_color ?? DEFAULT_PRIMARY_COLOR),
        spectrogramPreviewEnabled(),
      ),
    );
  });

  /** The timeline position under a pointer event on the canvas. */
  const pointAt = (event: PointerEvent | MouseEvent): StrokePoint => {
    const rect = canvasElement()!.getBoundingClientRect();
    return {
      x: event.clientX - rect.left + scrollLeft(),
      y: event.clientY - rect.top,
    };
  };
  const hitAt = (point: StrokePoint) =>
    hitTest(columns(), point.x, point.y, plotHeight(), isWhisper(mapping()));

  /** Edits every voiced mora between two pointer positions of a stroke. */
  const paint = (
    stroke: Extract<Gesture, { kind: "paint" | "reset" }>,
    to: StrokePoint,
  ) => {
    const edits: { i: number; j: number; value: number }[] = [];
    for (const { column, position } of strokePositions(
      columns(),
      stroke.last,
      to,
      plotHeight(),
    )) {
      const baseline = baselineFor(column);
      const value =
        stroke.kind === "reset"
          ? resetTarget(baseline)
          : positionToPitch(position, baseline, mapping());
      if (value === null) continue;
      if (stroke.through === null || column.index > stroke.through.index) {
        stroke.through = column;
      }
      if (value !== column.mora.pitch) {
        edits.push({ i: column.phraseIndex, j: column.moraIndex, value });
      }
    }
    stroke.last = to;
    if (edits.length === 0 || stroke.through === null) return;
    const { phraseIndex, moraIndex } = stroke.through;
    panel.setPitches(edits, { i: phraseIndex, j: moraIndex });
  };

  const finishGesture = () => {
    if (gesture?.kind === "duration") panel.handleDragFinish();
    gesture = null;
  };

  return (
    <div class="relative size-full">
      <div
        ref={(element) => {
          scrollElement = element;
          panel.setScrollAreaRef(element);
        }}
        onWheel={panel.handleWheel}
        onScroll={(event) => {
          setScrollLeft(event.currentTarget.scrollLeft);
          panel.handleScroll(event);
        }}
        data-bottom-panel-scroll="tuning"
        class="size-full relative flex flex-col left-0 top-0 overflow-x-auto overflow-y-hidden cursor-default"
        classList={{
          "!overflow-x-hidden !cursor-ew-resize": panel.draggingData() !== null,
        }}
      >
        <Show
          when={panel.queryExists()}
          fallback={
            <div class="flex size-full items-center justify-center select-none cursor-default text-ink-subtle">
              {t1("bottom.no_query")}
            </div>
          }
        >
          <div
            ref={(element) => {
              timelineElement = element;
            }}
            class="flex-1 min-h-0 relative"
            style={{
              width: `${Math.round(contentWidth()) + trailingSpace()}px`,
              "min-width": "100%",
            }}
            data-tuning-timeline
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
            {/* Out of flow, so the canvas's height never props the panel open. */}
            <div class="absolute inset-0">
              <canvas
                ref={setCanvasElement}
                role="img"
                aria-label={t1("bottom.tuning_canvas")}
                data-tuning-canvas
                class="sticky left-0 block touch-none select-none"
                style={{
                  width: `${viewportWidth()}px`,
                  height: `${timelineHeight()}px`,
                }}
                onContextMenu={(event) => {
                  const hit = hitAt(pointAt(event));
                  if (
                    hit?.part === "pitch" &&
                    hit.column.mora.pitch !== 0 &&
                    resetTarget(baselineFor(hit.column)) !== null
                  ) {
                    event.preventDefault();
                  }
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0 && event.button !== 2) return;
                  const point = pointAt(event);
                  const hit = hitAt(point);
                  if (
                    hit === null ? point.y < plotHeight() : hit.part === "pitch"
                  ) {
                    const stroke: Gesture = {
                      kind: event.button === 2 ? "reset" : "paint",
                      last: point,
                      through: null,
                    };
                    gesture = stroke;
                    paint(stroke, point);
                  } else if (hit !== null && event.button === 0) {
                    const { column, part } = hit;
                    gesture = { kind: "duration" };
                    setHover({ index: column.index, part });
                    panel.setDraggingData({
                      apIndex: column.phraseIndex,
                      moraIndex: column.moraIndex,
                      originData:
                        part === "consonant"
                          ? (column.mora.consonant_length ?? 0)
                          : column.mora.vowel_length,
                      mode: column.isPause
                        ? "pause"
                        : part === "consonant"
                          ? "consonant"
                          : "vowel",
                    });
                    panel.setStartX(event.clientX);
                  } else {
                    return;
                  }
                  if (event.button === 0) event.preventDefault();
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                }}
                onPointerMove={(event) => {
                  // A release that never arrived must not leave a stroke going.
                  if (gesture !== null && event.buttons === 0) finishGesture();
                  if (gesture?.kind === "duration") {
                    panel.handleDragging(event);
                    return;
                  }
                  const point = pointAt(event);
                  if (gesture !== null) paint(gesture, point);
                  const hit = hitAt(point);
                  setHover(
                    hit === null || (gesture !== null && hit.part !== "pitch")
                      ? null
                      : { index: hit.column.index, part: hit.part },
                  );
                }}
                onPointerUp={finishGesture}
                onLostPointerCapture={finishGesture}
                onPointerLeave={() => {
                  if (gesture === null) setHover(null);
                }}
              />
            </div>
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
              <span class="block h-px w-full bg-transparent motion-safe:transition-colors group-hover:bg-accent group-active:bg-accent group-focus-visible:bg-accent" />
            </button>
          </div>
        </Show>
      </div>
      <div class="h-6 w-full b-dashed b-border flex items-center px-2 justify-between">
        <Show when={panel.queryExists()}>
          <Slider
            class="relative flex flex-col w-20% select-none items-center group"
            minValue={panel.minScale}
            maxValue={panel.maxScale}
            value={[panel.scale()]}
            onChange={(value) => panel.setScale(value[0])}
          >
            <Slider.Track class="w-full h-2 bg-track rounded-full relative">
              <Slider.Fill class="absolute bg-slate-3 dark:bg-slate-5 rounded-full h-full group-hover:bg-accent" />
              <Slider.Thumb class="block size-4 bg-transparent rounded-full -top-1 outline-none">
                <Slider.Input />
              </Slider.Thumb>
            </Slider.Track>
          </Slider>
        </Show>
      </div>
      <Show when={pitchRulerEnabled() && panel.queryExists() && hasPitchSpan()}>
        <PitchRuler
          scale={panel.pitchScale()}
          driftScale={
            panel.tuningMode() === "Relative" ? panel.driftScale() : null
          }
          height={Math.max(0, timelineHeight() - durationHeight())}
        />
      </Show>
    </div>
  );
}
