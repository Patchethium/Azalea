import type { AccentPhrase, Mora } from "$binding";
import { SEMITONE } from "$constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pitchRange } from "../../../test/fixtures";
import { type PitchMapping, tuningColumns } from "./layout";
import { createDriftScale, createPitchScale } from "./pitchScale";
import {
  buildScene,
  drawScene,
  readSceneColors,
  type SceneColors,
  type TuningHover,
} from "./scene";

const mora = (overrides: Partial<Mora> = {}): Mora => ({
  text: "コ",
  consonant: "k",
  consonant_length: 0.2,
  vowel: "o",
  vowel_length: 0.2,
  pitch: 4.95,
  ...overrides,
});
const phrase = (moras: Mora[], pause: Mora | null = null): AccentPhrase => ({
  moras,
  accent: 1,
  pause_mora: pause,
  is_interrogative: false,
});

/** コ 0–40, ッ (unvoiced) 40–80, pause 80–130, ン 130–140 (narrow). */
const phrases = [
  phrase([mora(), mora({ text: "ッ", pitch: 0 })], {
    text: "、",
    consonant: null,
    consonant_length: null,
    vowel: "pau",
    vowel_length: 0.5,
    pitch: 0,
  }),
  phrase([
    mora({
      text: "ン",
      consonant: null,
      consonant_length: null,
      vowel: "N",
      vowel_length: 0.1,
      pitch: 7,
    }),
  ]),
];
const columns = tuningColumns(phrases, 100);

const absolute: PitchMapping = {
  pitchScale: createPitchScale(pitchRange()),
  driftScale: null,
};
const relative: PitchMapping = {
  pitchScale: createPitchScale(pitchRange()),
  driftScale: createDriftScale(12),
};

const scene = (
  overrides: Partial<Parameters<typeof buildScene>[0]> = {},
  hover: TuningHover = null,
) =>
  buildScene({
    columns,
    scrollLeft: 0,
    width: 200,
    height: 148,
    durationHeight: 48,
    mapping: absolute,
    baselineFor: () => null,
    hover,
    ...overrides,
  });

