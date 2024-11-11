import { invoke } from "@tauri-apps/api/core";
import { AudioQuery } from "./types/AudioQuery";
import { SpeakerMeta } from "./types/SpeakerMeta";
import { StyleId } from "./types/StyleId";

const get_core_path = async (): Promise<string> => {
  try {
    return invoke<string>("get_core_path");
  } catch (e) {
    console.error(`Failed to get the core path. Backend message: ${e}`);
    return "";
  }
};

const initialize_core = async (
  path: string,
  cache_size: number,
): Promise<boolean> => {
  try {
    await invoke("initialize", { corePath: path, cacheSize: cache_size });
    return true;
  } catch (e) {
    console.error(`Failed to initialize the core. Backend message: ${e}`);
    return false;
  }
};

const metas = async (): Promise<SpeakerMeta[] | undefined> => {
  try {
    return await invoke<SpeakerMeta[]>("get_metas");
  } catch (e) {
    console.error(`Failed to fetch metas. Backend message: ${e}`);
  }
};

const query = async (
  text: string,
  style_id: StyleId,
): Promise<AudioQuery | undefined> => {
  try {
    return await invoke<AudioQuery>("audio_query", {
      text: text,
      speakerId: style_id,
    });
  } catch (e) {
    console.error(`Failed to query the core. Backend message: ${e}`);
  }
};

const synthesize = async (
  query: AudioQuery,
  speaker_id: StyleId,
): Promise<Uint8Array | undefined> => {
  try {
    return await invoke<Uint8Array>("synthesize", {
      audioQuery: query,
      speakerId: speaker_id,
    });
  } catch (e) {
    console.error(`Failed to synthesize audio. Backend message: ${e}`);
  }
};

export { get_core_path, initialize_core, metas, query, synthesize };
