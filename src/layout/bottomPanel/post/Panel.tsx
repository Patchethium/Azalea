import { DEFAULT_PRIMARY_COLOR, PRIMARY_COLOR_PATTERN } from "$constants";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import type { PreparedPostAnalysis } from "@contexts/postAnalysis";
import { useUIStore } from "@contexts/ui";
import { Button } from "@kobalte/core/button";
import { Slider } from "@kobalte/core/slider";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";
import { noteName, type StrokePoint } from "./postEdit";
import { usePostPanel } from "./usePostPanel";

/** Height of the phoneme strip above the plot and the mora strip below it. */
const STRIP_HEIGHT = 18;
/** Height of the playback-start timeline above the canvas. */
const TIMELINE_HEIGHT = 20;
/** Semitones of headroom above and below the analysis range. */
const RANGE_PADDING = 2 ** (2 / 12);
/** How close to an anchor, in pixels, the time tool grabs it. */
const ANCHOR_HIT_PIXELS = 6;

/** A pointer position: the analysis frame and pitch under it, and its output time. */
type PanelPoint = StrokePoint & { output: number };

const primaryRgb = (color: string) => {
  const hex = PRIMARY_COLOR_PATTERN.test(color) ? color : DEFAULT_PRIMARY_COLOR;
  return [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16),
  ) as [number, number, number];
};

