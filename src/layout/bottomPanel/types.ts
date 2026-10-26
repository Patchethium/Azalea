import { type AudioQuery, type PostF0Edit } from "$binding";

export type DraggingMode = "consonant" | "vowel" | "pause";

export type WaveformSynthesisNotice = {
  blockId: string;
  audioQuery: AudioQuery;
  speakerId: number;
  /** Post-processing edits applied to this item's playback. */
  post?: PostF0Edit | null;
};

export type PlaybackSequence = {
  items: WaveformSynthesisNotice[];
  lastStartedIndex: number | null;
};

export type PlaybackPhraseAnchor = {
  duration: number;
  startSeconds: number;
  moraCount: number;
};
