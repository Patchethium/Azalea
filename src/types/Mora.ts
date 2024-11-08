// This file was generated by [ts-rs](https://github.com/Aleph-Alpha/ts-rs). Do not edit this file manually.

/**
 * モーラ（子音＋母音）ごとの情報。
 */
export type Mora = {
  /**
   * 文字。
   */
  text: string;
  /**
   * 子音の音素。
   */
  consonant: string | null;
  /**
   * 子音の音長。
   */
  consonant_length: number | null;
  /**
   * 母音の音素。
   */
  vowel: string;
  /**
   * 母音の音長。
   */
  vowel_length: number;
  /**
   * 音高。
   */
  pitch: number;
};
