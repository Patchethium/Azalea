import { AudioQuery, SpectrogramPreview } from "@binding";
import { createContextProvider } from "@solid-primitives/context";
import { createSignal } from "solid-js";

type BlockSpectrogramCache = {
  previews: Map<string, SpectrogramPreview>;
  lastPreview: SpectrogramPreview;
};

const [SpectrogramProvider, useSpectrogramStore] = createContextProvider(() => {
  let cache = new Map<string, BlockSpectrogramCache>();
  let requestRevisions = new Map<string, number>();
  const [cacheRevision, setCacheRevision] = createSignal(0);

  const getCacheKey = (audioQuery: AudioQuery, speakerId: number) =>
    JSON.stringify([speakerId, audioQuery]);

  const getCachedSpectrogram = (
    blockId: string,
    audioQuery: AudioQuery,
    speakerId: number,
  ) => {
    cacheRevision();
    return (
      cache.get(blockId)?.previews.get(getCacheKey(audioQuery, speakerId)) ??
      null
    );
  };

  const getLastCachedSpectrogram = (blockId: string) => {
    cacheRevision();
    return cache.get(blockId)?.lastPreview ?? null;
  };

  const cacheSpectrogram = (
    blockId: string,
    audioQuery: AudioQuery,
    speakerId: number,
    spectrogram: SpectrogramPreview,
  ) => {
    const key = getCacheKey(audioQuery, speakerId);
    const blockCache = cache.get(blockId) ?? {
      previews: new Map<string, SpectrogramPreview>(),
      lastPreview: spectrogram,
    };
    blockCache.previews.set(key, spectrogram);
    blockCache.lastPreview = spectrogram;
    cache.set(blockId, blockCache);
    setCacheRevision((revision) => revision + 1);
  };

  const clearSpectrogramCache = () => {
    cache = new Map();
    requestRevisions = new Map();
    setCacheRevision((revision) => revision + 1);
  };

  const beginSpectrogramRequest = (blockId: string) => {
    const revision = (requestRevisions.get(blockId) ?? 0) + 1;
    requestRevisions.set(blockId, revision);
    return revision;
  };
  const isLatestSpectrogramRequest = (blockId: string, revision: number) =>
    revision === requestRevisions.get(blockId);

  return {
    getCacheKey,
    getCachedSpectrogram,
    getLastCachedSpectrogram,
    cacheSpectrogram,
    clearSpectrogramCache,
    beginSpectrogramRequest,
    isLatestSpectrogramRequest,
  };
});

export { SpectrogramProvider, useSpectrogramStore };
