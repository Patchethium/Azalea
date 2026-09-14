import type { AudioQuery, Mora } from "./types";

// Editable demonstration data, not synthesized audio or a recorded waveform.
const mora = (
  text: string,
  consonant: string | null,
  vowel: string,
  pitch: number,
): Mora => ({
  text,
  consonant,
  consonant_length: consonant === null ? null : 0.06,
  vowel,
  vowel_length: 0.1,
  pitch,
});

export function sampleQuery(): AudioQuery {
  return {
    accent_phrases: [
      {
        moras: [
          mora("ア", null, "a", 5.2),
          mora("ナ", "n", "a", 5.6),
          mora("タ", "t", "a", 5.5),
          mora("ノ", "n", "o", 5.4),
          mora("コ", "k", "o", 5.5),
          mora("ト", "t", "o", 5.4),
          mora("バ", "b", "a", 5.3),
          mora("ニ", "n", "i", 5.2),
        ],
        accent: 2,
        pause_mora: {
          text: "、",
          consonant: null,
          consonant_length: null,
          vowel: "pau",
          vowel_length: 0.18,
          pitch: 0,
        },
        is_interrogative: false,
      },
      {
        moras: [
          mora("ア", null, "a", 5.2),
          mora("ナ", "n", "a", 5.6),
          mora("タ", "t", "a", 5.5),
          mora("ラ", "r", "a", 5.4),
          mora("シ", "sh", "I", 0),
          mora("イ", null, "i", 5.3),
          mora("コ", "k", "o", 5.5),
          mora("エ", null, "e", 5.3),
          mora("ヲ", null, "o", 5.1),
        ],
        accent: 2,
        pause_mora: null,
        is_interrogative: false,
      },
    ],
    speedScale: 1,
    pitchScale: 0,
    intonationScale: 1,
    volumeScale: 1,
    prePhonemeLength: 0.1,
    postPhonemeLength: 0.1,
    outputSamplingRate: 24000,
    outputStereo: false,
    kana: "アナタノコトバニ、アナタラシイコエヲ。",
  };
}
