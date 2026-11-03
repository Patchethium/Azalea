import type { AccentPhrase, PitchRange } from "$binding";

/** Natural-log pitch of one semitone. */
export const SEMITONE = Math.LN2 / 12;
export const MIN_IMPORT_SCALE = 0.25;
export const MAX_IMPORT_SCALE = 2;
export const MIN_IMPORT_OFFSET = -12;
export const MAX_IMPORT_OFFSET = 12;
/** Share of voiced pitches the spread covers, as `PitchRange::from_samples`. */
const SPREAD_SHARE = 0.97;

/** The center and width of a set of log pitches. */
export interface PitchSpread {
  center: number;
  width: number;
}

/**
 * How imported pitches are moved into the voice's range: the user's center
 * lands on the voice's center, shifted by `offset` semitones, and the contour
 * around it is scaled by `scale`, or fit to the voice's width when null.
 */
export interface PitchMapping {
  scale: number | null;
  offset: number;
}

export const DEFAULT_PITCH_MAPPING: Readonly<PitchMapping> = Object.freeze({
  scale: null,
  offset: 0,
});

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * The midpoint and width of the narrowest window holding 97% of the voiced
 * (positive) pitches, or null without any.
 */
export function pitchSpread(pitches: readonly number[]): PitchSpread | null {
  const voiced = pitches
    .filter((pitch) => Number.isFinite(pitch) && pitch > 0)
    .sort((a, b) => a - b);
  if (voiced.length === 0) return null;
  const count = Math.max(Math.ceil(voiced.length * SPREAD_SHARE), 1);
  let best = [voiced[0], voiced[count - 1]];
  for (let i = 1; i + count <= voiced.length; i++) {
    const window = [voiced[i], voiced[i + count - 1]];
    if (window[1] - window[0] < best[1] - best[0]) best = window;
  }
  return { center: (best[0] + best[1]) / 2, width: best[1] - best[0] };
}

/**
 * The voice's spread: the style's built-in range when it has one, otherwise
 * the pitches VOICEVOX predicted for the block.
 */
export function targetSpread(
  range: PitchRange | undefined,
  predicted: readonly number[],
): PitchSpread | null {
  if (range !== undefined && range.max > 0 && range.max >= range.min) {
    return {
      center: (range.min + range.max) / 2,
      width: range.max - range.min,
    };
  }
  return pitchSpread(predicted);
}

/** The scale that gives the user's contour the voice's width. */
export function fitScale(user: PitchSpread, target: PitchSpread) {
  if (user.width <= 0) return 1;
  return clamp(target.width / user.width, MIN_IMPORT_SCALE, MAX_IMPORT_SCALE);
}

/** Pitches of every mora, pauses excluded, in order. */
export const moraPitches = (phrases: readonly AccentPhrase[]) =>
  phrases.flatMap((phrase) => phrase.moras.map((mora) => mora.pitch));

/**
 * Maps the speaker's log pitches into the voice's range. Unvoiced moras (0)
 * stay 0, and mapped pitches are clamped to `bounds` when given.
 */
export function mapPitches(
  pitches: readonly number[],
  target: PitchSpread,
  mapping: PitchMapping,
  bounds?: readonly [number, number],
): number[] {
  const user = pitchSpread(pitches);
  if (user === null) return pitches.map(() => 0);
  const scale = mapping.scale ?? fitScale(user, target);
  const center = target.center + mapping.offset * SEMITONE;
  return pitches.map((pitch) => {
    if (!(pitch > 0)) return 0;
    const mapped = center + scale * (pitch - user.center);
    return bounds === undefined ? mapped : clamp(mapped, bounds[0], bounds[1]);
  });
}

/** The style's editable pitch bounds, when it has a range. */
export const pitchBounds = (
  range: PitchRange | undefined,
): [number, number] | undefined =>
  range !== undefined && range.histogram_max > range.histogram_min
    ? [range.histogram_min, range.histogram_max]
    : undefined;

/** `phrases` with each mora's pitch replaced, in [`moraPitches`] order. */
export function withPitches(
  phrases: readonly AccentPhrase[],
  pitches: readonly number[],
): AccentPhrase[] {
  let index = 0;
  return phrases.map((phrase) => ({
    ...phrase,
    moras: phrase.moras.map((mora) => ({ ...mora, pitch: pitches[index++] })),
  }));
}
