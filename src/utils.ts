import type { AudioQuery, AudioSidecars, Preset, UIConfig } from "$binding";
import _ from "lodash";
import { RECENT_PROJECTS_LIMIT } from "$constants";

// Keep this in sync with voicevox_core's katakana::count_moras. Compound
// katakana such as キャ count as one mora, while ッ and ー each count as one.
const japaneseMoraPattern =
  /(?:イェ|ヴ[ャュョ]|[トド]ゥ|[テデ][ィャュョ]|デェ|[クグ]ヮ|[キシチニヒミリギジビピ][ェャュョ]|[ツフヴ]ァ|[ウスツフヴズ]ィ|[ウツフヴ][ェォ]|[ァ-ヴー])/gu;

export const splitJapaneseMoras = (pronunciation: string) =>
  pronunciation.match(japaneseMoraPattern) ?? [];

export const countJapaneseMoras = (pronunciation: string) =>
  splitJapaneseMoras(pronunciation).length;

export const toHalfWidthAscii = (value: string) =>
  value
    .replace(/[！-～]/gu, (character) =>
      String.fromCodePoint(character.codePointAt(0)! - 0xfee0),
    )
    .replace(/　/gu, " ");

export function createAudioFileName(
  text: string,
  truncationLength: number | undefined,
): string {
  if (truncationLength === 0 || truncationLength === undefined) return text;
  return _.truncate(text, {
    length: truncationLength,
    omission:
      text.length < truncationLength
        ? ""
        : `+${(text.length - truncationLength).toString()}`,
  });
}

/** Sidecar files to write beside exported audio, per the export settings. */
export function createAudioSidecars(
  ui: Pick<UIConfig, "export_text" | "export_lab">,
  text: string,
): AudioSidecars {
  return {
    text: ui.export_text !== false ? text : null,
    lab: ui.export_lab === true,
  };
}

/** Appends the smallest free ` (n)` suffix when `base` is already taken. */
export function createUniqueName(base: string, existingNames: string[]) {
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  let suffix = 1;
  while (taken.has(`${base} (${suffix})`)) suffix += 1;
  return `${base} (${suffix})`;
}

/** Returns a copy of `items` with the item at `from` moved to index `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number) {
  const moved = [...items];
  if (from < 0 || from >= moved.length || to < 0 || to >= moved.length) {
    return moved;
  }
  const [item] = moved.splice(from, 1);
  moved.splice(to, 0, item);
  return moved;
}

/** Moves `path` to the front of a recent-project list, keeping it unique. */
export function addRecentProject(
  recent: readonly string[],
  path: string,
  limit = RECENT_PROJECTS_LIMIT,
) {
  return [path, ...recent.filter((entry) => entry !== path)].slice(0, limit);
}

/** Follows the item at `index` after the item at `from` moves to `to`. */
export function indexAfterMove(index: number, from: number, to: number) {
  if (index === from) return to;
  if (from < index && index <= to) return index - 1;
  if (to <= index && index < from) return index + 1;
  return index;
}

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
  coreRevision = 0,
) => {
  const serialized =
    coreRevision === 0
      ? JSON.stringify([speakerId, query])
      : JSON.stringify([speakerId, query, coreRevision]);
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

/**
 * Splits plain text into text-block contents, one block per non-empty line.
 * Only line breaks separate blocks; punctuation never does. Handles a UTF-8
 * BOM and CRLF line endings, trims each piece, and never yields empty blocks.
 */
export const splitTextIntoBlocks = (text: string): string[] =>
  text
    .replace(/^\uFEFF/, "")
    .split(/\r\n?|\n/)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== "");
