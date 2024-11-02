// This file was generated by [ts-rs](https://github.com/Aleph-Alpha/ts-rs). Do not edit this file manually.
import type { Mora } from "./Mora";

/**
 * AccentPhrase (アクセント句ごとの情報)。
 */
export type AccentPhrase = { 
/**
 * モーラの配列。
 */
moras: Array<Mora>, 
/**
 * アクセント箇所。
 */
accent: number, 
/**
 * 後ろに無音を付けるかどうか。
 */
pause_mora: Mora | null, 
/**
 * 疑問系かどうか。
 */
is_interrogative: boolean, };