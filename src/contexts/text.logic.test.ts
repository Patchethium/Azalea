import { describe, expect, it, vi } from "vitest";
import { clampTextBlockIndex, createTextBlock } from "@contexts/text";

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

  it("creates blocks with independent stable IDs", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002");

    const first = createTextBlock("preset-2", "hello");
    const second = createTextBlock(null);

    expect(first).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      text: "hello",
      preset_id: "preset-2",
      query: null,
      query_is_modified: false,
    });
    expect(second.id).not.toBe(first.id);
    expect(second).toMatchObject({ text: "", preset_id: null, query: null });
  });
});
