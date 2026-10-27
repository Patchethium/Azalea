import type {
  AudioQuery,
  PostEdit,
  PostF0Segment,
  PostTimeAnchor,
  TextBlockProps,
} from "$binding";
import { postEditBase } from "$utils";

/** Frames whose edited f0 is within this many Hz of the analysis count as unedited. */
const EDIT_TOLERANCE_HZ = 1e-3;
/** How far a span between time anchors may be squeezed or stretched (as in Rust). */
export const MIN_TIME_RATE = 0.25;
export const MAX_TIME_RATE = 4;
/** Anchors closer than this on the synthesized timeline are not added. */
const MIN_ANCHOR_GAP_SECONDS = 0.005;

/** The block's post edit when it was made on exactly this content. */
export const activePostEdit = (
  block: Pick<TextBlockProps, "post">,
  query: AudioQuery,
  styleId: number,
): PostEdit | null => {
  const edit = block.post;
  if (edit == null || (edit.f0.length === 0 && edit.time.length === 0)) {
    return null;
  }
  return edit.base === postEditBase(query, styleId) ? edit : null;
};

/** The analyzed contour with the edit's frames applied. */
export const contourFromEdit = (
  analyzed: readonly number[],
  edit: PostEdit | null | undefined,
): number[] => {
  const contour = [...analyzed];
  for (const segment of edit?.f0 ?? []) {
    segment.f0.forEach((value, offset) => {
      const frame = segment.start + offset;
      if (frame < contour.length) contour[frame] = value;
    });
  }
  return contour;
};

/** Runs of frames where `contour` differs from the analysis. */
export const f0Segments = (
  analyzed: readonly number[],
  contour: readonly number[],
): PostF0Segment[] => {
  const segments: PostF0Segment[] = [];
  let current: PostF0Segment | null = null;
  for (let frame = 0; frame < contour.length; frame++) {
    const edited =
      Math.abs(contour[frame] - analyzed[frame]) > EDIT_TOLERANCE_HZ;
    if (!edited) {
      current = null;
      continue;
    }
    if (current === null) {
      current = { start: frame, f0: [] };
      segments.push(current);
    }
    current.f0.push(contour[frame]);
  }
  return segments;
};

/** A post edit from its parts, or null when it has neither f0 edits nor time anchors. */
export const buildPostEdit = (
  base: string,
  f0: PostF0Segment[],
  time: PostTimeAnchor[],
): PostEdit | null =>
  f0.length === 0 && time.length === 0 ? null : { base, f0, time };

/**
 * A piecewise-linear map from the synthesized waveform's seconds (source) to
 * the output's (target), starting at (0, 0) and keeping the last anchor's
 * offset after it. Mirrors `TimeMap` in `src-tauri/src/audio/stretch.rs`.
 */
export type TimeMap = {
  toTarget: (source: number) => number;
  toSource: (target: number) => number;
  /** Every breakpoint, (0, 0) included, as [source, target] pairs. */
  points: readonly [number, number][];
};

const mapThrough = (points: readonly [number, number][], x: number) => {
  let previous: [number, number] = [0, 0];
  for (const point of points) {
    if (x <= point[0]) {
      const span = point[0] - previous[0];
      return span <= 0
        ? point[1]
        : previous[1] + ((x - previous[0]) * (point[1] - previous[1])) / span;
    }
    previous = point;
  }
  return x + previous[1] - previous[0];
};

export const timeMap = (anchors: readonly PostTimeAnchor[]): TimeMap => {
  const points: [number, number][] = [
    [0, 0],
    ...anchors.map(({ source, target }): [number, number] => [source, target]),
  ];
  const inverse = points.map(([source, target]): [number, number] => [
    target,
    source,
  ]);
  return {
    points,
    toTarget: (source) => mapThrough(points, source),
    toSource: (target) => mapThrough(inverse, target),
  };
};

/**
 * Adds an anchor at `source` seconds on the current map, which leaves the
 * timing unchanged until the anchor is moved. Returns the anchors and the new
 * anchor's index, or null when another anchor is too close.
 */
export const addAnchor = (
  anchors: readonly PostTimeAnchor[],
  source: number,
): { anchors: PostTimeAnchor[]; index: number } | null => {
  if (!(source >= MIN_ANCHOR_GAP_SECONDS)) return null;
  if (
    anchors.some(
      (anchor) => Math.abs(anchor.source - source) < MIN_ANCHOR_GAP_SECONDS,
    )
  ) {
    return null;
  }
  const index = anchors.filter((anchor) => anchor.source < source).length;
  const next = [...anchors];
  next.splice(index, 0, { source, target: timeMap(anchors).toTarget(source) });
  return { anchors: next, index };
};

