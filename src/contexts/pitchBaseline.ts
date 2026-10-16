import { createContextProvider } from "@solid-primitives/context";
import { createSignal } from "solid-js";

const PITCH_BASELINE_CACHE_LIMIT = 64;

/**
 * Caches relative-tuning baselines (per-mora predicted pitches) by a key that
 * identifies the prediction inputs, so remounting the tuning panel reuses them.
 */
export const createPitchBaselineCache = () => {
  const cache = new Map<string, number[][]>();
  const [revision, setRevision] = createSignal(0);

  const getPitchBaseline = (key: string) => {
    revision();
    return cache.get(key) ?? null;
  };

  /** Stores a baseline; `notify: false` is for writes during a computation. */
  const setPitchBaseline = (
    key: string,
    baseline: number[][],
    notify = true,
  ) => {
    cache.delete(key);
    cache.set(key, baseline);
    if (cache.size > PITCH_BASELINE_CACHE_LIMIT) {
      cache.delete(cache.keys().next().value!);
    }
    if (notify) setRevision((value) => value + 1);
  };

  return { getPitchBaseline, setPitchBaseline };
};

const [PitchBaselineProvider, usePitchBaselineStore] = createContextProvider(
  createPitchBaselineCache,
);

export { PitchBaselineProvider, usePitchBaselineStore };
