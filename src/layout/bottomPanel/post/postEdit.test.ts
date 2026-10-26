import { postEditBase } from "$utils";
import { describe, expect, it } from "vitest";
import { audioQuery, mora } from "../../../test/fixtures";
import {
  activePostEdit,
  contourFromEdit,
  decodeSpectrogram,
  drawLine,
  editFromContour,
  moraSpans,
  noteName,
  restoreFrames,
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
      segments: [{ start: 0, f0: [200] }],
    };
    expect(activePostEdit({ post_f0: edit }, query, 1)).toBe(edit);
    expect(activePostEdit({ post_f0: edit }, query, 2)).toBeNull();
    expect(activePostEdit({ post_f0: null }, query, 1)).toBeNull();
    expect(activePostEdit({}, query, 1)).toBeNull();
    expect(
      activePostEdit({ post_f0: { ...edit, segments: [] } }, query, 1),
    ).toBeNull();
  });

  it("converts between contours and sparse segments", () => {
    const analyzed = [100, 0, 100, 100, 100, 100];
    const contour = [100, 150, 160, 100, 120, 100];
    const edit = editFromContour("base", analyzed, contour);
    expect(edit).toEqual({
      base: "base",
      segments: [
        { start: 1, f0: [150, 160] },
        { start: 4, f0: [120] },
      ],
    });
    expect(contourFromEdit(analyzed, edit)).toEqual(contour);
    expect(contourFromEdit(analyzed, null)).toEqual(analyzed);
    expect(editFromContour("base", analyzed, [...analyzed])).toBeNull();
    // Frames beyond the analysis are ignored.
    expect(
      contourFromEdit([1, 2], {
        base: "b",
        segments: [{ start: 1, f0: [5, 6] }],
      }),
    ).toEqual([1, 5]);
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

  it("places moras on the synthesized timeline", () => {
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
              vowel_length: 0.2,
            },
          ],
          accent: 1,
          pause_mora: {
            ...mora,
            text: "、",
            consonant: null,
            consonant_length: null,
            vowel_length: 0.4,
          },
          is_interrogative: false,
        },
      ],
    });
    const spans = moraSpans(query);
    expect(spans.map((span) => span.text)).toEqual(["コ", "ン", "、"]);
    expect(spans[0].start).toBeCloseTo(0.1);
    expect(spans[0].end).toBeCloseTo(0.2);
    expect(spans[1].end).toBeCloseTo(0.3);
    expect(spans[2].end).toBeCloseTo(0.5);
    expect(moraSpans({ ...query, speedScale: 0 })[0].start).toBeCloseTo(0.2);
  });

  it("names the nearest note with a cent offset", () => {
    expect(noteName(440)).toBe("A4 +0");
    expect(noteName(261.63)).toBe("C4 +0");
    expect(noteName(450)).toBe("A4 +39");
    expect(noteName(430)).toBe("A4 −40");
  });
});
