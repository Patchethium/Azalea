import { describe, expect, it, vi } from "vitest";
import { audioQuery, preset } from "./test/fixtures";
import { getModifiedQuery, parseSrt, useSideEffect } from "$utils";

describe("getModifiedQuery", () => {
  it("applies every preset parameter without mutating the source query", () => {
    const source = audioQuery();
    const sourceSnapshot = structuredClone(source);
    const result = getModifiedQuery(
      source,
      preset({
        speed: 125,
        pitch: 0.2,
        intonation: 1.3,
        volume: 0.8,
        start_slience: 250,
        end_slience: 750,
      }),
    );

    expect(result).not.toBe(source);
    expect(result).toMatchObject({
      speedScale: 1.25,
      pitchScale: 0.2,
      intonationScale: 1.3,
      volumeScale: 0.8,
      prePhonemeLength: 0.25,
      postPhonemeLength: 0.75,
    });
    expect(source).toEqual(sourceSnapshot);
  });
});

describe("useSideEffect", () => {
  it("preserves arguments, return values, and call ordering", () => {
    const calls: string[] = [];
    const wrapped = useSideEffect(
      (left: number, right: number) => {
        calls.push("function");
        return left + right;
      },
      () => calls.push("effect"),
    );

    expect(wrapped(2, 3)).toBe(5);
    expect(calls).toEqual(["function", "effect"]);
  });

  it("does not run the side effect if the wrapped function throws", () => {
    const effect = vi.fn();
    const wrapped = useSideEffect(() => {
      throw new Error("failure");
    }, effect);

    expect(wrapped).toThrow("failure");
    expect(effect).not.toHaveBeenCalled();
  });
});

describe("parseSrt", () => {
  it("extracts each cue's text in order, joining multi-line cues", () => {
    const content = `1
00:00:00,000 --> 00:00:02,000
Hello there

2
00:00:02,500 --> 00:00:05,000
Line one
Line two

3
00:00:05,500 --> 00:00:07,000
<i>Goodbye</i> now`;
    expect(parseSrt(content)).toEqual([
      "Hello there",
      "Line one Line two",
      "Goodbye now",
    ]);
  });

  it("tolerates BOM, CRLF line endings, and files without timestamps", () => {
    const content =
      "\uFEFF1\r\n00:00:00,000 --> 00:00:01,000\r\nFirst\r\n\r\n2\r\n00:00:01,000 --> 00:00:02,000\r\nSecond\r\n";
    expect(parseSrt(content)).toEqual(["First", "Second"]);

    const untimed = "Just some\nlines";
    expect(parseSrt(untimed)).toEqual(["Just some lines"]);
  });

  it("drops empty blocks and cues without text", () => {
    const content = `1
00:00:00,000 --> 00:00:01,000
Keep me

2
00:00:01,000 --> 00:00:02,000
<b></b>




3
00:00:02,000 --> 00:00:03,000
Still here`;
    expect(parseSrt(content)).toEqual(["Keep me", "Still here"]);
    expect(parseSrt("")).toEqual([]);
  });
});
