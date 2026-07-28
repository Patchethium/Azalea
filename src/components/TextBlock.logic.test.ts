import { describe, expect, it } from "vitest";
import { audioQuery } from "../test/fixtures";
import { synthesisRequestFingerprint } from "./TextBlock";

describe("synthesisRequestFingerprint", () => {
  it("is stable for the same speaker and query", () => {
    const first = synthesisRequestFingerprint(audioQuery(), 1);
    const second = synthesisRequestFingerprint(audioQuery(), 1);

    expect(second).toEqual(first);
    expect(first.hash).toMatch(/^[0-9a-f]{8}-\d+$/);
  });

  it("changes for speaker and synthesis-affecting query changes", () => {
    const base = synthesisRequestFingerprint(audioQuery(), 1);
    expect(synthesisRequestFingerprint(audioQuery(), 2)).not.toEqual(base);
    expect(
      synthesisRequestFingerprint(audioQuery({ speedScale: 1.2 }), 1),
    ).not.toEqual(base);
  });
});
