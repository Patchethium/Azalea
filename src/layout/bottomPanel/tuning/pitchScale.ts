import type { PitchRange, PitchScale as PitchScaleMode } from "$binding";

const HISTOGRAM_BINS = 128;
const DENSITY_WEIGHT = 0.8;
const LINEAR_MIN = 3;
const LINEAR_MAX = 6.5;

export function createPitchScale(
  range?: PitchRange,
  mode: PitchScaleMode = "Optimal",
) {
  const min = mode === "Linear" ? LINEAR_MIN : (range?.histogram_min ?? 0);
  const max = mode === "Linear" ? LINEAR_MAX : (range?.histogram_max ?? 0);
  const span = max - min;
  const histogram = range?.histogram ?? [];
  const valid =
    mode === "DensityAware" &&
    histogram.length === HISTOGRAM_BINS &&
    histogram.every((count) => Number.isFinite(count) && count >= 0);
  const total = valid ? histogram.reduce((sum, count) => sum + count, 0) : 0;
  const positions = [0];
  for (let i = 0; i < HISTOGRAM_BINS; i++) {
    // The linear share leaves empty bins and the padded tails editable.
    const weight =
      total > 0
        ? (1 - DENSITY_WEIGHT) / HISTOGRAM_BINS +
          (DENSITY_WEIGHT * histogram[i]) / total
        : 1 / HISTOGRAM_BINS;
    positions.push(positions[i] + weight);
  }
  positions[HISTOGRAM_BINS] = 1;

  const toPosition = (pitch: number) => {
    if (span <= 0) return 0;
    const bin =
      ((Math.min(Math.max(pitch, min), max) - min) / span) * HISTOGRAM_BINS;
    const index = Math.min(Math.floor(bin), HISTOGRAM_BINS - 1);
    return (
      positions[index] +
      (positions[index + 1] - positions[index]) * (bin - index)
    );
  };
  const toPitch = (position: number) => {
    const value = Math.min(Math.max(position, 0), 1);
    let low = 0;
    let high = HISTOGRAM_BINS;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (positions[middle] > value) high = middle;
      else low = middle;
    }
    const fraction =
      (value - positions[low]) / (positions[high] - positions[low]);
    return min + ((low + fraction) / HISTOGRAM_BINS) * span;
  };

  return { min, max, toPosition, toPitch };
}

export type PitchScale = ReturnType<typeof createPitchScale>;
