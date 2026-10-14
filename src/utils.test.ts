import { describe, expect, it, vi } from "vitest";
import { audioQuery, preset } from "./test/fixtures";
import {
  countJapaneseMoras,
  createAudioFileName,
  createAudioSidecars,
  createUniqueName,
  getModifiedQuery,
  indexAfterMove,
  moveItem,
  addRecentProject,
  parseSrt,
  splitJapaneseMoras,
  toHalfWidthAscii,
  useSideEffect,
} from "$utils";

describe("countJapaneseMoras", () => {
  it("matches VOICEVOX compound-katakana mora rules", () => {
    expect(countJapaneseMoras("アザレア")).toBe(4);
    expect(countJapaneseMoras("キャット")).toBe(3);
    expect(countJapaneseMoras("ティー")).toBe(2);
    expect(countJapaneseMoras("ヴョデェグヮ")).toBe(3);
    expect(countJapaneseMoras("")).toBe(0);
    expect(splitJapaneseMoras("キャット")).toEqual(["キャ", "ッ", "ト"]);
  });
});

describe("toHalfWidthAscii", () => {
  it("narrows full-width ASCII without changing Japanese text", () => {
    expect(toHalfWidthAscii("Ａｚａｌｅａ　Ｖ２！辞書")).toBe("Azalea V2!辞書");
  });
});

describe("createAudioFileName", () => {
  it("returns the text unchanged without a truncation length", () => {
    expect(createAudioFileName("Hello world", 0)).toBe("Hello world");
    expect(createAudioFileName("Hello world", undefined)).toBe("Hello world");
  });

  it("truncates long text and counts the removed characters", () => {
    expect(createAudioFileName("abcdefghij", 5)).toBe("abc+5");
    expect(createAudioFileName("abc", 5)).toBe("abc");
  });
});

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

describe("createUniqueName", () => {
  it("keeps the base name when it is free", () => {
    expect(createUniqueName("New Preset", [])).toBe("New Preset");
    expect(createUniqueName("New Preset", ["New Preset (1)"])).toBe(
      "New Preset",
    );
  });

  it("appends the smallest unused numeric suffix", () => {
    expect(createUniqueName("New Preset", ["New Preset"])).toBe(
      "New Preset (1)",
    );
    expect(
      createUniqueName("New Preset", ["New Preset", "New Preset (1)"]),
    ).toBe("New Preset (2)");
    expect(
      createUniqueName("New Preset", [
        "New Preset",
        "New Preset (2)",
        "New Preset",
      ]),
    ).toBe("New Preset (1)");
  });
});

describe("moveItem", () => {
  it("moves an item forwards and backwards without mutating the source", () => {
    const items = ["a", "b", "c", "d"];
    expect(moveItem(items, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(items, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveItem(items, 1, 1)).toEqual(items);
    expect(items).toEqual(["a", "b", "c", "d"]);
  });

  it("ignores out-of-range indices", () => {
    expect(moveItem(["a", "b"], -1, 0)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 0, 2)).toEqual(["a", "b"]);
  });
});

describe("indexAfterMove", () => {
  it("tracks the moved item and the items it passed", () => {
    expect(indexAfterMove(0, 0, 2)).toBe(2);
    expect(indexAfterMove(1, 0, 2)).toBe(0);
    expect(indexAfterMove(2, 0, 2)).toBe(1);
    expect(indexAfterMove(3, 0, 2)).toBe(3);
    expect(indexAfterMove(1, 3, 1)).toBe(2);
    expect(indexAfterMove(2, 3, 1)).toBe(3);
    expect(indexAfterMove(0, 3, 1)).toBe(0);
  });
});

describe("addRecentProject", () => {
  it("moves the path to the front without duplicates and keeps the limit", () => {
    expect(addRecentProject([], "/a.azp")).toEqual(["/a.azp"]);
    expect(addRecentProject(["/a.azp", "/b.azp"], "/b.azp")).toEqual([
      "/b.azp",
      "/a.azp",
    ]);
    expect(
      addRecentProject(
        ["/a.azp", "/b.azp", "/c.azp", "/d.azp", "/e.azp"],
        "/f.azp",
      ),
    ).toEqual(["/f.azp", "/a.azp", "/b.azp", "/c.azp", "/d.azp"]);
    expect(addRecentProject(["/a.azp", "/b.azp"], "/c.azp", 2)).toEqual([
      "/c.azp",
      "/a.azp",
    ]);
  });
});

describe("createAudioSidecars", () => {
  it("requests only the enabled sidecar files", () => {
    expect(createAudioSidecars({}, "hello")).toEqual({
      text: "hello",
      lab: false,
    });
    expect(createAudioSidecars({ export_text: false }, "hello")).toEqual({
      text: null,
      lab: false,
    });
    expect(
      createAudioSidecars({ export_text: true, export_lab: true }, "hello"),
    ).toEqual({ text: "hello", lab: true });
    expect(
      createAudioSidecars({ export_text: false, export_lab: true }, "hello"),
    ).toEqual({
      text: null,
      lab: true,
    });
  });
});
