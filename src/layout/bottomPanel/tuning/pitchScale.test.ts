import type { PitchRange } from "$binding";
import { describe, expect, it } from "vitest";
import { createPitchScale } from "./pitchScale";

const range = (histogram: number[]): PitchRange => ({
  min: 4,
  max: 6,
  histogram_min: 3.4,
  histogram_max: 6.5,
  histogram,
});

describe("density-aware pitch scale", () => {
  it("allocates more space and finer pitch changes to dense bins", () => {
    const histogram = Array<number>(128).fill(1);
    histogram[64] = 1000;
    const scale = createPitchScale(range(histogram), "DensityAware");
    const binWidth = (scale.max - scale.min) / 128;
    const dense = scale.min + binWidth * 64.5;
    const sparse = scale.min + binWidth * 10.5;
    const densePosition = scale.toPosition(dense);
    const sparsePosition = scale.toPosition(sparse);
    expect(scale.toPosition(dense + 0.001) - densePosition).toBeGreaterThan(
      scale.toPosition(sparse + 0.001) - sparsePosition,
    );
    expect(scale.toPitch(densePosition + 0.001) - dense).toBeLessThan(
      scale.toPitch(sparsePosition + 0.001) - sparse,
    );
  });

  it("round trips monotonically through occupied bins, empty bins and endpoints", () => {
    const histogram = Array<number>(128).fill(0);
    histogram[64] = 100;
    const scale = createPitchScale(range(histogram), "DensityAware");
    let previous = -1;
    for (let i = 0; i <= 1024; i++) {
      const position = i / 1024;
      const pitch = scale.toPitch(position);
      expect(pitch).toBeGreaterThan(previous);
      expect(scale.toPosition(pitch)).toBeCloseTo(position, 12);
      previous = pitch;
    }
    expect(scale.toPosition(scale.min - 1)).toBe(0);
    expect(scale.toPosition(scale.max + 1)).toBe(1);
    expect(scale.toPitch(-1)).toBe(scale.min);
    expect(scale.toPitch(2)).toBe(scale.max);
  });

  it.each([
    Array(128).fill(1),
    Array(128).fill(0),
    [],
    [1, 2],
    Array(128).fill(-1),
    Array(128).fill(Number.NaN),
  ])(
    "uses linear spacing for uniform or unusable histograms %#",
    (histogram) => {
      const scale = createPitchScale(range(histogram), "DensityAware");
      expect(scale.toPosition(4.95)).toBeCloseTo(0.5);
      expect(scale.toPitch(0.5)).toBeCloseTo(4.95);
    },
  );

  it("handles missing and degenerate ranges without dividing by zero", () => {
    const missing = createPitchScale(undefined, "DensityAware");
    expect(missing.toPosition(5)).toBe(0);
    expect(missing.toPitch(0.5)).toBe(0);
    const constant = createPitchScale(
      {
        ...range([]),
        histogram_min: 5,
        histogram_max: 5,
      },
      "DensityAware",
    );
    expect(constant.toPosition(5)).toBe(0);
    expect(constant.toPitch(0.5)).toBe(5);

    const linear = createPitchScale(undefined, "Linear");
    expect([linear.min, linear.toPitch(0.5), linear.max]).toEqual([
      3, 4.75, 6.5,
    ]);
  });
});
