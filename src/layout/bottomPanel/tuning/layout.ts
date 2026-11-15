import type { AccentPhrase, Mora } from "$binding";
import { SEMITONE } from "$constants";
import type { DriftScale, PitchScale } from "./pitchScale";

/** A mora or pause mora on the tuning timeline, in pixels from its start. */
export type TuningColumn = {
  mora: Mora;
  phraseIndex: number;
  /** Index within the phrase, or -1 for the phrase's pause mora. */
  moraIndex: number;
  isPause: boolean;
  /** Position in flattened mora order, pauses included. */
  index: number;
  start: number;
  /** Null for moras without a consonant. */
  consonantWidth: number | null;
  vowelWidth: number;
  width: number;
};

export const tuningColumns = (
  phrases: readonly AccentPhrase[],
  scale: number,
): TuningColumn[] => {
  const columns: TuningColumn[] = [];
  let start = 0;
  const push = (
    mora: Mora,
    phraseIndex: number,
    moraIndex: number,
    isPause: boolean,
  ) => {
    const consonantWidth =
      mora.consonant == null ? null : (mora.consonant_length ?? 0) * scale;
    const vowelWidth = mora.vowel_length * scale;
    const width = (consonantWidth ?? 0) + vowelWidth;
    columns.push({
      mora,
      phraseIndex,
      moraIndex,
      isPause,
      index: columns.length,
      start,
      consonantWidth,
      vowelWidth,
      width,
    });
    start += width;
  };
  phrases.forEach((phrase, phraseIndex) => {
    phrase.moras.forEach((mora, moraIndex) => {
      push(mora, phraseIndex, moraIndex, false);
    });
    if (phrase.pause_mora !== null) {
      push(phrase.pause_mora, phraseIndex, -1, true);
    }
  });
  return columns;
};

export const timelineWidth = (columns: readonly TuningColumn[]) => {
  const last = columns[columns.length - 1];
  return last === undefined ? 0 : last.start + last.width;
};

/** Index of the first column ending after `x`, or `columns.length`. */
export const firstColumnAfter = (
  columns: readonly TuningColumn[],
  x: number,
) => {
  let low = 0;
  let high = columns.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (columns[middle].start + columns[middle].width > x) high = middle;
    else low = middle + 1;
  }
  return low;
};

/** The column under timeline position `x`, if any. */
export const columnAt = (columns: readonly TuningColumn[], x: number) => {
  const column = columns[firstColumnAfter(columns, x)];
  return column !== undefined && x >= column.start ? column : null;
};

/**
 * How pitches map to vertical positions: the shared absolute scale, and the
 * drift scale while relative tuning is on.
 */
export type PitchMapping = {
  pitchScale: PitchScale;
  driftScale: DriftScale | null;
};

/** Styles without a pitch range (whisper) have no pitch area at all. */
export const isWhisper = ({ pitchScale }: PitchMapping) =>
  pitchScale.max === 0 && pitchScale.min === 0;

/** The prediction a pitch can be reset to, if one is known. */
export const resetTarget = (baseline: number | null | undefined) =>
  baseline != null && baseline > 0 ? baseline : null;

/**
 * The prediction relative tuning is centered on; null selects the absolute
 * mapping, which is also the fallback until a baseline is known.
 */
export const driftBaseline = (
  mapping: PitchMapping,
  baseline: number | null | undefined,
) => (mapping.driftScale === null ? null : resetTarget(baseline));

/** Position of `pitch` between the bottom (0) and top (1) of the pitch area. */
export const pitchPosition = (
  pitch: number,
  baseline: number | null | undefined,
  mapping: PitchMapping,
) => {
  const center = driftBaseline(mapping, baseline);
  return center === null
    ? mapping.pitchScale.toPosition(pitch)
    : mapping.driftScale!.toPosition((pitch - center) / SEMITONE);
};

export const positionToPitch = (
  position: number,
  baseline: number | null | undefined,
  mapping: PitchMapping,
) => {
  const center = driftBaseline(mapping, baseline);
  return center === null
    ? mapping.pitchScale.toPitch(position)
    : center + mapping.driftScale!.toDrift(position) * SEMITONE;
};

/** The value shown on a hovered mora: log pitch, or signed semitone drift. */
export const pitchBadge = (
  pitch: number,
  baseline: number | null | undefined,
  mapping: PitchMapping,
) => {
  const center = driftBaseline(mapping, baseline);
  if (center === null) return pitch.toFixed(2);
  const value = ((pitch - center) / SEMITONE).toFixed(1);
  // Avoid "-0.0" when the pitch sits on the prediction.
  return Number(value) > 0 ? `+${value}` : Number(value) < 0 ? value : "0";
};

export type TuningPart = "pitch" | "consonant" | "vowel";

export type TuningHit = { column: TuningColumn; part: TuningPart };

/**
 * What lies under a point of the timeline. `plotHeight` is the height of the
 * pitch area; pause moras and whisper styles fill it with their duration cell.
 */
export const hitTest = (
  columns: readonly TuningColumn[],
  x: number,
  y: number,
  plotHeight: number,
  whisper: boolean,
): TuningHit | null => {
  const column = columnAt(columns, x);
  if (column === null) return null;
  if (!whisper && !column.isPause && y < plotHeight) {
    return { column, part: "pitch" };
  }
  return {
    column,
    part:
      column.consonantWidth !== null && x - column.start < column.consonantWidth
        ? "consonant"
        : "vowel",
  };
};

export type StrokePoint = { x: number; y: number };

/**
 * The voiced moras a pointer segment crosses, each with the position the
 * segment has above it: the pointer's own height on the moras under its two
 * ends, and the interpolated height at the center of those in between.
 */
export const strokePositions = (
  columns: readonly TuningColumn[],
  from: StrokePoint,
  to: StrokePoint,
  plotHeight: number,
): { column: TuningColumn; position: number }[] => {
  if (plotHeight <= 0) return [];
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const contains = (column: TuningColumn, x: number) =>
    x >= column.start && x < column.start + column.width;
  const touched: { column: TuningColumn; position: number }[] = [];
  for (
    let index = firstColumnAfter(columns, left);
    index < columns.length && columns[index].start <= right;
    index++
  ) {
    const column = columns[index];
    if (column.isPause || column.mora.pitch === 0) continue;
    let y: number;
    if (contains(column, to.x)) y = to.y;
    else if (contains(column, from.x)) y = from.y;
    else {
      const center = column.start + column.width / 2;
      y = from.y + ((center - from.x) / (to.x - from.x)) * (to.y - from.y);
    }
    touched.push({
      column,
      position: Math.min(Math.max(1 - y / plotHeight, 0), 1),
    });
  }
  return touched;
};
