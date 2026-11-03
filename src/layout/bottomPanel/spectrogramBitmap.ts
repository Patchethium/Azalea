import { DEFAULT_PRIMARY_COLOR, PRIMARY_COLOR_PATTERN } from "$constants";
import type { PreparedPostAnalysis } from "@contexts/postAnalysis";

export const primaryRgb = (color: string) => {
  const hex = PRIMARY_COLOR_PATTERN.test(color) ? color : DEFAULT_PRIMARY_COLOR;
  return [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16),
  ) as [number, number, number];
};

/** Frames × rows of the spectrogram as a bitmap tinted with the primary color. */
export const spectrogramBitmap = (
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
