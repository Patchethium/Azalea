import type { AudioQuery, Preset } from "$binding";
import _ from "lodash";

export function getModifiedQuery(
  query: AudioQuery,
  preset: Preset,
): AudioQuery {
  const newQuery = _.cloneDeep(query);
  newQuery.pitchScale = preset.pitch;
  newQuery.speedScale = preset.speed / 100.0;
  newQuery.intonationScale = preset.intonation;
  newQuery.volumeScale = preset.volume;
  newQuery.prePhonemeLength = preset.start_slience / 1000.0;
  newQuery.postPhonemeLength = preset.end_slience / 1000.0;
  return newQuery;
}

export const renderRequestFingerprint = (
  query: AudioQuery,
  speakerId: number,
) => {
  const serialized = JSON.stringify([speakerId, query]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return {
    hash: `${(hash >>> 0).toString(16).padStart(8, "0")}-${serialized.length}`,
    signature: serialized,
  };
};

/**
 * Adds a side effect to a function.
 * @param f trigger function to wrap
 * @param sideEffect side effect to run after f is called
 * @returns wrapped function
 */
export const useSideEffect = <Args extends unknown[], Return>(
  f: (...args: Args) => Return,
  sideEffect: () => void,
) => {
  return (...args: Args): Return => {
    const result = f(...args);
    sideEffect();
    return result;
  };
};
