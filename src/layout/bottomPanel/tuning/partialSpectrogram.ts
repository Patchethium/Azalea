import type { SpectrogramColumnsEvent, SpectrogramPreview } from "$binding";

/** Matches the backend preview: values span this many decibels below the loudest one. */
export const SPECTROGRAM_DYNAMIC_RANGE_DB = 80;

/**
 * A preview as drawn on the canvas. While a streamed render is in progress, columns not yet
 * `revealed` show the previous preview, `underlay`, grayed out.
 */
export type DisplayedSpectrogram = SpectrogramPreview & {
  revealed?: Uint8Array;
  underlay?: SpectrogramPreview | null;
};

/** The preview data alone, without what only a partial preview carries. */
export const plainSpectrogram = ({
  values,
  frameCount,
  melBins,
  durationSeconds,
}: SpectrogramPreview): SpectrogramPreview => ({
  values,
  frameCount,
  melBins,
  durationSeconds,
});

/** Columns of a streamed render's spectrogram received so far, in raw decibels. */
export type PartialSpectrogram = {
  frameCount: number;
  melBins: number;
  durationSeconds: number;
  /** Decibels laid out like `SpectrogramPreview.values`: bin-major, `bin * frameCount + column`. */
  decibels: Float32Array;
  revealed: Uint8Array;
  maxDb: number;
};

export const createPartialSpectrogram = (
  event: SpectrogramColumnsEvent,
): PartialSpectrogram => ({
  frameCount: event.frameCount,
  melBins: event.melBins,
  durationSeconds: event.durationSeconds,
  decibels: new Float32Array(event.frameCount * event.melBins),
  revealed: new Uint8Array(event.frameCount),
  maxDb: Number.NEGATIVE_INFINITY,
});

/** Whether `event` belongs to the same finished geometry as `partial`. */
export const partialSpectrogramMatches = (
  partial: PartialSpectrogram,
  event: SpectrogramColumnsEvent,
) =>
  partial.frameCount === event.frameCount &&
  partial.melBins === event.melBins &&
  partial.durationSeconds === event.durationSeconds;

/** Stores the event's columns; columns out of range or with missing values are ignored. */
export const addSpectrogramColumns = (
  partial: PartialSpectrogram,
  event: SpectrogramColumnsEvent,
) => {
  const { frameCount, melBins } = partial;
  event.columns.forEach((column, index) => {
    if (!Number.isInteger(column) || column < 0 || column >= frameCount) return;
    const offset = index * melBins;
    if (offset + melBins > event.decibels.length) return;
    for (let bin = 0; bin < melBins; bin++) {
      const db = event.decibels[offset + bin];
      partial.decibels[bin * frameCount + column] = db;
      if (db > partial.maxDb) partial.maxDb = db;
    }
    partial.revealed[column] = 1;
  });
};

/**
 * A preview of the revealed columns, normalized to the loudest revealed value like the
 * finished preview. Unrevealed columns are zero and show `underlay` instead.
 */
export const partialSpectrogramPreview = (
  partial: PartialSpectrogram,
  underlay: SpectrogramPreview | null = null,
): DisplayedSpectrogram => {
  const { frameCount, melBins, decibels, revealed, maxDb } = partial;
  const floor = maxDb - SPECTROGRAM_DYNAMIC_RANGE_DB;
  const values: number[] = Array.from(
    { length: frameCount * melBins },
    () => 0,
  );
  for (let bin = 0; bin < melBins; bin++) {
    for (let column = 0; column < frameCount; column++) {
      if (revealed[column] === 0) continue;
      const index = bin * frameCount + column;
      const strength = (decibels[index] - floor) / SPECTROGRAM_DYNAMIC_RANGE_DB;
      values[index] = Math.round(Math.min(Math.max(strength, 0), 1) * 255);
    }
  }
  return {
    values,
    frameCount,
    melBins,
    durationSeconds: partial.durationSeconds,
    revealed: new Uint8Array(revealed),
    underlay,
  };
};
