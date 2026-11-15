import type { AccentPhrase, Mora } from "$binding";
import { SEMITONE } from "$constants";
import { describe, expect, it } from "vitest";
import { pitchRange } from "../../../test/fixtures";
import {
  columnAt,
  driftBaseline,
  firstColumnAfter,
  hitTest,
  isWhisper,
  type PitchMapping,
  pitchBadge,
  pitchPosition,
  positionToPitch,
  resetTarget,
  strokePositions,
  timelineWidth,
  tuningColumns,
} from "./layout";
import { createDriftScale, createPitchScale } from "./pitchScale";

const mora = (overrides: Partial<Mora> = {}): Mora => ({
  text: "コ",
  consonant: "k",
  consonant_length: 0.1,
  vowel: "o",
  vowel_length: 0.2,
  pitch: 5,
  ...overrides,
});
const pause: Mora = {
  text: "、",
  consonant: null,
  consonant_length: null,
  vowel: "pau",
  vowel_length: 0.5,
  pitch: 0,
};
const phrase = (
  moras: Mora[],
  pauseMora: Mora | null = null,
): AccentPhrase => ({
  moras,
  accent: 1,
  pause_mora: pauseMora,
  is_interrogative: false,
});

/** コ 0–30, ア 30–50, pause 50–100, ッ (unvoiced) 100–130, ン 130–160. */
const columns = tuningColumns(
  [
    phrase(
      [mora(), mora({ text: "ア", consonant: null, consonant_length: null })],
      pause,
    ),
    phrase([mora({ text: "ッ", pitch: 0 }), mora({ text: "ン" })]),
  ],
  100,
);

const absolute: PitchMapping = {
  pitchScale: createPitchScale(pitchRange()),
  driftScale: null,
};
const relative: PitchMapping = {
  pitchScale: createPitchScale(pitchRange()),
  driftScale: createDriftScale(12),
};

describe("tuning columns", () => {
  it("flattens moras and pauses with their pixel geometry", () => {
    expect(
      columns.map(({ mora: { text }, phraseIndex, moraIndex, isPause }) => [
        text,
        phraseIndex,
        moraIndex,
        isPause,
      ]),
    ).toEqual([
      ["コ", 0, 0, false],
      ["ア", 0, 1, false],
      ["、", 0, -1, true],
      ["ッ", 1, 0, false],
      ["ン", 1, 1, false],
    ]);
    expect(columns.map(({ index }) => index)).toEqual([0, 1, 2, 3, 4]);
    expect(columns.map(({ start }) => Math.round(start))).toEqual([
      0, 30, 50, 100, 130,
    ]);
    expect(columns[0]).toMatchObject({
      consonantWidth: expect.closeTo(10),
      vowelWidth: 20,
      width: 30,
    });
    expect(columns[1]).toMatchObject({ consonantWidth: null, width: 20 });
    expect(timelineWidth(columns)).toBeCloseTo(160);
    expect(timelineWidth([])).toBe(0);
    // A consonant without a length takes no room.
    expect(
      tuningColumns([phrase([mora({ consonant_length: null })])], 100)[0],
    ).toMatchObject({ consonantWidth: 0, width: 20 });
  });

  it("finds the column under a position", () => {
    expect(columnAt(columns, -1)).toBeNull();
    expect(columnAt(columns, 0)?.mora.text).toBe("コ");
    expect(columnAt(columns, 29.9)?.mora.text).toBe("コ");
    expect(columnAt(columns, 30)?.mora.text).toBe("ア");
    expect(columnAt(columns, 159)?.mora.text).toBe("ン");
    expect(columnAt(columns, 160)).toBeNull();
    expect(columnAt([], 0)).toBeNull();
    expect(firstColumnAfter(columns, 1000)).toBe(columns.length);
  });

  it("tells the pitch area from the duration cells", () => {
    const part = (x: number, y: number, whisper = false) =>
      hitTest(columns, x, y, 100, whisper)?.part;
    expect(part(5, 20)).toBe("pitch");
    expect(part(5, 100)).toBe("consonant");
    expect(part(15, 120)).toBe("vowel");
    // Moras without a consonant only have a vowel cell.
    expect(part(31, 120)).toBe("vowel");
    // Unvoiced moras still have a pitch area; pauses do not.
    expect(part(110, 20)).toBe("pitch");
    expect(part(60, 20)).toBe("vowel");
    expect(hitTest(columns, 60, 20, 100, false)?.column.isPause).toBe(true);
    // Whisper styles have no pitch area at all.
    expect(part(5, 20, true)).toBe("consonant");
    expect(hitTest(columns, 500, 20, 100, false)).toBeNull();
  });
});

