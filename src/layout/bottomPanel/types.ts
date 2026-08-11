import { type AudioQuery } from "@binding";

export type DraggingMode = "consonant" | "vowel" | "pause";

export type WaveformSynthesisNotice = {
  blockId: string;
  audioQuery: AudioQuery;
  speakerId: number;
};

export type PlaybackSequence = {
  items: WaveformSynthesisNotice[];
  lastStartedIndex: number | null;
};
