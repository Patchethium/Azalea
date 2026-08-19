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

/**
 * Parses an SRT subtitle document into a list of cue texts, preserving cue
 * order. Each cue becomes one entry; inline formatting tags are stripped and
 * multi-line cues are joined with a space.
 */
export const parseSrt = (content: string): string[] => {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const cues: string[] = [];
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split("\n").map((line) => line.trim());
    const timestampIndex = lines.findIndex((line) => line.includes("-->"));
    const textLines =
      timestampIndex === -1 ? lines : lines.slice(timestampIndex + 1);
    const text = textLines
      .filter((line) => line !== "")
      .join(" ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text !== "") cues.push(text);
  }
  return cues;
};
