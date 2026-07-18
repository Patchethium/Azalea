import { createContextProvider } from "@solid-primitives/context";
import { createSignal } from "solid-js";
import { AudioQuery, SpectrogramPreview } from "../binding";

type SpectrogramCache = Map<string, SpectrogramPreview>;

const [SpectrogramProvider, useSpectrogramStore] = createContextProvider(() => {
  const [cache, setCache] = createSignal<SpectrogramCache>(new Map());
  let requestRevision = 0;

  const getCacheKey = (audioQuery: AudioQuery, speakerId: number) =>
    JSON.stringify([speakerId, audioQuery]);

  const getCachedSpectrogram = (audioQuery: AudioQuery, speakerId: number) =>
    cache().get(getCacheKey(audioQuery, speakerId)) ?? null;

  const cacheSpectrogram = (
    audioQuery: AudioQuery,
    speakerId: number,
    spectrogram: SpectrogramPreview,
  ) => {
    const key = getCacheKey(audioQuery, speakerId);
    setCache((currentCache) => {
      const nextCache = new Map(currentCache);
      nextCache.set(key, spectrogram);
      return nextCache;
    });
  };

  const clearSpectrogramCache = () => {
    requestRevision++;
    setCache(new Map());
  };

  const beginSpectrogramRequest = () => ++requestRevision;
  const isLatestSpectrogramRequest = (revision: number) =>
    revision === requestRevision;

  return {
    getCacheKey,
    getCachedSpectrogram,
    cacheSpectrogram,
    clearSpectrogramCache,
    beginSpectrogramRequest,
    isLatestSpectrogramRequest,
  };
});

export { SpectrogramProvider, useSpectrogramStore };
