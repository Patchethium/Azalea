import type { VoiceSegment } from "$binding";
import { DEFAULT_BOTTOM_SCALE, DEFAULT_PRIMARY_COLOR } from "$constants";
import { INPUT_CLASS } from "@components/textField";
import { NumberField } from "@components/numberField";
import { Tooltip } from "@components/tooltip";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { useTextStore } from "@contexts/text";
import {
  MIN_SEGMENT_SECONDS,
  useVoiceImportStore,
} from "@contexts/voiceImport";
import { AppButton } from "@components/button";
import { Button } from "@kobalte/core/button";
import { Slider } from "@kobalte/core/slider";
import { useVoiceActions } from "@layout/bottomPanel/voice/useVoiceActions";
import {
  primaryRgb,
  spectrogramBitmap,
} from "@layout/bottomPanel/spectrogramBitmap";
import {
  MAX_IMPORT_OFFSET,
  MAX_IMPORT_SCALE,
  MIN_IMPORT_OFFSET,
  MIN_IMPORT_SCALE,
} from "@layout/bottomPanel/tuning/voiceImport";
import _ from "lodash";
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";

/** Height of the phoneme strip above the plot. */
const STRIP_HEIGHT = 18;
/** Height of the playback-start timeline above the canvas. */
const TIMELINE_HEIGHT = 20;
/** Semitones of headroom above and below the analysis range. */
const RANGE_PADDING = 2 ** (2 / 12);
/** How close to a boundary, in pixels, a drag grabs it. */
const BOUNDARY_HIT_PIXELS = 6;
const MIN_SCALE = 100;
const MAX_SCALE = 1500;

/**
 * Moves the boundary before segment `index` to `seconds`, keeping both of its
 * segments at least `MIN_SEGMENT_SECONDS` long.
 */
export function moveBoundary(
  segments: readonly VoiceSegment[],
  index: number,
  seconds: number,
): VoiceSegment[] {
  if (index <= 0 || index >= segments.length) return [...segments];
  const low = segments[index - 1].start + MIN_SEGMENT_SECONDS;
  const high = segments[index].end - MIN_SEGMENT_SECONDS;
  if (high < low) return [...segments];
  const time = _.clamp(seconds, low, high);
  return segments.map((segment, i) =>
    i === index - 1
      ? { ...segment, end: time }
      : i === index
        ? { ...segment, start: time }
        : segment,
  );
}

/**
 * The voice tab: the attached recording's spectrogram and f0 with its aligned
 * phonemes, whose boundaries can be dragged. The timing and the pitch mapped
 * into the voice's range go into the tuning panel as they change.
 */
