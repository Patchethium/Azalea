import type { SpectrogramColumnsEvent } from "$binding";
import { describe, expect, it } from "vitest";
import {
  addSpectrogramColumns,
  createPartialSpectrogram,
  partialSpectrogramMatches,
  partialSpectrogramPreview,
  plainSpectrogram,
} from "./partialSpectrogram";

const columnsEvent = (
  columns: number[],
  decibels: number[],
  overrides: Partial<SpectrogramColumnsEvent> = {},
): SpectrogramColumnsEvent => ({
  blockId: "block",
  generationId: 1,
  hash: "hash",
  frameCount: 4,
  melBins: 2,
  durationSeconds: 1,
  columns,
  decibels,
  ...overrides,
});

describe("partial spectrogram", () => {
  it("normalizes revealed columns to the loudest one and leaves the rest transparent", () => {
    const first = columnsEvent([0, 1], [-20, -100, -60, -20]);
    const partial = createPartialSpectrogram(first);
    addSpectrogramColumns(partial, first);
    expect(partialSpectrogramPreview(partial)).toEqual({
      // Bin-major: bin 0 for columns 0..4, then bin 1.
      values: [255, 128, 0, 0, 0, 255, 0, 0],
      frameCount: 4,
      melBins: 2,
      durationSeconds: 1,
      revealed: new Uint8Array([1, 1, 0, 0]),
      underlay: null,
    });

    // A louder column rescales the earlier ones.
    addSpectrogramColumns(partial, columnsEvent([3], [0, -40]));
    expect(partialSpectrogramPreview(partial).values).toEqual([
      191, 64, 0, 255, 0, 191, 0, 128,
    ]);
  });

  it("keeps the previous preview as an underlay and copies the revealed columns", () => {
    const event = columnsEvent([1], [-10, -10]);
    const partial = createPartialSpectrogram(event);
    addSpectrogramColumns(partial, event);
    const previous = {
      values: [1, 2],
      frameCount: 1,
      melBins: 2,
      durationSeconds: 1,
    };
    const preview = partialSpectrogramPreview(partial, previous);
    expect(preview.underlay).toBe(previous);
    expect(Array.from(preview.revealed ?? [])).toEqual([0, 1, 0, 0]);
    partial.revealed[2] = 1;
    expect(Array.from(preview.revealed ?? [])).toEqual([0, 1, 0, 0]);
    expect(plainSpectrogram(preview)).toEqual({
      values: preview.values,
      frameCount: 4,
      melBins: 2,
      durationSeconds: 1,
    });
  });

  it("ignores columns out of range or without a full set of values", () => {
    const event = columnsEvent(
      [-1, 4, 1.5, 2, 3],
      [0, 0, 0, 0, 0, 0, -10, -10],
    );
    const partial = createPartialSpectrogram(event);
    addSpectrogramColumns(partial, event);
    // Only column 2 is valid and complete; column 3 has no values left.
    expect(Array.from(partial.revealed)).toEqual([0, 0, 1, 0]);
    expect(partial.maxDb).toBe(-10);
  });

  it("matches only events with the same finished geometry", () => {
    const partial = createPartialSpectrogram(columnsEvent([], []));
    expect(partialSpectrogramMatches(partial, columnsEvent([], []))).toBe(true);
    expect(
      partialSpectrogramMatches(
        partial,
        columnsEvent([], [], { frameCount: 5 }),
      ),
    ).toBe(false);
    expect(
      partialSpectrogramMatches(partial, columnsEvent([], [], { melBins: 3 })),
    ).toBe(false);
    expect(
      partialSpectrogramMatches(
        partial,
        columnsEvent([], [], { durationSeconds: 2 }),
      ),
    ).toBe(false);
  });
});