describe("buildScene", () => {
  it("lays out voiced, unvoiced and pause columns", () => {
    const built = scene();
    expect(built).toMatchObject({ width: 200, height: 148, plotHeight: 100 });
    expect(built.columns.map(({ column }) => column.mora.text)).toEqual([
      "コ",
      "ッ",
      "、",
      "ン",
    ]);
    const [voiced, unvoiced, pause, narrow] = built.columns;
    expect(voiced).toMatchObject({
      x: 0,
      width: 40,
      stripTop: 100,
      moraLabel: "コ",
      cells: null,
      pitch: {
        y: expect.closeTo(50),
        hovered: false,
        fill: null,
        baselineY: null,
        ghost: null,
        badge: null,
      },
    });
    expect(unvoiced).toMatchObject({ pitch: null, stripTop: 100 });
    expect(pause).toMatchObject({ pitch: null, stripTop: 0, moraLabel: null });
    // Too narrow for its text.
    expect(narrow).toMatchObject({ width: 10, moraLabel: null });
  });

  it("culls columns outside the viewport and offsets the rest", () => {
    const built = scene({ scrollLeft: 60, width: 50 });
    expect(built.columns.map(({ column }) => column.mora.text)).toEqual([
      "ッ",
      "、",
    ]);
    expect(built.columns[0].x).toBe(-20);
    expect(scene({ scrollLeft: 500 }).columns).toEqual([]);
  });

  it("shows the hovered pitch span and value", () => {
    const hovered = scene({}, { index: 0, part: "pitch" }).columns[0];
    expect(hovered.pitch).toMatchObject({
      hovered: true,
      fill: { top: expect.closeTo(50), bottom: 100 },
      badge: "4.95",
    });
    expect(hovered.moraLabel).toBe("コ");
    // Narrow columns have no room for the value.
    expect(
      scene({}, { index: 3, part: "pitch" }).columns[3].pitch,
    ).toMatchObject({ hovered: true, badge: null });
  });

  it("swaps the mora text for its cells on the hovered duration strip", () => {
    const hovered = scene({}, { index: 0, part: "consonant" }).columns[0];
    expect(hovered.moraLabel).toBeNull();
    expect(hovered.pitch!.hovered).toBe(false);
    expect(hovered.cells).toEqual({
      consonant: { x: 0, width: 20, label: "k", hovered: true },
      vowel: { x: 20, width: 20, label: "o", hovered: false },
    });
    // Pauses and consonantless moras have a single unlabeled or vowel cell.
    expect(scene({}, { index: 2, part: "vowel" }).columns[2].cells).toEqual({
      consonant: null,
      vowel: { x: 80, width: 50, label: null, hovered: true },
    });
    expect(scene({}, { index: 3, part: "vowel" }).columns[3].cells).toEqual({
      consonant: null,
      vowel: { x: 130, width: 10, label: "N", hovered: true },
    });
    // Labels wider than their cell are dropped.
    const squeezed = buildScene({
      columns: tuningColumns(phrases, 40),
      scrollLeft: 0,
      width: 200,
      height: 148,
      durationHeight: 48,
      mapping: absolute,
      baselineFor: () => null,
      hover: { index: 0, part: "vowel" },
    }).columns[0];
    expect(squeezed.cells).toMatchObject({
      consonant: { label: null },
      vowel: { label: null, hovered: true },
    });
    expect(squeezed.moraLabel).toBeNull();
  });

  it("draws the prediction as a baseline on the absolute scale", () => {
    const built = scene({ baselineFor: () => 4.175 });
    expect(built.columns[0].pitch).toMatchObject({
      y: expect.closeTo(50),
      baselineY: expect.closeTo(75),
      ghost: null,
    });
    // No shared scale, no baseline.
    const spanless: PitchMapping = {
      pitchScale: createPitchScale({
        ...pitchRange(),
        histogram_min: 5,
        histogram_max: 5,
      }),
      driftScale: null,
    };
    expect(
      scene({ mapping: spanless, baselineFor: () => 4.175 }).columns[0].pitch
        ?.baselineY,
    ).toBeNull();
  });

  it("centers relative pitches on the prediction with an absolute ghost", () => {
    const baselineFor = () => 4.95 - 6 * SEMITONE;
    const built = scene(
      { mapping: relative, baselineFor },
      { index: 0, part: "pitch" },
    );
    expect(built.columns[0].pitch).toMatchObject({
      y: expect.closeTo(25),
      baselineY: 50,
      fill: { top: expect.closeTo(25), bottom: 50 },
      ghost: { y: expect.closeTo(50), outOfRange: null },
      badge: "+6.0",
    });
    // Below the prediction the span hangs from the center line.
    expect(
      scene(
        { mapping: relative, baselineFor: () => 4.95 + 6 * SEMITONE },
        { index: 0, part: "pitch" },
      ).columns[0].pitch?.fill,
    ).toEqual({ top: 50, bottom: expect.closeTo(75) });
    // Pitches beyond the shared scale stay pinned to its edge.
    expect(built.columns[3].pitch?.ghost).toEqual({
      y: 0,
      outOfRange: "above",
    });
    const low = buildScene({
      columns: tuningColumns([phrase([mora({ pitch: 3 })])], 100),
      scrollLeft: 0,
      width: 200,
      height: 148,
      durationHeight: 48,
      mapping: relative,
      baselineFor: () => 3,
      hover: null,
    });
    expect(low.columns[0].pitch?.ghost).toEqual({
      y: 100,
      outOfRange: "below",
    });
    // Without a prediction the absolute mapping and no ghost are used.
    expect(scene({ mapping: relative }).columns[0].pitch).toMatchObject({
      y: expect.closeTo(50),
      baselineY: null,
      ghost: null,
    });
  });

  it("fills whisper styles and short panels with the duration strip", () => {
    const whisper = scene({
      mapping: { pitchScale: createPitchScale(), driftScale: null },
    });
    expect(whisper.plotHeight).toBe(0);
    expect(whisper.columns[0]).toMatchObject({ pitch: null, stripTop: 0 });
    expect(scene({ height: 20 }).plotHeight).toBe(0);
  });
});