describe("pitch mapping", () => {
  it("maps absolute pitches through the shared scale", () => {
    expect(isWhisper(absolute)).toBe(false);
    expect(
      isWhisper({ pitchScale: createPitchScale(), driftScale: null }),
    ).toBe(true);
    expect(driftBaseline(absolute, 5)).toBeNull();
    expect(pitchPosition(4.95, 5, absolute)).toBeCloseTo(0.5);
    expect(positionToPitch(0.5, 5, absolute)).toBeCloseTo(4.95);
    expect(pitchBadge(5.678, 5, absolute)).toBe("5.68");
  });

  it("maps relative pitches to drift from a known prediction", () => {
    expect(driftBaseline(relative, 5)).toBe(5);
    expect(pitchPosition(5, 5, relative)).toBe(0.5);
    expect(pitchPosition(5 + 6 * SEMITONE, 5, relative)).toBeCloseTo(0.75);
    expect(positionToPitch(0.25, 5, relative)).toBeCloseTo(5 - 6 * SEMITONE);
    expect(pitchBadge(5 + 6 * SEMITONE, 5, relative)).toBe("+6.0");
    expect(pitchBadge(5 - 1.5 * SEMITONE, 5, relative)).toBe("-1.5");
    // Never "-0.0" on the prediction.
    expect(pitchBadge(5 - 0.01 * SEMITONE, 5, relative)).toBe("0");
  });

  it("falls back to the absolute mapping without a prediction", () => {
    for (const baseline of [null, undefined, 0]) {
      expect(resetTarget(baseline)).toBeNull();
      expect(driftBaseline(relative, baseline)).toBeNull();
      expect(pitchPosition(4.95, baseline, relative)).toBeCloseTo(0.5);
      expect(positionToPitch(0.5, baseline, relative)).toBeCloseTo(4.95);
      expect(pitchBadge(4.95, baseline, relative)).toBe("4.95");
    }
    expect(resetTarget(5)).toBe(5);
  });
});

describe("stroke positions", () => {
  const touched = (
    from: [number, number],
    to: [number, number],
    plotHeight = 100,
  ) =>
    strokePositions(
      columns,
      { x: from[0], y: from[1] },
      { x: to[0], y: to[1] },
      plotHeight,
    ).map(({ column, position }) => [column.mora.text, position]);

  it("sets the mora under a still pointer and clamps to the pitch area", () => {
    expect(touched([5, 25], [5, 25])).toEqual([["コ", 0.75]]);
    expect(touched([5, -50], [5, -50])).toEqual([["コ", 1]]);
    expect(touched([5, 500], [5, 500])).toEqual([["コ", 0]]);
    // Nothing voiced under the pointer, or no pitch area.
    expect(touched([60, 25], [60, 25])).toEqual([]);
    expect(touched([110, 25], [110, 25])).toEqual([]);
    expect(touched([500, 25], [500, 25])).toEqual([]);
    expect(touched([5, 25], [5, 25], 0)).toEqual([]);
  });

  it("interpolates across the moras between two pointer positions", () => {
    // コ and ン lie under the ends; ア's center at 40 is 35/140 along.
    expect(touched([5, 20], [145, 80])).toEqual([
      ["コ", 0.8],
      ["ア", expect.closeTo(1 - (20 + (35 / 140) * 60) / 100)],
      ["ン", expect.closeTo(0.2)],
    ]);
    // The same stroke leftwards gives each end its own height.
    expect(touched([145, 80], [5, 20])).toEqual([
      ["コ", 0.8],
      ["ア", expect.closeTo(1 - (20 + (35 / 140) * 60) / 100)],
      ["ン", expect.closeTo(0.2)],
    ]);
  });
});
