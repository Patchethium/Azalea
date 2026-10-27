import { postEditBase } from "$utils";
import { describe, expect, it } from "vitest";
import { audioQuery, mora } from "../../../test/fixtures";
import {
  activePostEdit,
  addAnchor,
  buildPostEdit,
  contourFromEdit,
  decodeSpectrogram,
  drawLine,
  f0Segments,
  phonemeSpans,
  moraSpans,
  moveAnchor,
  noteName,
  removeAnchor,
  restoreFrames,
  timeMap,
} from "./postEdit";

describe("post edit helpers", () => {
  it("fingerprints the synthesized query and style", () => {
    const query = audioQuery();
    expect(postEditBase(query, 1)).toBe(postEditBase(audioQuery(), 1));
    expect(postEditBase(query, 2)).not.toBe(postEditBase(query, 1));
    expect(postEditBase({ ...query, speedScale: 1.5 }, 1)).not.toBe(
      postEditBase(query, 1),
    );
  });

  it("applies an edit only to the content it was made on", () => {
    const query = audioQuery();
    const edit = {
      base: postEditBase(query, 1),
      f0: [{ start: 0, f0: [200] }],
      time: [],
    };
    expect(activePostEdit({ post: edit }, query, 1)).toBe(edit);
    expect(activePostEdit({ post: edit }, query, 2)).toBeNull();
    expect(activePostEdit({ post: null }, query, 1)).toBeNull();
    expect(activePostEdit({}, query, 1)).toBeNull();
    expect(activePostEdit({ post: { ...edit, f0: [] } }, query, 1)).toBeNull();
    const timed = { ...edit, f0: [], time: [{ source: 0.1, target: 0.2 }] };
    expect(activePostEdit({ post: timed }, query, 1)).toBe(timed);
  });

  it("converts between contours and sparse segments", () => {
    const analyzed = [100, 0, 100, 100, 100, 100];
    const contour = [100, 150, 160, 100, 120, 100];
    const segments = f0Segments(analyzed, contour);
    expect(segments).toEqual([
      { start: 1, f0: [150, 160] },
      { start: 4, f0: [120] },
    ]);
    const edit = buildPostEdit("base", segments, []);
    expect(edit).toEqual({ base: "base", f0: segments, time: [] });
    expect(contourFromEdit(analyzed, edit)).toEqual(contour);
    expect(contourFromEdit(analyzed, null)).toEqual(analyzed);
    expect(f0Segments(analyzed, [...analyzed])).toEqual([]);
    expect(buildPostEdit("base", [], [])).toBeNull();
    // Frames beyond the analysis are ignored.
    expect(
      contourFromEdit([1, 2], {
        base: "b",
        f0: [{ start: 1, f0: [5, 6] }],
        time: [],
      }),
    ).toEqual([1, 5]);
  });

  it("maps time both ways and keeps the last anchor's offset", () => {
    const map = timeMap([
      { source: 1, target: 2 },
      { source: 2, target: 2.5 },
    ]);
    expect(map.points).toEqual([
      [0, 0],
      [1, 2],
      [2, 2.5],
    ]);
    expect(map.toTarget(0.5)).toBe(1);
    expect(map.toTarget(1.5)).toBe(2.25);
    expect(map.toTarget(3)).toBe(3.5);
    expect(map.toSource(1)).toBe(0.5);
    expect(map.toSource(2.25)).toBe(1.5);
    expect(map.toSource(3.5)).toBe(3);
    expect(timeMap([]).toTarget(1.25)).toBe(1.25);
  });

  it("adds, moves, and removes time anchors within the rate limits", () => {
    const first = addAnchor([], 0.5)!;
    expect(first).toEqual({
      anchors: [{ source: 0.5, target: 0.5 }],
      index: 0,
    });
    // Adding on a stretched map keeps the timing unchanged.
    const stretched = [{ source: 0.5, target: 1 }];
    const added = addAnchor(stretched, 0.25)!;
    expect(added.index).toBe(0);
    expect(added.anchors[0]).toEqual({ source: 0.25, target: 0.5 });
    expect(addAnchor(stretched, 0.502)).toBeNull();
    expect(addAnchor(stretched, 0)).toBeNull();

    const anchors = [
      { source: 1, target: 1 },
      { source: 2, target: 2 },
    ];
    // Later anchors move with the dragged one, keeping their spans.
    expect(moveAnchor(anchors, 0, 1.5)).toEqual([
      { source: 1, target: 1.5 },
      { source: 2, target: 2.5 },
    ]);
    // Only the span before the anchor limits it: at most 4× and at least ¼.
    expect(moveAnchor(anchors, 0, 9)[0].target).toBe(4);
    expect(moveAnchor(anchors, 0, 0)).toEqual([
      { source: 1, target: 0.25 },
      { source: 2, target: 1.25 },
    ]);
    expect(moveAnchor(anchors, 1, 9)).toEqual([
      { source: 1, target: 1 },
      { source: 2, target: 5 },
    ]);
    expect(moveAnchor(anchors, 5, 9)).toEqual(anchors);
    expect(removeAnchor(anchors, 0)).toEqual([{ source: 2, target: 2 }]);
  });

  it("draws log-frequency lines over voiced frames", () => {
    const analyzed = [100, 100, 0, 100, 100];
    const from = { frame: 0, logHz: Math.log(100) };
    const to = { frame: 4, logHz: Math.log(400) };
    const voiced = drawLine(analyzed, analyzed, from, to, false);
    expect(voiced[0]).toBeCloseTo(100);
    expect(voiced[1]).toBeCloseTo(100 * Math.SQRT2);
    expect(voiced[2]).toBe(0);
    expect(voiced[4]).toBeCloseTo(400);
    // Drawing backwards and on unvoiced frames.
    const forced = drawLine(analyzed, analyzed, to, from, true);
    expect(forced[2]).toBeCloseTo(200);
    // A single frame, clipped to the contour.
    const single = drawLine(
      analyzed,
      analyzed,
      { frame: 9, logHz: Math.log(300) },
      { frame: 9, logHz: Math.log(300) },
      false,
    );
    expect(single).toEqual(analyzed);
    const point = drawLine(analyzed, analyzed, from, from, false);
    expect(point[0]).toBeCloseTo(100);
  });

  it("restores frames around a span", () => {
    const analyzed = [1, 2, 3, 4, 5, 6];
    const contour = [9, 9, 9, 9, 9, 9];
    expect(restoreFrames(contour, analyzed, 3, 2, 1)).toEqual([
      9, 2, 3, 4, 5, 9,
    ]);
    expect(restoreFrames(contour, analyzed, 0, 0, 3)).toEqual([
      1, 2, 3, 4, 9, 9,
    ]);
  });

  it("decodes the base64 spectrogram", () => {
    expect([...decodeSpectrogram(btoa("\u0000\u0080ÿ"))]).toEqual([
      0, 128, 255,
    ]);
  });

  it("splits moras into phonemes on the synthesized timeline", () => {
    const query = audioQuery({
      speedScale: 2,
      prePhonemeLength: 0.2,
      accent_phrases: [
        {
          moras: [
            { ...mora, text: "コ", consonant_length: 0.1, vowel_length: 0.1 },
            {
              ...mora,
              text: "ン",
              consonant: null,
              consonant_length: null,
              vowel: "N",
              vowel_length: 0.2,
            },
          ],
          accent: 1,
          pause_mora: {
            ...mora,
            text: "、",
            consonant: null,
            consonant_length: null,
            vowel: "pau",
            vowel_length: 0.4,
          },
          is_interrogative: false,
        },
      ],
    });
    const spans = phonemeSpans(query);
    expect(spans.map((span) => span.text)).toEqual(["k", "o", "N", "pau"]);
    expect(spans[0].start).toBeCloseTo(0.1);
    expect(spans[0].end).toBeCloseTo(0.15);
    expect(spans[1].end).toBeCloseTo(0.2);
    expect(spans[2].end).toBeCloseTo(0.3);
    expect(spans[3].end).toBeCloseTo(0.5);
    expect(phonemeSpans({ ...query, speedScale: 0 })[0].start).toBeCloseTo(0.2);
    // Moras keep their katakana and span their consonant and vowel.
    const moras = moraSpans(query);
    expect(moras.map((span) => span.text)).toEqual(["コ", "ン", "、"]);
    expect(moras[0].end).toBeCloseTo(0.2);
    expect(moras[2].end).toBeCloseTo(0.5);
    expect(moraSpans({ ...query, speedScale: 0 })[0].start).toBeCloseTo(0.2);
  });

  it("names the nearest note with a cent offset", () => {
    expect(noteName(440)).toBe("A4 +0");
    expect(noteName(261.63)).toBe("C4 +0");
    expect(noteName(450)).toBe("A4 +39");
    expect(noteName(430)).toBe("A4 −40");
  });
});