export function VoicePanel(props: { disabled?: boolean }) {
  const { t1, t2 } = usei18n()!;
  const { config, setConfig, playbackTimelineEnabled } = useConfigStore()!;
  const { selectedTextBlock } = useTextStore()!;
  const voices = useVoiceImportStore()!;
  const actions = useVoiceActions(() => props.disabled ?? false);
  const [viewport, setViewport] = createSignal({ width: 0, height: 0 });
  const [scrollLeft, setScrollLeft] = createSignal(0);
  const [hoverBoundary, setHoverBoundary] = createSignal<number | null>(null);
  const [dragging, setDragging] = createSignal<number | null>(null);
  let scrollElement: HTMLDivElement | undefined;
  // A signal: the canvas mounts only once the voice is aligned, after the
  // drawing effect first runs.
  const [canvasElement, setCanvasElement] = createSignal<HTMLCanvasElement>();

  const blockId = () => selectedTextBlock()?.id ?? null;
  const session = () => {
    const id = blockId();
    return id === null ? null : (voices.voiceSessions[id] ?? null);
  };
  const recording = () => {
    const state = voices.voiceRecording();
    return state !== null && state.blockId === blockId() ? state : null;
  };
  const segments = () => session()?.segments ?? null;

  const scale = () => config.ui?.bottom_scale ?? DEFAULT_BOTTOM_SCALE;
  const primary = () =>
    primaryRgb(config.ui.primary_color ?? DEFAULT_PRIMARY_COLOR);
  const bitmap = createMemo(() => {
    const analysis = session()?.analysis;
    return analysis === undefined
      ? null
      : spectrogramBitmap(analysis, primary());
  });
  const duration = () => session()?.analysis.duration ?? 0;
  const range = () => {
    const analysis = session()?.analysis;
    return analysis === undefined
      ? { low: 50, high: 800 }
      : {
          low: analysis.f0_floor / RANGE_PADDING,
          high: analysis.f0_ceil * RANGE_PADDING,
        };
  };
  const framePeriod = () => (session()?.analysis.frame_period_ms ?? 5) / 1000;
  const totalWidth = () => duration() * scale() + viewport().width / 4;
  const canvasHeight = () =>
    Math.max(
      1,
      viewport().height - (playbackTimelineEnabled() ? TIMELINE_HEIGHT : 0),
    );
  const plotHeight = () => Math.max(1, canvasHeight() - STRIP_HEIGHT);
  const xOfTime = (seconds: number) => seconds * scale() - scrollLeft();
  const yOfHz = (hz: number) => {
    const { low, high } = range();
    return (
      STRIP_HEIGHT +
      (1 - Math.log(hz / low) / Math.log(high / low)) * plotHeight()
    );
  };

  const timeAt = (event: PointerEvent) => {
    const canvas = canvasElement();
    if (canvas === undefined) return 0;
    const rect = canvas.getBoundingClientRect();
    return Math.max(0, (event.clientX - rect.left + scrollLeft()) / scale());
  };
  /** The draggable boundary within reach of time `seconds`, if any. */
  const boundaryAt = (seconds: number) => {
    const current = segments();
    if (current === null) return null;
    let hit: number | null = null;
    let closest = BOUNDARY_HIT_PIXELS;
    for (let index = 1; index < current.length; index++) {
      const distance = Math.abs(current[index].start - seconds) * scale();
      if (distance <= closest) {
        closest = distance;
        hit = index;
      }
    }
    return hit;
  };

  onMount(() => {
    if (scrollElement === undefined) return;
    const element = scrollElement;
    const measure = () =>
      setViewport({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    const canvas = canvasElement();
    const current = session();
    const width = viewport().width;
    const height = canvasHeight();
    if (canvas === undefined || current === null || width === 0) return;
    const analysis = current.analysis;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const textColor = getComputedStyle(canvas).color || "#64748b";
    const [red, green, blue] = primary();
    const frames = analysis.f0.length;
    const { low, high } = range();

    const image = bitmap();
    if (image !== null) {
      const { rows, minHz, maxHz } = analysis.spectrogram;
      const rowOf = (hz: number) =>
        ((rows - 1) * Math.log(hz / minHz)) / Math.log(maxHz / minHz);
      const top = rows - 1 - rowOf(high);
      const bottom = rows - 1 - rowOf(low);
      // Column `c` spans frame times (c - 0.5)..(c + 0.5).
      context.drawImage(
        image,
        0,
        top,
        frames,
        bottom - top,
        xOfTime(-0.5 * framePeriod()),
        STRIP_HEIGHT,
        frames * framePeriod() * scale(),
        plotHeight(),
      );
    }

    // Semitone grid with a label on each C.
    context.font = "10px sans-serif";
    context.textBaseline = "middle";
    for (
      let midi = Math.ceil(69 + 12 * Math.log2(low / 440));
      midi <= 69 + 12 * Math.log2(high / 440);
      midi++
    ) {
      const y = yOfHz(440 * 2 ** ((midi - 69) / 12));
      context.globalAlpha = midi % 12 === 0 ? 0.25 : 0.08;
      context.fillStyle = textColor;
      context.fillRect(0, Math.round(y), width, 1);
      if (midi % 12 === 0) {
        context.globalAlpha = 0.7;
        context.fillText(`C${Math.floor(midi / 12) - 1}`, 4, y - 6);
      }
    }

    // The recording's f0.
    context.globalAlpha = 1;
    context.lineWidth = 2;
    context.strokeStyle = `rgb(${red}, ${green}, ${blue})`;
    context.beginPath();
    let open = false;
    for (let frame = 0; frame < frames; frame++) {
      const hz = analysis.f0[frame];
      if (!(hz > 0)) {
        open = false;
        continue;
      }
      const x = xOfTime(frame * framePeriod());
      const y = yOfHz(hz);
      if (open) context.lineTo(x, y);
      else context.moveTo(x, y);
      open = true;
    }
    context.stroke();

    // Phonemes with their boundaries; the grabbed one is highlighted.
    const active = dragging() ?? hoverBoundary();
    for (const [index, segment] of (current.segments ?? []).entries()) {
      const start = xOfTime(segment.start);
      const end = xOfTime(segment.end);
      if (end < 0 || start > width) continue;
      if (index > 0) {
        const highlighted = index === active;
        context.globalAlpha = highlighted ? 0.9 : 0.25;
        context.fillStyle = highlighted
          ? `rgb(${red}, ${green}, ${blue})`
          : textColor;
        context.fillRect(Math.round(start), 0, highlighted ? 2 : 1, height);
      }
      context.globalAlpha = 0.85;
      context.fillStyle = textColor;
      context.fillText(
        segment.phoneme,
        start + 3,
        STRIP_HEIGHT / 2,
        Math.max(end - start - 4, 0),
      );
    }
    context.globalAlpha = 0.18;
    context.fillStyle = textColor;
    context.fillRect(0, STRIP_HEIGHT, width, 1);

    // Playback start point.
    const playbackStart = current.playbackStart;
    if (playbackStart > 0) {
      const x = xOfTime(playbackStart);
      context.globalAlpha = 0.8;
      context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
      for (let y = 0; y < height; y += 6) {
        context.fillRect(Math.round(x), y, 1, 3);
      }
    }
    context.globalAlpha = 1;
  });

  const finishDrag = () => {
    const id = blockId();
    if (dragging() === null || id === null) return;
    setDragging(null);
    voices.commitVoiceSegments(id);
  };

  const handleWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setConfig(
      "ui",
      "bottom_scale",
      _.clamp(scale() + (event.deltaY > 0 ? -50 : 50), MIN_SCALE, MAX_SCALE),
    );
  };

  const mappingField = (props: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
  }) => (
    <NumberField
      minValue={props.min}
      maxValue={props.max}
      step={props.step}
      value={props.value}
      format={false}
      changeOnWheel
      onChange={(value) => {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed))
          props.onChange(_.clamp(parsed, props.min, props.max));
      }}
      class="flex items-center gap1"
    >
      <NumberField.Label class="whitespace-nowrap">
        {props.label}
      </NumberField.Label>
      <NumberField.Input class={`h-5 !w-14 !px1 text-xs ${INPUT_CLASS}`} />
    </NumberField>
  );

  return (
    <div class="relative size-full flex flex-col">
      <div
        ref={(element) => {
          scrollElement = element;
        }}
        data-bottom-panel-scroll="voice"
        class="flex-1 min-h-0 relative overflow-x-auto overflow-y-hidden text-ink-subtle"
        onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
        onWheel={handleWheel}
      >
        <Switch
          fallback={
            <div class="flex size-full flex-col items-center justify-center gap-3 px-8 text-center text-sm select-none">
              <div class="flex flex-row gap-2">
                <AppButton
                  variant="surface"
                  class="flex items-center gap-1.5 text-ink"
                  disabled={!actions.canStartRecording()}
                  onClick={() => void actions.toggleVoiceRecording()}
                >
                  <div aria-hidden="true" class="i-lucide:mic size-4" />
                  {t1("voice_import.record")}
                </AppButton>
                <AppButton
                  variant="surface"
                  class="flex items-center gap-1.5 text-ink"
                  disabled={!actions.canChooseFile()}
                  onClick={() => void actions.chooseVoiceFile()}
                >
                  <div aria-hidden="true" class="i-lucide:file-audio size-4" />
                  {t1("voice_import.choose_file")}
                </AppButton>
              </div>
              <p class="m0 max-w-120">{t1("voice_import.empty")}</p>
            </div>
          }
        >
          <Match when={recording()}>
            {(state) => (
              <div class="flex size-full flex-col items-center justify-center gap-2 text-sm select-none">
                <Show
                  when={state().phase === "recording"}
                  fallback={
                    <span role="status" class="flex items-center gap-2">
                      <div
                        aria-hidden="true"
                        class="i-lucide:loader-circle size-4 animate-spin"
                      />
                      {t1("voice_import.loading")}
                    </span>
                  }
                >
                  <div
                    role="meter"
                    aria-label={t1("voice_import.level")}
                    aria-valuemin={0}
                    aria-valuemax={1}
                    aria-valuenow={state().peak}
                    class="h-2 w-60 max-w-80% overflow-hidden rounded-full bg-track"
                  >
                    <div
                      class="h-full bg-accent"
                      style={{ width: `${Math.round(state().peak * 100)}%` }}
                    />
                  </div>
                  <span class="tabular-nums">
                    {t2("voice_import.recording", {
                      seconds: state().seconds.toFixed(1),
                    })}
                  </span>
                </Show>
              </div>
            )}
          </Match>
          <Match when={session() !== null && segments() !== null}>
            <div
              class="relative h-full flex flex-col"
              style={{ width: `${Math.max(totalWidth(), viewport().width)}px` }}
            >
              <Show when={playbackTimelineEnabled()}>
                <div
                  class="w-full shrink-0 b-b b-border bg-canvas"
                  style={{ height: `${TIMELINE_HEIGHT}px` }}
                >
                  <Slider
                    class="relative h-full select-none"
                    style={{ width: `${duration() * scale()}px` }}
                    minValue={0}
                    maxValue={Math.max(duration(), 0.001)}
                    step={0.001}
                    value={[session()?.playbackStart ?? 0]}
                    onChange={(value) => {
                      const id = blockId();
                      if (id !== null)
                        voices.setVoicePlaybackStart(id, value[0]);
                    }}
                    getValueLabel={(params) =>
                      t2("voice_import.playback_start_value", {
                        time: params.values[0].toFixed(3),
                      })
                    }
                  >
                    <Slider.Track
                      class="relative size-full cursor-pointer hover:bg-primary-50 dark:hover:bg-primary-9"
                      data-voice-timeline
                      onContextMenu={(event) => {
                        event.preventDefault();
                        const id = blockId();
                        if (id !== null) voices.setVoicePlaybackStart(id, 0);
                      }}
                    >
                      <Slider.Thumb
                        aria-label={t1("voice_import.playback_start")}
                        class="group top-0 block h-full w-3 outline-none"
                      >
                        <span
                          class="pointer-events-none absolute inset-y-0 left-1/2 w-1px bg-accent group-focus-visible:w-2px"
                          classList={{
                            "opacity-40": (session()?.playbackStart ?? 0) <= 0,
                          }}
                        >
                          <span class="absolute left-0 top-0 size-0 border-l-5 border-y-4 border-l-accent border-y-transparent" />
                        </span>
                        <Slider.Input />
                      </Slider.Thumb>
                    </Slider.Track>
                  </Slider>
                </div>
              </Show>
              <canvas
                ref={setCanvasElement}
                role="img"
                aria-label={t1("voice_import.canvas")}
                data-voice-canvas
                class="sticky left-0 block shrink-0 touch-none"
                classList={{
                  "cursor-ew-resize":
                    dragging() !== null || hoverBoundary() !== null,
                }}
                style={{
                  width: `${viewport().width}px`,
                  height: `${canvasHeight()}px`,
                }}
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  const index = boundaryAt(timeAt(event));
                  if (index === null) return;
                  setDragging(index);
                  event.preventDefault();
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const seconds = timeAt(event);
                  const index = dragging();
                  const id = blockId();
                  const current = segments();
                  if (index === null || id === null || current === null) {
                    setHoverBoundary(boundaryAt(seconds));
                    return;
                  }
                  voices.setVoiceSegments(
                    id,
                    moveBoundary(current, index, seconds),
                  );
                }}
                onPointerUp={finishDrag}
                onLostPointerCapture={finishDrag}
                onPointerLeave={() => setHoverBoundary(null)}
              />
            </div>
          </Match>
          <Match when={session()?.error}>
            {(error) => (
              <div
                role="alert"
                class="flex size-full flex-col items-center justify-center gap-2 text-sm"
              >
                <span>{t1("voice_import.failed")}</span>
                <span class="max-w-80% truncate text-xs">{error()}</span>
                <Button
                  class="rounded-md b b-border-menu px-2 py-0.5 outline-none hover:bg-hover focus-visible:(ring-2 ring-focus-ring-soft)"
                  onClick={() => {
                    const id = blockId();
                    if (id !== null) voices.realignVoice(id);
                  }}
                >
                  {t1("voice_import.retry")}
                </Button>
              </div>
            )}
          </Match>
          <Match when={session() !== null}>
            <div
              role="status"
              class="flex size-full items-center justify-center gap-2 text-sm select-none"
            >
              <div
                aria-hidden="true"
                class="i-lucide:loader-circle size-4 animate-spin"
              />
              {t1("voice_import.aligning")}
            </div>
          </Match>
        </Switch>
      </div>
      <div class="h-7 w-full shrink-0 flex items-center gap-3 overflow-hidden px-2 text-xs text-ink-subtle">
        <Show when={session()}>
          {(current) => (
            <>
              <span class="min-w-0 flex flex-1 items-center gap-1">
                <Show
                  when={current().error !== null && segments() !== null}
                  fallback={
                    <span class="truncate">
                      {current().aligning
                        ? t1("voice_import.aligning")
                        : t1("voice_import.hint")}
                    </span>
                  }
                >
                  <span role="alert" class="truncate text-danger-ink">
                    {`${t1("voice_import.failed")}: ${current().error}`}
                  </span>
                </Show>
              </span>
              {mappingField({
                label: t1("voice_import.scale"),
                value: Number(
                  (
                    current().mapping.scale ??
                    current().fittedScale ??
                    1
                  ).toFixed(2),
                ),
                min: MIN_IMPORT_SCALE,
                max: MAX_IMPORT_SCALE,
                step: 0.05,
                onChange: (value) =>
                  voices.setVoiceMapping(blockId()!, {
                    ...current().mapping,
                    scale: value,
                  }),
              })}
              <Tooltip content={t1("voice_import.fit")}>
                <Button
                  aria-label={t1("voice_import.fit")}
                  disabled={current().mapping.scale === null}
                  class="size-5 flex items-center justify-center rounded bg-transparent outline-none enabled:hover:bg-hover focus-visible:(ring-2 ring-focus-ring-soft) disabled:(cursor-not-allowed text-ink-disabled)"
                  onClick={() =>
                    voices.setVoiceMapping(blockId()!, {
                      ...current().mapping,
                      scale: null,
                    })
                  }
                >
                  <div
                    aria-hidden="true"
                    class="i-lucide:wand-sparkles size-3.5"
                  />
                </Button>
              </Tooltip>
              {mappingField({
                label: t1("voice_import.offset"),
                value: current().mapping.offset,
                min: MIN_IMPORT_OFFSET,
                max: MAX_IMPORT_OFFSET,
                step: 1,
                onChange: (value) =>
                  voices.setVoiceMapping(blockId()!, {
                    ...current().mapping,
                    offset: Math.round(value),
                  }),
              })}
            </>
          )}
        </Show>
      </div>
    </div>
  );
}
