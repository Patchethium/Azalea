import type { PostF0Analysis } from "$binding";
import { createContextProvider } from "@solid-primitives/context";
import { createSignal } from "solid-js";

const POST_ANALYSIS_CACHE_LIMIT = 16;

/** A WORLD f0 analysis with its spectrogram decoded for drawing. */
export type PreparedPostAnalysis = Omit<PostF0Analysis, "spectrogram"> & {
  spectrogram: {
    rows: number;
    minHz: number;
    maxHz: number;
    values: Uint8Array;
  };
};

/**
 * Caches post-processing f0 analyses by the fingerprint of the synthesized
 * content, so switching tabs or blocks reuses them.
 */
export const createPostAnalysisCache = () => {
  const cache = new Map<string, PreparedPostAnalysis>();
  const [revision, setRevision] = createSignal(0);

  const getPostAnalysis = (key: string) => {
    revision();
    return cache.get(key) ?? null;
  };

  const setPostAnalysis = (key: string, analysis: PreparedPostAnalysis) => {
    cache.delete(key);
    cache.set(key, analysis);
    if (cache.size > POST_ANALYSIS_CACHE_LIMIT) {
      cache.delete(cache.keys().next().value!);
    }
    setRevision((value) => value + 1);
  };

  const clearPostAnalyses = () => {
    cache.clear();
    setRevision((value) => value + 1);
  };

  return { getPostAnalysis, setPostAnalysis, clearPostAnalyses };
};

const [PostAnalysisProvider, usePostAnalysisStore] = createContextProvider(
  createPostAnalysisCache,
);

export { PostAnalysisProvider, usePostAnalysisStore };
