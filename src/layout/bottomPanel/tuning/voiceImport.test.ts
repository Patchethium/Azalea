import type { AccentPhrase, PitchRange } from "$binding";
import { describe, expect, it } from "vitest";
import {
  fitScale,
  mapPitches,
  moraPitches,
  pitchBounds,
  pitchSpread,
  SEMITONE,
  targetSpread,
  withPitches,
} from "./voiceImport";

const range = (overrides: Partial<PitchRange> = {}): PitchRange => ({
  min: 5,
  max: 6,
  histogram_min: 4.7,
  histogram_max: 6.3,
  histogram: [],
  ...overrides,
});

const phrases = (pitches: number[][]): AccentPhrase[] =>
  pitches.map((moras) => ({
    accent: 1,
    is_interrogative: false,
    pause_mora: null,
    moras: moras.map((pitch) => ({
      text: "ア",
      consonant: null,
      consonant_length: null,
      vowel: "a",
      vowel_length: 0.1,
      pitch,
    })),
  }));

describe("pitchSpread", () => {
  it("ignores unvoiced pitches and returns null without voiced ones", () => {
    expect(pitchSpread([0, 0])).toBeNull();
    expect(pitchSpread([0, 4, 0, 6])).toEqual({ center: 5, width: 2 });
  });

  it("drops outliers beyond the 97% window", () => {
    const pitches = [...Array.from({ length: 99 }, (_, i) => 5 + i / 100), 9];
    const spread = pitchSpread(pitches)!;
    expect(spread.width).toBeLessThan(1);
    expect(spread.center).toBeLessThan(5.6);
  });
});

describe("targetSpread", () => {
  it("prefers the style range and falls back to predicted pitches", () => {
    expect(targetSpread(range(), [5.5])).toEqual({ center: 5.5, width: 1 });
    expect(targetSpread(undefined, [5, 0, 5.4])).toEqual({
      center: 5.2,
      width: expect.closeTo(0.4, 10),
    });
    expect(targetSpread(range({ min: 0, max: 0 }), [])).toBeNull();
  });
});

describe("fitScale", () => {
  it("matches widths within the allowed scale range", () => {
    expect(
      fitScale({ center: 0, width: 0.5 }, { center: 0, width: 0.25 }),
    ).toBe(0.5);
    expect(fitScale({ center: 0, width: 0.1 }, { center: 0, width: 1 })).toBe(
      2,
    );
    expect(fitScale({ center: 0, width: 1 }, { center: 0, width: 0.1 })).toBe(
      0.25,
    );
    expect(fitScale({ center: 0, width: 0 }, { center: 0, width: 1 })).toBe(1);
  });
});

describe("mapPitches", () => {
  const user = [4.5, 0, 5.0, 5.5];
  const target = { center: 6, width: 0.5 };

  it("centers on the target and fits the width by default", () => {
    expect(mapPitches(user, target, { scale: null, offset: 0 })).toEqual([
      5.75, 0, 6, 6.25,
    ]);
  });

  it("applies an explicit scale and a semitone offset", () => {
    const mapped = mapPitches(user, target, { scale: 1, offset: 12 });
    expect(mapped[0]).toBeCloseTo(5.5 + 12 * SEMITONE);
    expect(mapped[1]).toBe(0);
    expect(mapped[3]).toBeCloseTo(6.5 + 12 * SEMITONE);
  });

  it("clamps to bounds and keeps an all-unvoiced input at zero", () => {
    expect(
      mapPitches(user, target, { scale: 2, offset: 0 }, [5.8, 6.1]),
    ).toEqual([5.8, 0, 6, 6.1]);
    expect(mapPitches([0, 0], target, { scale: null, offset: 0 })).toEqual([
      0, 0,
    ]);
  });
});

describe("pitchBounds", () => {
  it("returns histogram bounds only for a spanning range", () => {
    expect(pitchBounds(range())).toEqual([4.7, 6.3]);
    expect(pitchBounds(range({ histogram_max: 4.7 }))).toBeUndefined();
    expect(pitchBounds(undefined)).toBeUndefined();
  });
});

describe("withPitches", () => {
  it("replaces pitches in mora order without mutating the input", () => {
    const original = phrases([[1, 2], [3]]);
    const updated = withPitches(original, [7, 8, 9]);
    expect(moraPitches(updated)).toEqual([7, 8, 9]);
    expect(moraPitches(original)).toEqual([1, 2, 3]);
  });
});