const colors: SceneColors = {
  text: "#111",
  border: "#222",
  faint: "#333",
  surface: "#444",
  accent: "#555",
  hover: "#666",
  fillAlpha: 0.6,
  font: "16px sans-serif",
  badgeFont: "11px sans-serif",
};

describe("drawScene", () => {
  const context = () =>
    document
      .createElement("canvas")
      .getContext("2d") as CanvasRenderingContext2D;
  const texts = (target: CanvasRenderingContext2D) =>
    vi.mocked(target.fillText).mock.calls.map(([text]) => text);

  afterEach(() => {
    Reflect.deleteProperty(context(), "roundRect");
  });

  it("paints text, cells and every pitch decoration", () => {
    const target = context();
    drawScene(
      target,
      scene(
        { mapping: relative, baselineFor: () => 4.95 - 6 * SEMITONE },
        { index: 0, part: "pitch" },
      ),
      colors,
    );
    expect(target.clearRect).toHaveBeenCalledWith(0, 0, 200, 148);
    expect(texts(target)).toEqual(["コ", "ッ", "+6.0"]);
    // The hovered span from the pitch down to the prediction.
    expect(target.fillRect).toHaveBeenCalledWith(
      0,
      expect.closeTo(25),
      40,
      expect.closeTo(25),
    );
    // The pause cell covers its whole column.
    expect(target.fillRect).toHaveBeenCalledWith(80, 0, 50, 148);
    // Without roundRect the badge is a plain rectangle.
    expect(target.fillRect).toHaveBeenCalledWith(4, expect.closeTo(17), 32, 16);
    // The arrow of the out-of-range ghost on ン.
    expect(target.lineTo).toHaveBeenCalledWith(135, 3);
  });

  it("paints hovered duration cells and a rounded badge where supported", () => {
    const target = context();
    const roundRect = vi.fn();
    Object.assign(target, { roundRect });
    drawScene(target, scene({}, { index: 0, part: "vowel" }), colors);
    expect(texts(target)).toEqual(["k", "o", "ッ"]);
    expect(target.fillRect).toHaveBeenCalledWith(20, 100, 20, 48);

    vi.mocked(target.fillText).mockClear();
    const below = buildScene({
      columns: tuningColumns([phrase([mora({ pitch: 3 })])], 100),
      scrollLeft: 0,
      width: 200,
      height: 148,
      durationHeight: 48,
      mapping: relative,
      baselineFor: () => 3,
      hover: { index: 0, part: "pitch" },
    });
    drawScene(target, below, colors);
    expect(texts(target)).toEqual(["コ", "0"]);
    expect(roundRect).toHaveBeenCalledWith(4, 42, 32, 16, 6);
    // The arrow points down from the bottom edge of the pitch area.
    expect(target.lineTo).toHaveBeenCalledWith(20, 97);
  });
});

describe("readSceneColors", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("resolves theme tokens with fallbacks and tints the hover color", () => {
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const light = readSceneColors(canvas, [0, 100, 200], false);
    expect(light).toMatchObject({
      border: "#e2e8f0",
      faint: "#94a3b8",
      surface: "#ffffff",
      accent: "rgb(0, 100, 200)",
      hover: "rgb(235, 243, 251)",
      fillAlpha: 1,
      badgeFont: expect.stringMatching(/^11px /),
    });

    canvas.style.setProperty("--az-border", " #123456 ");
    canvas.style.fontSize = "13px";
    canvas.style.fontFamily = "Test Sans";
    canvas.style.color = "rgb(1, 2, 3)";
    document.documentElement.classList.add("dark");
    const dark = readSceneColors(canvas, [0, 100, 200], true);
    expect(dark).toMatchObject({
      border: "#123456",
      text: "rgb(1, 2, 3)",
      hover: "rgb(0, 40, 80)",
      fillAlpha: 0.6,
      font: "13px Test Sans",
      badgeFont: "11px Test Sans",
    });
    canvas.remove();
  });
});
