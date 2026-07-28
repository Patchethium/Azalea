import { describe, expect, it, vi } from "vitest";
import { clampTextBlockIndex, createTextBlock } from "./text";

describe("text-block helpers", () => {
  it.each([
    [0, 0, 0],
    [Number.NaN, 3, 0],
    [-2, 3, 0],
    [1.9, 3, 1],
    [9, 3, 2],
  ])("clamps index %s for %s blocks", (index, count, expected) => {
    expect(clampTextBlockIndex(index, count)).toBe(expected);
  });

  it("creates independent runtime-only blocks", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002");

    const first = createTextBlock(2, "hello");
    const second = createTextBlock(null);

    expect(first).toEqual({
      runtimeId: "00000000-0000-4000-8000-000000000001",
      text: "hello",
      preset_id: 2,
      query: null,
    });
    expect(second.runtimeId).not.toBe(first.runtimeId);
    expect(second).toMatchObject({ text: "", preset_id: null, query: null });
  });
});
