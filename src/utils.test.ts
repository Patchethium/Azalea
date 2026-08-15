import { describe, expect, it, vi } from "vitest";
import { audioQuery, preset } from "./test/fixtures";
import { getModifiedQuery, useSideEffect } from "$utils";

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
