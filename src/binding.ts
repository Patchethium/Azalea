
// This file was generated by [tauri-specta](https://github.com/oscartbeaumont/tauri-specta). Do not edit this file manually.

/** user-defined commands **/


export const commands = {
/**
 * So, the `libvoicevox.so` is not in the same directory as the executable,
 * so we search for it in the executable's directory and return the dir that
 * actually contains the `libvoicevox.so` file.
 */
async sanitizeVvExePath(path: string) : Promise<string | null> {
    return await TAURI_INVOKE("sanitize_vv_exe_path", { path });
},
async pickCore(pickExec: boolean) : Promise<Result<string, string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("pick_core", { pickExec }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
async downloadCore(url: string) : Promise<Result<null, string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("download_core", { url }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
async initConfig() : Promise<Result<AzaleaConfig, string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("init_config") };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
async getConfig() : Promise<Result<AzaleaConfig, string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("get_config") };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
async setConfig(config: AzaleaConfig) : Promise<Result<null, string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("set_config", { config }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
/**
 * Load the voicevox core and create lru cache
 */
async initCore(corePath: string, cacheSize: number) : Promise<Result<null, string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("init_core", { corePath, cacheSize }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
/**
 * Gets metas from voicevox core
 */
async getMetas() : Promise<Result<SpeakerMeta[], string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("get_metas") };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
async getRange() : Promise<Result<{ [key in StyleId]: [number, number] }, string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("get_range") };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
/**
 * Encodes text into audio query
 */
async audioQuery(text: string, speakerId: number) : Promise<Result<AudioQuery, string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("audio_query", { text, speakerId }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
async playAudio(audioQuery: AudioQuery, speakerId: number) : Promise<Result<null, string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("play_audio", { audioQuery, speakerId }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
/**
 * Save the audio waveform to a file
 */
async saveAudio(path: string, audioQuery: AudioQuery, speakerId: number) : Promise<Result<string, string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("save_audio", { path, audioQuery, speakerId }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
async spectrogram(signal: number[]) : Promise<number[][]> {
    return await TAURI_INVOKE("spectrogram", { signal });
},
async getOs() : Promise<OS> {
    return await TAURI_INVOKE("get_os");
},
async quit() : Promise<void> {
    await TAURI_INVOKE("quit");
},
async saveProject(project: Project, path: string, allowCreate: boolean) : Promise<Result<null, string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("save_project", { project, path, allowCreate }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
async loadProject(path: string) : Promise<Result<Project, string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("load_project", { path }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
}
}

/** user-defined events **/



/** user-defined constants **/



/** user-defined types **/

/**
 * AccentPhrase (アクセント句ごとの情報)。
 */
export type AccentPhrase = { 
/**
 * モーラの配列。
 */
moras: Mora[]; 
/**
 * アクセント箇所。
 */
accent: number; 
/**
 * 後ろに無音を付けるかどうか。
 */
pause_mora: Mora | null; 
/**
 * 疑問系かどうか。
 */
is_interrogative?: boolean }
/**
 * AudioQuery (音声合成用のクエリ)。
 */
export type AudioQuery = { 
/**
 * アクセント句の配列。
 */
accent_phrases: AccentPhrase[]; 
/**
 * 全体の話速。
 */
speed_scale: number; 
/**
 * 全体の音高。
 */
pitch_scale: number; 
/**
 * 全体の抑揚。
 */
intonation_scale: number; 
/**
 * 全体の音量。
 */
volume_scale: number; 
/**
 * 音声の前の無音時間。
 */
pre_phoneme_length: number; 
/**
 * 音声の後の無音時間。
 */
post_phoneme_length: number; 
/**
 * 音声データの出力サンプリングレート。
 */
output_sampling_rate: number; 
/**
 * 音声データをステレオ出力するか否か。
 */
output_stereo: boolean; 
/**
 * \[読み取り専用\] AquesTalk風記法。
 * 
 * [`Synthesizer::audio_query`]が返すもののみ`Some`となる。入力としてのAudioQueryでは無視され
 * る。
 * 
 * [`Synthesizer::audio_query`]: crate::blocking::Synthesizer::audio_query
 */
kana: string | null }
export type AzaleaConfig = { core_config: CoreConfig; ui_config: UIConfig; system_presets?: Preset[] }
export type CoreConfig = { 
/**
 * The Path to the core directory, it should be the directory containing the dynamic library.
 * For example, if the lib is in `/home/user/VOICEVOX/vv-engine/libvoicevox_core.so`,
 * the path should be `/home/user/VOICEVOX/vv-engine`.
 */
core_path: string | null; ojt_path: string | null; cache_size?: number }
export type Locale = "Ja" | "En"
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
pitch: number }
export type OS = "MacOS" | "Windows" | "Linux"
export type Preset = { name: string; style_id: StyleId; 
/**
 * in percentage, 50-200
 */
speed: number; 
/**
 * linear shift in log hz, -1-1.
 */
pitch: number; intonation: number; volume: number; 
/**
 * in seconds, 0.0-3.0, 0 is default for no slience
 */
start_slience: number; 
/**
 * in seconds, 0.0-3.0, 0 is default for no slience
 */
end_slience: number }
export type Project = { blocks: TextBlockProps[]; presets: Preset[] }
/**
 * **話者**(_speaker_)のメタ情報。
 */
export type SpeakerMeta = { 
/**
 * 話者名。
 */
name: string; 
/**
 * 話者に属するスタイル。
 */
styles: StyleMeta[]; 
/**
 * 話者のバージョン。
 */
version: StyleVersion; 
/**
 * 話者のUUID。
 */
speaker_uuid: string; 
/**
 * 話者の順番。
 * 
 * `SpeakerMeta`の列は、この値に対して昇順に並んでいるべきである。
 */
order: number | null }
/**
 * スタイルID。
 * 
 * VOICEVOXにおける、ある[**話者**(_speaker_)]のある[**スタイル**(_style_)]を指す。
 * 
 * [**話者**(_speaker_)]: SpeakerMeta
 * [**スタイル**(_style_)]: StyleMeta
 */
export type StyleId = number
/**
 * **スタイル**(_style_)のメタ情報。
 */
export type StyleMeta = { 
/**
 * スタイルID。
 */
id: StyleId; 
/**
 * スタイル名。
 */
name: string; 
/**
 * スタイルに対応するモデルの種類。
 */
type?: StyleType; 
/**
 * スタイルの順番。
 * 
 * [`SpeakerMeta::styles`]は、この値に対して昇順に並んでいるべきである。
 */
order: number | null }
/**
 * **スタイル**(_style_)に対応するモデルの種類。
 */
export type StyleType = 
/**
 * 音声合成クエリの作成と音声合成が可能。
 */
"talk" | 
/**
 * 歌唱音声合成用のクエリの作成が可能。
 */
"singing_teacher" | 
/**
 * 歌唱音声合成が可能。
 */
"frame_decode" | 
/**
 * 歌唱音声合成用のクエリの作成と歌唱音声合成が可能。
 */
"sing"
/**
 * スタイルのバージョン。
 */
export type StyleVersion = string
export type TextBlockProps = { text: string; query: AudioQuery | null; preset_id: number | null }
export type UIConfig = { locale?: Locale; bottom_scale?: number; auto_save?: boolean; bottom_ratio?: number; side_ratio?: number }

/** tauri-specta globals **/

import {
	invoke as TAURI_INVOKE,
	Channel as TAURI_CHANNEL,
} from "@tauri-apps/api/core";
import * as TAURI_API_EVENT from "@tauri-apps/api/event";
import { type WebviewWindow as __WebviewWindow__ } from "@tauri-apps/api/webviewWindow";

type __EventObj__<T> = {
	listen: (
		cb: TAURI_API_EVENT.EventCallback<T>,
	) => ReturnType<typeof TAURI_API_EVENT.listen<T>>;
	once: (
		cb: TAURI_API_EVENT.EventCallback<T>,
	) => ReturnType<typeof TAURI_API_EVENT.once<T>>;
	emit: null extends T
		? (payload?: T) => ReturnType<typeof TAURI_API_EVENT.emit>
		: (payload: T) => ReturnType<typeof TAURI_API_EVENT.emit>;
};

export type Result<T, E> =
	| { status: "ok"; data: T }
	| { status: "error"; error: E };

function __makeEvents__<T extends Record<string, any>>(
	mappings: Record<keyof T, string>,
) {
	return new Proxy(
		{} as unknown as {
			[K in keyof T]: __EventObj__<T[K]> & {
				(handle: __WebviewWindow__): __EventObj__<T[K]>;
			};
		},
		{
			get: (_, event) => {
				const name = mappings[event as keyof T];

				return new Proxy((() => {}) as any, {
					apply: (_, __, [window]: [__WebviewWindow__]) => ({
						listen: (arg: any) => window.listen(name, arg),
						once: (arg: any) => window.once(name, arg),
						emit: (arg: any) => window.emit(name, arg),
					}),
					get: (_, command: keyof __EventObj__<any>) => {
						switch (command) {
							case "listen":
								return (arg: any) => TAURI_API_EVENT.listen(name, arg);
							case "once":
								return (arg: any) => TAURI_API_EVENT.once(name, arg);
							case "emit":
								return (arg: any) => TAURI_API_EVENT.emit(name, arg);
						}
					},
				});
			},
		},
	);
}
