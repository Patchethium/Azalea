import type { Mora, SpectrogramPreview } from "$binding";
import {
  DEFAULT_BOTTOM_SCALE,
  DEFAULT_PRIMARY_COLOR,
  PRIMARY_COLOR_PATTERN,
} from "$constants";
import { useConfigStore } from "@contexts/config";
import { Slider } from "@kobalte/core/slider";
import type { DraggingMode } from "@layout/bottomPanel/types";
import _ from "lodash";
import { createEffect, Show } from "solid-js";

export function TuningItem(props: {
  mora: Mora;
  startDraggingDur: (origin: number, mode: DraggingMode) => void;
  setPitch: (pitch: number) => void;
  minPitch: number;
  maxPitch: number;
  isPause?: boolean;
}) {
  const { config, spectrogramPreviewEnabled } = useConfigStore()!;
  const unvoiced = () => props.mora.pitch === 0;
  const whisper = () => props.maxPitch === 0 && props.minPitch === 0;
  const scale = () => config.ui_config?.bottom_scale ?? DEFAULT_BOTTOM_SCALE;
  const consonantPixels = (): number | null =>
    props.mora.consonant == null
      ? null
      : props.mora.consonant_length! * scale();
  const vowelPixels = () => props.mora.vowel_length * scale();
  const totalPixels = () => (consonantPixels() ?? 0) + vowelPixels();

  return (
    <div
      class="flex flex-none flex-col b-dashed b-r b-slate-3 dark:b-slate-6 h-100% select-none relative z-1"
      style={{ width: `${totalPixels()}px` }}
    >
      <Show when={!whisper()}>
        <Show
          when={!unvoiced()}
          fallback={
            <div class="flex-1 content-empty b-dashed b-b b-slate-3 dark:b-slate-6" />
          }
        >
          <Slider
            class="flex-1 b-b b-slate-3 dark:b-slate-6 b-dashed overflow-hidden"
            classList={{ "opacity-60": spectrogramPreviewEnabled() }}
            minValue={props.minPitch}
            maxValue={props.maxPitch}
            step={0.01}
            value={[props.mora.pitch]}
            onChange={(value) => props.setPitch(value[0])}
            orientation="vertical"
          >
            <Slider.Track class="size-full bg-transparent relative group">
              <Slider.Fill class="absolute bg-transparent w-full group-hover:!bg-primary-50 dark:group-hover:!bg-primary-9" />
              <Slider.Thumb class="block h-1px w-full bg-slate-4 outline-none group-hover:!bg-primary-5">
                <Slider.Input />
              </Slider.Thumb>
            </Slider.Track>
          </Slider>
        </Show>
      </Show>
      <div
        class="group relative flex flex-row bg-white dark:bg-slate-8"
        classList={{ "h-full": whisper(), "h-12": !whisper() }}
      >
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center group-hover:invisible">
          {props.isPause ? "" : props.mora.text}
        </div>
        <Show when={consonantPixels() != null}>
          <div
            class="invisible flex items-center justify-center b-dashed b-r b-slate3 group-hover:visible dark:b-slate-6 hover:!bg-primary-50 dark:hover:!bg-primary-9"
            onMouseDown={() =>
              props.startDraggingDur(props.mora.consonant_length!, "consonant")
            }
            style={{ width: `${consonantPixels()}px` }}
          >
            {props.mora.consonant}
          </div>
        </Show>
        <div
          class="invisible flex items-center justify-center group-hover:visible hover:!bg-primary-50 dark:hover:!bg-primary-9"
          onMouseDown={() =>
            props.startDraggingDur(props.mora.vowel_length, "vowel")
          }
          style={{ width: `${vowelPixels()}px` }}
        >
          {props.isPause ? "" : props.mora.vowel}
        </div>
      </div>
    </div>
  );
}

export function SpectrogramCanvas(props: {
  preview: SpectrogramPreview;
  width: number;
  preSilence: number;
  postSilence: number;
  stale: boolean;
}) {
  const { config } = useConfigStore()!;
  let canvasRef!: HTMLCanvasElement;

  createEffect(() => {
    const { values, frameCount, melBins, durationSeconds } = props.preview;
    if (
      frameCount === 0 ||
      melBins === 0 ||
      durationSeconds <= 0 ||
      values.length !== frameCount * melBins
    ) {
      canvasRef.width = 0;
      canvasRef.height = 0;
      return;
    }
    const audibleStart = _.clamp(
      Math.floor((props.preSilence / durationSeconds) * frameCount),
      0,
      frameCount - 1,
    );
    const audibleEnd = _.clamp(
      Math.ceil(
        ((durationSeconds - props.postSilence) / durationSeconds) * frameCount,
      ),
      audibleStart + 1,
      frameCount,
    );
    const visibleFrames = audibleEnd - audibleStart;
    canvasRef.width = visibleFrames;
    canvasRef.height = melBins;

    const context = canvasRef.getContext("2d");
    if (context === null) return;
    const configuredColor =
      config.ui_config.primary_color ?? DEFAULT_PRIMARY_COLOR;
    const primaryColor = PRIMARY_COLOR_PATTERN.test(configuredColor)
      ? configuredColor
      : DEFAULT_PRIMARY_COLOR;
    const red = Number.parseInt(primaryColor.slice(1, 3), 16);
    const green = Number.parseInt(primaryColor.slice(3, 5), 16);
    const blue = Number.parseInt(primaryColor.slice(5, 7), 16);
    const pixels = context.createImageData(visibleFrames, melBins);
    for (let y = 0; y < melBins; y++) {
      const sourceBin = melBins - y - 1;
      for (let x = 0; x < visibleFrames; x++) {
        const strength =
          values[sourceBin * frameCount + audibleStart + x] / 255;
        const pixel = (y * visibleFrames + x) * 4;
        pixels.data[pixel] = red;
        pixels.data[pixel + 1] = green;
        pixels.data[pixel + 2] = blue;
        pixels.data[pixel + 3] = Math.round(
          Math.max(0, strength - 0.08) ** 1.35 * 105,
        );
      }
    }
    context.putImageData(pixels, 0, 0);
  });

  return (
    <canvas
      ref={(element) => {
        canvasRef = element;
      }}
      class="absolute left-0 top-0 pointer-events-none"
      classList={{ "opacity-55": props.stale }}
      style={{
        width: `${props.width}px`,
        height: "calc(100% - 3rem)",
        filter: props.stale ? "grayscale(1)" : undefined,
      }}
    />
  );
}