/** Frames × rows of the spectrogram as a bitmap tinted with the primary color. */
const spectrogramBitmap = (
  analysis: PreparedPostAnalysis,
  [red, green, blue]: [number, number, number],
) => {
  const frames = analysis.f0.length;
  const { rows, values } = analysis.spectrogram;
  if (frames === 0 || rows === 0 || values.length !== frames * rows) {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = frames;
  canvas.height = rows;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  const pixels = context.createImageData(frames, rows);
  for (let frame = 0; frame < frames; frame++) {
    for (let row = 0; row < rows; row++) {
      const strength = values[frame * rows + row] / 255;
      const pixel = ((rows - 1 - row) * frames + frame) * 4;
      pixels.data[pixel] = red;
      pixels.data[pixel + 1] = green;
      pixels.data[pixel + 2] = blue;
      pixels.data[pixel + 3] = Math.round(
        Math.max(0, strength - 0.08) ** 1.35 * 150,
      );
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
};

export function PostPanel() {
  const { t1, t2 } = usei18n()!;
  const { config, playbackTimelineEnabled } = useConfigStore()!;
  const { uiStore } = useUIStore()!;
  const panel = usePostPanel();
  const [viewport, setViewport] = createSignal({ width: 0, height: 0 });
  const [scrollLeft, setScrollLeft] = createSignal(0);
  const [hover, setHover] = createSignal<PanelPoint | null>(null);
  let scrollElement: HTMLDivElement | undefined;
  let canvasElement: HTMLCanvasElement | undefined;
  let drawing: "pitch" | "time" | null = null;

  const primary = () =>
    primaryRgb(config.ui.primary_color ?? DEFAULT_PRIMARY_COLOR);
  const bitmap = createMemo(() => {
    const analysis = panel.analysis();
    return analysis === null ? null : spectrogramBitmap(analysis, primary());
  });

  const range = () => {
    const analysis = panel.analysis();
    return analysis === null
      ? { low: 50, high: 800 }
      : {
          low: analysis.f0_floor / RANGE_PADDING,
          high: analysis.f0_ceil * RANGE_PADDING,
        };
  };
  const framePeriod = () => (panel.analysis()?.frame_period_ms ?? 5) / 1000;
  /** The output length; time edits change it. */
  const outputDuration = () =>
    panel.map().toTarget(panel.analysis()?.duration ?? 0);
  const totalWidth = () =>
    outputDuration() * panel.scale() + viewport().width / 4;
  const canvasHeight = () =>
    Math.max(
      1,
      viewport().height - (playbackTimelineEnabled() ? TIMELINE_HEIGHT : 0),
    );
  const plotHeight = () => Math.max(1, canvasHeight() - 2 * STRIP_HEIGHT);
  /** The canvas x of `seconds` of output. */
  const xOfTime = (seconds: number) => seconds * panel.scale() - scrollLeft();
  /** The canvas x of an analysis frame, after time edits. */
  const xOfFrame = (frame: number) =>
    xOfTime(panel.map().toTarget(frame * framePeriod()));
  const yOfHz = (hz: number) => {
    const { low, high } = range();
    return (
      STRIP_HEIGHT +
      (1 - Math.log(hz / low) / Math.log(high / low)) * plotHeight()
    );
  };

  const pointAt = (event: PointerEvent): PanelPoint | null => {
    const analysis = panel.analysis();
    if (analysis === null || canvasElement === undefined) return null;
    const rect = canvasElement.getBoundingClientRect();
    const output = Math.max(
      0,
      (event.clientX - rect.left + scrollLeft()) / panel.scale(),
    );
    const y = Math.min(
      Math.max(event.clientY - rect.top, STRIP_HEIGHT),
      STRIP_HEIGHT + plotHeight(),
    );
    const frame = Math.min(
      Math.max(Math.round(panel.map().toSource(output) / framePeriod()), 0),
      analysis.f0.length - 1,
    );
    const { low, high } = range();
    const logHz =
      Math.log(low) +
      (1 - (y - STRIP_HEIGHT) / plotHeight()) * Math.log(high / low);
    return { frame, logHz, output };
  };

  /** The anchor within grabbing distance of output time `output`, if any. */
  const anchorAt = (output: number) => {
    let hit: number | null = null;
    let closest = ANCHOR_HIT_PIXELS;
    panel.anchors().forEach((anchor, index) => {
      const distance = Math.abs(anchor.target - output) * panel.scale();
      if (distance <= closest) {
        closest = distance;
        hit = index;
      }
    });
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
    const canvas = canvasElement;
    const analysis = panel.analysis();
    const width = viewport().width;
    const height = canvasHeight();
    if (canvas === undefined || analysis === null || width === 0) return;
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
    const map = panel.map();
    const firstFrame = Math.max(
      0,
      Math.floor(map.toSource(scrollLeft() / panel.scale()) / framePeriod()) -
        1,
    );
    const lastFrame = Math.min(
      frames - 1,
      Math.ceil(
        map.toSource((scrollLeft() + width) / panel.scale()) / framePeriod(),
      ) + 1,
    );

    // Spectrogram, cropped to the visible frequency range and drawn piece by
    // piece between time anchors so it follows the time edits.
    const image = bitmap();
    if (image !== null) {
      const { rows, minHz, maxHz } = analysis.spectrogram;
      const { low, high } = range();
      const rowOf = (hz: number) =>
        ((rows - 1) * Math.log(hz / minHz)) / Math.log(maxHz / minHz);
      const top = rows - 1 - rowOf(high);
      const bottom = rows - 1 - rowOf(low);
      const breakpoints = [
        ...map.points,
        [analysis.duration, map.toTarget(analysis.duration)] as const,
      ];
      for (let index = 1; index < breakpoints.length; index++) {
        const [source0, target0] = breakpoints[index - 1];
        const [source1, target1] = breakpoints[index];
        const x0 = xOfTime(target0);
        const x1 = xOfTime(target1);
        if (source1 <= source0 || x1 < 0 || x0 > width) continue;
        // Column `c` spans frame times (c - 0.5)..(c + 0.5).
        const column0 = Math.max(0, source0 / framePeriod() + 0.5);
        const column1 = Math.min(frames, source1 / framePeriod() + 0.5);
        if (column1 <= column0) continue;
        context.drawImage(
          image,
          column0,
          top,
          column1 - column0,
          bottom - top,
          x0,
          STRIP_HEIGHT,
          x1 - x0,
          plotHeight(),
        );
      }
    }

    // Semitone grid with a label on each C.
    context.font = "10px sans-serif";
    context.textBaseline = "middle";
    const { low, high } = range();
    for (
      let midi = Math.ceil(69 + 12 * Math.log2(low / 440));
      midi <= 69 + 12 * Math.log2(high / 440);
      midi++
    ) {
      const hz = 440 * 2 ** ((midi - 69) / 12);
      const y = yOfHz(hz);
      context.globalAlpha = midi % 12 === 0 ? 0.25 : 0.08;
      context.fillStyle = textColor;
      context.fillRect(0, Math.round(y), width, 1);
      if (midi % 12 === 0) {
        context.globalAlpha = 0.7;
        context.fillText(`C${Math.floor(midi / 12) - 1}`, 4, y - 6);
      }
    }

    // Phoneme labels and boundaries.
    context.globalAlpha = 1;
    context.textBaseline = "middle";
    for (const phoneme of panel.phonemes()) {
      const start = xOfTime(map.toTarget(phoneme.start));
      const end = xOfTime(map.toTarget(phoneme.end));
      if (end < 0 || start > width) continue;
      context.globalAlpha = 0.18;
      context.fillStyle = textColor;
      context.fillRect(Math.round(start), 0, 1, STRIP_HEIGHT + plotHeight());
      context.globalAlpha = 0.85;
      context.fillText(
        phoneme.text,
        start + 3,
        STRIP_HEIGHT / 2,
        end - start - 4,
      );
    }

    // Mora katakana below the plot, with their boundaries.
    const moraTop = STRIP_HEIGHT + plotHeight();
    context.globalAlpha = 0.18;
    context.fillStyle = textColor;
    context.fillRect(0, Math.round(moraTop), width, 1);
    for (const mora of panel.moras()) {
      const start = xOfTime(map.toTarget(mora.start));
      const end = xOfTime(map.toTarget(mora.end));
      if (end < 0 || start > width) continue;
      context.globalAlpha = 0.18;
      context.fillRect(Math.round(start), moraTop, 1, STRIP_HEIGHT);
      context.globalAlpha = 0.85;
      context.fillText(
        mora.text,
        start + 3,
        moraTop + STRIP_HEIGHT / 2,
        end - start - 4,
      );
    }
    context.globalAlpha = 1;

    const drawContour = (values: readonly number[], dashed: boolean) => {
      context.beginPath();
      let open = false;
      for (let frame = firstFrame; frame <= lastFrame; frame++) {
        const value = values[frame];
        if (!(value > 0)) {
          open = false;
          continue;
        }
        const x = xOfFrame(frame);
        const y = yOfHz(value);
        if (open) context.lineTo(x, y);
        else context.moveTo(x, y);
        open = true;
      }
      context.setLineDash(dashed ? [3, 3] : []);
      context.stroke();
      context.setLineDash([]);
    };
    context.lineWidth = 1.25;
    context.strokeStyle = textColor;
    context.globalAlpha = 0.6;
    drawContour(analysis.f0, true);
    context.globalAlpha = 1;
    context.lineWidth = 2;
    context.strokeStyle = `rgb(${red}, ${green}, ${blue})`;
    drawContour(panel.contour(), false);

    // Time anchors: a line through the plot and a handle in the phoneme strip.
    context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    for (const anchor of panel.anchors()) {
      const x = xOfTime(anchor.target);
      if (x < -ANCHOR_HIT_PIXELS || x > width + ANCHOR_HIT_PIXELS) continue;
      context.globalAlpha = uiStore.postTool === "time" ? 0.9 : 0.4;
      context.fillRect(Math.round(x), 0, 1, height);
      context.beginPath();
      context.moveTo(x - 5, 0);
      context.lineTo(x + 5, 0);
      context.lineTo(x, 8);
      context.fill();
    }
    context.globalAlpha = 1;

    // Playback start point.
    const start = panel.playbackStart();
    if (start > 0) {
      const x = xOfTime(start);
      context.globalAlpha = 0.8;
      context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
      context.setLineDash([]);
      for (let y = 0; y < height; y += 6) {
        context.fillRect(Math.round(x), y, 1, 3);
      }
      context.globalAlpha = 1;
    }
  });

  const finishStroke = () => {
    if (drawing === null) return;
    drawing = null;
    panel.endStroke();
  };

  /** The values under the pointer, or dashes while it is off the canvas. */
  const readout = () => {
    const point = hover();
    const analysis = panel.analysis();
    if (point === null || analysis === null) {
      return { time: "–", cursor: "–", note: "–", analyzed: "–", edited: "–" };
    }
    const cursor = Math.exp(point.logHz);
    const describe = (value: number | undefined) =>
      value !== undefined && value > 0
        ? t2("bottom.post_hz", { value: value.toFixed(1) })
        : t1("bottom.post_unvoiced");
    return {
      time: t2("bottom.post_seconds", { value: point.output.toFixed(3) }),
      cursor: t2("bottom.post_hz", { value: cursor.toFixed(1) }),
      note: noteName(cursor),
      analyzed: describe(analysis.f0[point.frame]),
      edited: describe(panel.contour()[point.frame]),
    };
  };
  /**
   * Readout cells with fixed value widths, so moving the pointer never shifts
   * them; a value too long for its cell is clipped rather than wrapped.
   */
  const readoutFields = [
    { key: "time", label: "bottom.post_readout_time", width: "9ch" },
    { key: "cursor", label: "bottom.post_readout_cursor", width: "9ch" },
    { key: "note", label: "bottom.post_readout_note", width: "10ch" },
    { key: "analyzed", label: "bottom.post_readout_analyzed", width: "9ch" },
    { key: "edited", label: "bottom.post_readout_edited", width: "9ch" },
  ] as const;

  return (
    <div class="relative size-full flex flex-col">
      <div
        ref={(element) => {
          scrollElement = element;
        }}
        data-bottom-panel-scroll="post"
        class="flex-1 min-h-0 relative overflow-x-auto overflow-y-hidden text-ink-subtle"
        onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
        onWheel={panel.handleWheel}
      >
        <Switch
          fallback={
            <div class="flex size-full items-center justify-center select-none">
              {t1("bottom.no_query")}
            </div>
          }
        >
          <Match when={panel.queryExists() && panel.analysis() !== null}>
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
                    style={{ width: `${outputDuration() * panel.scale()}px` }}
                    minValue={0}
                    maxValue={Math.max(outputDuration(), 0.001)}
                    step={0.001}
                    value={[panel.playbackStart()]}
                    onChange={(value) => panel.setPlaybackStart(value[0])}
                    getValueLabel={(params) =>
                      t2("bottom.post_playback_start_value", {
                        time: params.values[0].toFixed(3),
                      })
                    }
                  >
                    <Slider.Track
                      class="relative size-full cursor-pointer hover:bg-primary-50 dark:hover:bg-primary-9"
                      data-post-timeline
                      onContextMenu={(event) => {
                        event.preventDefault();
                        panel.setPlaybackStart(0);
                      }}
                    >
                      <Slider.Thumb
                        aria-label={t1("bottom.post_playback_start")}
                        class="group top-0 block h-full w-3 outline-none"
                      >
                        <span
                          class="pointer-events-none absolute inset-y-0 left-1/2 w-1px bg-accent group-focus-visible:w-2px"
                          classList={{
                            "opacity-40": panel.playbackStart() <= 0,
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
                ref={(element) => {
                  canvasElement = element;
                }}
                role="img"
                aria-label={t1("bottom.post_canvas")}
                data-post-canvas
                class="sticky left-0 block shrink-0 touch-none"
                classList={{
                  "cursor-crosshair": uiStore.postTool !== "time",
                  "cursor-ew-resize": uiStore.postTool === "time",
                }}
                style={{
                  width: `${viewport().width}px`,
                  height: `${canvasHeight()}px`,
                }}
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                  if (event.button !== 0 && event.button !== 2) return;
                  const point = pointAt(event);
                  if (point === null) return;
                  const secondary = event.button === 2;
                  if (uiStore.postTool === "time") {
                    const source = panel.map().toSource(point.output);
                    if (
                      !panel.beginTimeEdit(
                        source,
                        anchorAt(point.output),
                        secondary,
                      )
                    ) {
                      return;
                    }
                    drawing = "time";
                  } else {
                    if (!panel.beginStroke(point, secondary)) return;
                    drawing = "pitch";
                  }
                  event.preventDefault();
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const point = pointAt(event);
                  setHover(point);
                  if (point === null) return;
                  if (drawing === "pitch") panel.moveStroke(point);
                  else if (drawing === "time") panel.moveTimeEdit(point.output);
                }}
                onPointerUp={finishStroke}
                onLostPointerCapture={finishStroke}
                onPointerLeave={() => setHover(null)}
              />
            </div>
          </Match>
          <Match when={panel.queryExists() && panel.error() !== null}>
            <div
              role="alert"
              class="flex size-full flex-col items-center justify-center gap-2 text-sm"
            >
              <span>{t1("bottom.post_failed")}</span>
              <span class="max-w-80% truncate text-xs">{panel.error()}</span>
              <Button
                class="rounded-md b b-border-menu px-2 py-0.5 outline-none hover:bg-hover focus-visible:(ring-2 ring-focus-ring-soft)"
                onClick={panel.retry}
              >
                {t1("bottom.post_retry")}
              </Button>
            </div>
          </Match>
          <Match when={panel.queryExists()}>
            <div
              role="status"
              class="flex size-full items-center justify-center gap-2 text-sm select-none"
            >
              <div
                aria-hidden="true"
                class="i-lucide:loader-circle size-4 animate-spin"
              />
              {t1("bottom.post_analyzing")}
            </div>
          </Match>
        </Switch>
      </div>
      <div class="h-6 w-full shrink-0 flex items-center gap-3 overflow-hidden px-2 text-xs text-ink-subtle">
        <Show when={panel.queryExists()}>
          <span class="min-w-0 flex-1 truncate">{t1("bottom.post_hint")}</span>
          <dl
            class="m0 grid shrink-0 grid-flow-col auto-cols-max gap-x-3"
            data-post-readout
          >
            <For each={readoutFields}>
              {(field) => (
                <div class="flex gap-1 whitespace-nowrap">
                  <dt class="opacity-70">{t1(field.label)}</dt>
                  <dd
                    class="m0 shrink-0 overflow-hidden text-right tabular-nums text-ink-secondary"
                    style={{ width: field.width }}
                    data-post-readout-field={field.key}
                  >
                    {readout()[field.key]}
                  </dd>
                </div>
              )}
            </For>
          </dl>
        </Show>
      </div>
    </div>
  );
}
