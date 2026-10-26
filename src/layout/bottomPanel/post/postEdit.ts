import type {
  AudioQuery,
  PostF0Edit,
  PostF0Segment,
  TextBlockProps,
} from "$binding";
import { postEditBase } from "$utils";

/** Frames whose edited f0 is within this many Hz of the analysis count as unedited. */
const EDIT_TOLERANCE_HZ = 1e-3;

/** The block's post edit when it was made on exactly this content. */
export const activePostEdit = (
  block: Pick<TextBlockProps, "post_f0">,
  query: AudioQuery,
  styleId: number,
): PostF0Edit | null => {
  const edit = block.post_f0;
  if (edit == null || edit.segments.length === 0) return null;
  return edit.base === postEditBase(query, styleId) ? edit : null;
};

/** The analyzed contour with the edit's frames applied. */
export const contourFromEdit = (
  analyzed: readonly number[],
  edit: PostF0Edit | null | undefined,
): number[] => {
  const contour = [...analyzed];
  for (const segment of edit?.segments ?? []) {
    segment.f0.forEach((value, offset) => {
      const frame = segment.start + offset;
      if (frame < contour.length) contour[frame] = value;
    });
  }
  return contour;
};

/** Runs of frames where `contour` differs from the analysis, or null when none do. */
export const editFromContour = (
  base: string,
  analyzed: readonly number[],
  contour: readonly number[],
): PostF0Edit | null => {
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
  return segments.length === 0 ? null : { base, segments };
};

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

export type MoraSpan = { text: string; start: number; end: number };

/** Mora positions in seconds on the synthesized waveform, pauses included. */
export const moraSpans = (query: AudioQuery): MoraSpan[] => {
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