/**
 * Moves anchor `index` to `target` output seconds, clamped so the span before
 * it stays within the rate limits. Later anchors move with it, so every other
 * span keeps its duration.
 */
export const moveAnchor = (
  anchors: readonly PostTimeAnchor[],
  index: number,
  target: number,
): PostTimeAnchor[] => {
  const anchor = anchors[index];
  if (anchor === undefined) return [...anchors];
  const previous = anchors[index - 1] ?? { source: 0, target: 0 };
  const before = anchor.source - previous.source;
  const low = previous.target + before * MIN_TIME_RATE;
  const high = previous.target + before * MAX_TIME_RATE;
  const shift = Math.min(Math.max(target, low), high) - anchor.target;
  return anchors.map((current, position) =>
    position < index ? current : { ...current, target: current.target + shift },
  );
};

export const removeAnchor = (
  anchors: readonly PostTimeAnchor[],
  index: number,
): PostTimeAnchor[] => anchors.filter((_, current) => current !== index);

export type StrokePoint = { frame: number; logHz: number };

/**
 * Draws a straight line in log-frequency between two points. Frames that are
 * unvoiced in both the analysis and the current contour are skipped unless
 * `drawUnvoiced` is set.
 */
export const drawLine = (
  contour: readonly number[],
  analyzed: readonly number[],
  from: StrokePoint,
  to: StrokePoint,
  drawUnvoiced: boolean,
): number[] => {
  const next = [...contour];
  const [start, end] = from.frame <= to.frame ? [from, to] : [to, from];
  const first = Math.max(0, start.frame);
  const last = Math.min(next.length - 1, end.frame);
  for (let frame = first; frame <= last; frame++) {
    if (!drawUnvoiced && !(analyzed[frame] > 0) && !(contour[frame] > 0)) {
      continue;
    }
    const t =
      end.frame === start.frame
        ? 1
        : (frame - start.frame) / (end.frame - start.frame);
    next[frame] = Math.exp(start.logHz + (end.logHz - start.logHz) * t);
  }
  return next;
};

/** Restores the analyzed f0 on frames between two points, widened by `radius`. */
export const restoreFrames = (
  contour: readonly number[],
  analyzed: readonly number[],
  fromFrame: number,
  toFrame: number,
  radius: number,
): number[] => {
  const next = [...contour];
  const first = Math.max(0, Math.min(fromFrame, toFrame) - radius);
  const last = Math.min(next.length - 1, Math.max(fromFrame, toFrame) + radius);
  for (let frame = first; frame <= last; frame++) next[frame] = analyzed[frame];
  return next;
};

export const decodeSpectrogram = (data: string): Uint8Array => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export type LabelSpan = { text: string; start: number; end: number };

/** Mora positions in seconds on the synthesized waveform, pauses included. */
export const moraSpans = (query: AudioQuery): LabelSpan[] => {
  const speed = query.speedScale > 0 ? query.speedScale : 1;
  let time = query.prePhonemeLength / speed;
  return query.accent_phrases.flatMap((phrase) =>
    [
      ...phrase.moras,
      ...(phrase.pause_mora == null ? [] : [phrase.pause_mora]),
    ].map((mora) => {
      const start = time;
      time += ((mora.consonant_length ?? 0) + mora.vowel_length) / speed;
      return { text: mora.text, start, end: time };
    }),
  );
};

/**
 * Phoneme positions in seconds on the synthesized waveform: each mora's
 * consonant and vowel separately, pauses included.
 */
export const phonemeSpans = (query: AudioQuery): LabelSpan[] => {
  const speed = query.speedScale > 0 ? query.speedScale : 1;
  let time = query.prePhonemeLength / speed;
  const span = (text: string, length: number) => {
    const start = time;
    time += length / speed;
    return { text, start, end: time };
  };
  return query.accent_phrases.flatMap((phrase) =>
    [
      ...phrase.moras,
      ...(phrase.pause_mora == null ? [] : [phrase.pause_mora]),
    ].flatMap((mora) => [
      ...(mora.consonant != null && mora.consonant_length != null
        ? [span(mora.consonant, mora.consonant_length)]
        : []),
      span(mora.vowel, mora.vowel_length),
    ]),
  );
};

const NOTE_NAMES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
];

/** The nearest note to `hz` and the offset from it in cents, such as `A4 +12`. */
export const noteName = (hz: number) => {
  const midi = 69 + 12 * Math.log2(hz / 440);
  const note = Math.round(midi);
  const cents = Math.round((midi - note) * 100);
  const name = `${NOTE_NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
  return `${name} ${cents >= 0 ? "+" : "−"}${Math.abs(cents)}`;
};
