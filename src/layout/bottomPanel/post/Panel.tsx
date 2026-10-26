import { DEFAULT_PRIMARY_COLOR, PRIMARY_COLOR_PATTERN } from "$constants";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import type { PreparedPostAnalysis } from "@contexts/postAnalysis";
import { Button } from "@kobalte/core/button";
import { Slider } from "@kobalte/core/slider";
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
import { noteName, type StrokePoint } from "./postEdit";
import { usePostPanel } from "./usePostPanel";

/** Height of the mora label strip above the plot. */
const STRIP_HEIGHT = 18;
/** Semitones of headroom above and below the analysis range. */
const RANGE_PADDING = 2 ** (2 / 12);

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
  const { config } = useConfigStore()!;
  const panel = usePostPanel();
  const [viewport, setViewport] = createSignal({ width: 0, height: 0 });
  const [scrollLeft, setScrollLeft] = createSignal(0);
  const [hover, setHover] = createSignal<StrokePoint | null>(null);
  let scrollElement: HTMLDivElement | undefined;
  let canvasElement: HTMLCanvasElement | undefined;
  let drawing = false;

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
  const totalWidth = () =>
    (panel.analysis()?.duration ?? 0) * panel.scale() + viewport().width / 4;
  const plotHeight = () => Math.max(1, viewport().height - STRIP_HEIGHT);
  const xOfFrame = (frame: number) =>
    frame * framePeriod() * panel.scale() - scrollLeft();
  const yOfHz = (hz: number) => {
    const { low, high } = range();
    return (
      STRIP_HEIGHT +
      (1 - Math.log(hz / low) / Math.log(high / low)) * plotHeight()
    );
  };

  const pointAt = (event: PointerEvent): StrokePoint | null => {
    const analysis = panel.analysis();
    if (analysis === null || canvasElement === undefined) return null;
    const rect = canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left + scrollLeft();
    const y = Math.min(
      Math.max(event.clientY - rect.top, STRIP_HEIGHT),
      viewport().height,
    );
    const frame = Math.min(
      Math.max(Math.round(x / panel.scale() / framePeriod()), 0),
      analysis.f0.length - 1,
    );
    const { low, high } = range();
    const logHz =
      Math.log(low) +
      (1 - (y - STRIP_HEIGHT) / plotHeight()) * Math.log(high / low);
    return { frame, logHz };
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
    const { width, height } = viewport();
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
    const pixelsPerFrame = framePeriod() * panel.scale();
    const firstFrame = Math.max(
      0,
      Math.floor(scrollLeft() / pixelsPerFrame) - 1,
    );
    const lastFrame = Math.min(
      frames - 1,
      Math.ceil((scrollLeft() + width) / pixelsPerFrame) + 1,
    );

    // Spectrogram, cropped to the visible frames and frequency range.
    const image = bitmap();
    if (image !== null) {
      const { rows, minHz, maxHz } = analysis.spectrogram;
      const { low, high } = range();
      const rowOf = (hz: number) =>
        ((rows - 1) * Math.log(hz / minHz)) / Math.log(maxHz / minHz);
      const top = rows - 1 - rowOf(high);
      const bottom = rows - 1 - rowOf(low);
      context.drawImage(
        image,
        firstFrame,
        top,
        lastFrame - firstFrame + 1,
        bottom - top,
        xOfFrame(firstFrame - 0.5),
        STRIP_HEIGHT,
        (lastFrame - firstFrame + 1) * pixelsPerFrame,
        plotHeight(),
      );
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

    // Mora labels and boundaries.
    context.globalAlpha = 1;
    context.textBaseline = "middle";
    for (const mora of panel.moras()) {
      const start = mora.start * panel.scale() - scrollLeft();
      const end = mora.end * panel.scale() - scrollLeft();
      if (end < 0 || start > width) continue;
      context.globalAlpha = 0.18;
      context.fillStyle = textColor;
      context.fillRect(Math.round(start), 0, 1, height);
      context.globalAlpha = 0.85;
      context.fillText(mora.text, start + 3, STRIP_HEIGHT / 2, end - start - 4);
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
  });

  const finishStroke = () => {
    if (!drawing) return;
    drawing = false;
    panel.endStroke();
  };

  const readout = () => {
    const point = hover();
    const analysis = panel.analysis();
    if (point === null || analysis === null) return t1("bottom.post_hint");
    const cursor = Math.exp(point.logHz);
    const analyzed = analysis.f0[point.frame];
    const edited = panel.contour()[point.frame];
    const describe = (value: number | undefined) =>
      value !== undefined && value > 0
        ? t2("bottom.post_hz", { value: value.toFixed(1) })
        : t1("bottom.post_unvoiced");
    return t2("bottom.post_readout", {
      time: (point.frame * framePeriod()).toFixed(3),
      cursor: cursor.toFixed(1),
      note: noteName(cursor),
      analyzed: describe(analyzed),
      edited: describe(edited),
    });
  };

  return (
    <div class="relative size-full flex flex-col">
      <div
        ref={(element) => {
          scrollElement = element;
        }}
        data-bottom-panel-scroll="post"
        class="flex-1 min-h-0 relative overflow-x-auto overflow-y-hidden text-slate-5 dark:text-slate-4"
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
              class="relative h-full"
              style={{ width: `${Math.max(totalWidth(), viewport().width)}px` }}
            >
              <canvas
                ref={(element) => {
                  canvasElement = element;
                }}
                role="img"
                aria-label={t1("bottom.post_canvas")}
                data-post-canvas
                class="sticky left-0 top-0 block touch-none cursor-crosshair"
                style={{
                  width: `${viewport().width}px`,
                  height: `${viewport().height}px`,
                }}
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                  if (event.button !== 0 && event.button !== 2) return;
                  const point = pointAt(event);
                  if (point === null) return;
                  if (!panel.beginStroke(point, event.button === 2)) return;
                  event.preventDefault();
                  drawing = true;
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const point = pointAt(event);
                  setHover(point);
                  if (drawing && point !== null) panel.moveStroke(point);
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
                class="rounded-md b b-slate-3 px-2 py-0.5 outline-none hover:bg-slate-1 focus-visible:(ring-2 ring-primary-2) dark:(b-slate-5 hover:bg-slate-7)"
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
      <div class="h-6 w-full flex items-center gap-3 px-2 text-xs text-slate-5 dark:text-slate-4">
        <Show when={panel.queryExists()}>
          <Slider
            class="relative flex flex-col w-20% shrink-0 select-none items-center group"
            minValue={panel.minScale}
            maxValue={panel.maxScale}
            value={[panel.scale()]}
            onChange={(value) => panel.setScale(value[0])}
            getValueLabel={() => t1("bottom.post_zoom")}
          >
            <Slider.Track class="w-full h-2 bg-slate-2 dark:bg-slate-6 rounded-full relative">
              <Slider.Fill class="absolute bg-slate-3 dark:bg-slate-5 rounded-full h-full group-hover:bg-primary-5" />
              <Slider.Thumb class="block size-4 bg-transparent rounded-full -top-1 outline-none">
                <Slider.Input aria-label={t1("bottom.post_zoom")} />
              </Slider.Thumb>
            </Slider.Track>
          </Slider>
          <span class="min-w-0 truncate tabular-nums" data-post-readout>
            {readout()}
          </span>
        </Show>
      </div>
    </div>
  );
}
