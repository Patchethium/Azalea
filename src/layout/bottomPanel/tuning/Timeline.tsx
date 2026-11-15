import type { SpectrogramPreview } from "$binding";
import { DEFAULT_PRIMARY_COLOR, PRIMARY_COLOR_PATTERN } from "$constants";
import { useConfigStore } from "@contexts/config";
import _ from "lodash";
import { createEffect } from "solid-js";
import type { DisplayedSpectrogram } from "./partialSpectrogram";

/** Columns between the configured leading and trailing silence. */
const audibleColumns = (
  preview: SpectrogramPreview,
  preSilence: number,
  postSilence: number,
) => {
  const { frameCount, durationSeconds } = preview;
  const start = _.clamp(
    Math.floor((preSilence / durationSeconds) * frameCount),
    0,
    frameCount - 1,
  );
  const end = _.clamp(
    Math.ceil(((durationSeconds - postSilence) / durationSeconds) * frameCount),
    start + 1,
    frameCount,
  );
  return { start, end };
};

const isDrawable = (preview: SpectrogramPreview) =>
  preview.frameCount > 0 &&
  preview.melBins > 0 &&
  preview.durationSeconds > 0 &&
  preview.values.length === preview.frameCount * preview.melBins;

/** Opacity of a stale preview, matching the canvas's `opacity-55` styling. */
const STALE_OPACITY = 0.55;

const spectrogramAlpha = (strength: number) =>
  Math.round(Math.max(0, strength - 0.08) ** 1.35 * 105);

export function SpectrogramCanvas(props: {
  preview: DisplayedSpectrogram;
  width: number;
  durationHeight: number;
  preSilence: number;
  postSilence: number;
  stale: boolean;
}) {
  const { config } = useConfigStore()!;
  let canvasRef!: HTMLCanvasElement;

  createEffect(() => {
    const { values, frameCount, melBins, revealed, underlay } = props.preview;
    if (!isDrawable(props.preview)) {
      canvasRef.width = 0;
      canvasRef.height = 0;
      return;
    }
    const audible = audibleColumns(
      props.preview,
      props.preSilence,
      props.postSilence,
    );
    const visibleFrames = audible.end - audible.start;
    canvasRef.width = visibleFrames;
    canvasRef.height = melBins;

    const context = canvasRef.getContext("2d");
    if (context === null) return;
    const configuredColor = config.ui.primary_color ?? DEFAULT_PRIMARY_COLOR;
    const primaryColor = PRIMARY_COLOR_PATTERN.test(configuredColor)
      ? configuredColor
      : DEFAULT_PRIMARY_COLOR;
    const red = Number.parseInt(primaryColor.slice(1, 3), 16);
    const green = Number.parseInt(primaryColor.slice(3, 5), 16);
    const blue = Number.parseInt(primaryColor.slice(5, 7), 16);
    // The same luminance a CSS `grayscale(1)` filter gives the primary color.
    const gray = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
    // While a streamed render is in progress, unrevealed columns show the previous preview
    // grayed out, sampled at the same position on the timeline.
    const drawableUnderlay =
      revealed !== undefined && underlay != null && isDrawable(underlay)
        ? underlay
        : null;
    const underlayAudible =
      drawableUnderlay === null
        ? null
        : audibleColumns(drawableUnderlay, props.preSilence, props.postSilence);
    const pixels = context.createImageData(visibleFrames, melBins);
    for (let x = 0; x < visibleFrames; x++) {
      const column = audible.start + x;
      const showsUnderlay = revealed !== undefined && revealed[column] === 0;
      let underlayColumn = -1;
      if (
        showsUnderlay &&
        drawableUnderlay !== null &&
        underlayAudible !== null
      ) {
        const underlayVisible = underlayAudible.end - underlayAudible.start;
        underlayColumn =
          underlayAudible.start +
          Math.min(
            Math.floor(((x + 0.5) / visibleFrames) * underlayVisible),
            underlayVisible - 1,
          );
      }
      for (let y = 0; y < melBins; y++) {
        const pixel = (y * visibleFrames + x) * 4;
        if (showsUnderlay) {
          if (drawableUnderlay === null || underlayColumn < 0) continue;
          const underlayBins = drawableUnderlay.melBins;
          const underlayBin = Math.min(
            Math.floor(((melBins - y - 0.5) / melBins) * underlayBins),
            underlayBins - 1,
          );
          const strength =
            drawableUnderlay.values[
              underlayBin * drawableUnderlay.frameCount + underlayColumn
            ] / 255;
          pixels.data[pixel] = gray;
          pixels.data[pixel + 1] = gray;
          pixels.data[pixel + 2] = gray;
          pixels.data[pixel + 3] = Math.round(
            spectrogramAlpha(strength) * STALE_OPACITY,
          );
          continue;
        }
        const strength = values[(melBins - y - 1) * frameCount + column] / 255;
        pixels.data[pixel] = red;
        pixels.data[pixel + 1] = green;
        pixels.data[pixel + 2] = blue;
        pixels.data[pixel + 3] = spectrogramAlpha(strength);
      }
    }
    context.putImageData(pixels, 0, 0);
  });

  return (
    <canvas
      ref={(element) => {
        canvasRef = element;
      }}
      data-spectrogram-canvas
      class="absolute left-0 top-0 pointer-events-none"
      classList={{ "opacity-55": props.stale }}
      style={{
        width: `${props.width}px`,
        height: `calc(100% - ${props.durationHeight}px)`,
        filter: props.stale ? "grayscale(1)" : undefined,
      }}
    />
  );
}
