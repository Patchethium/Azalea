import _ from "lodash";
import { AccentPhrase, AudioQuery, Preset } from "./binding";

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
