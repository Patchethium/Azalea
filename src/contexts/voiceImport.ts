import {
  commands,
  events,
  type LoadedVoice,
  type VoiceSegment,
} from "$binding";
import { pitchStructureSignature } from "$utils";
import { useConfigStore } from "@contexts/config";
import { useMetaStore } from "@contexts/meta";
import type { PreparedPostAnalysis } from "@contexts/postAnalysis";
import { findPresetById, findPresetStyle, useTextStore } from "@contexts/text";
import { preparePostAnalysis } from "@layout/bottomPanel/post/usePostPanel";
import {
  DEFAULT_PITCH_MAPPING,
  fitScale,
  mapPitches,
  moraPitches,
  type PitchMapping,
  pitchBounds,
  pitchSpread,
  targetSpread,
  withPitches,
} from "@layout/bottomPanel/tuning/voiceImport";
import { createContextProvider } from "@solid-primitives/context";
import { batch, createEffect, onCleanup, onMount, untrack } from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";

/** Shortest phoneme a dragged boundary leaves, as the backend writes. */
export const MIN_SEGMENT_SECONDS = 0.01;

/**
 * A voice attached to a text block for the session. Its timing and pitch are
 * written into the block's query whenever the alignment or mapping changes.
 */
export type VoiceSession = {
  voiceId: string;
  /** The trimmed recording's f0 and spectrogram. */
  analysis: PreparedPostAnalysis;
  /** Aligned phonemes with the edge pauses; null until aligned. */
  segments: VoiceSegment[] | null;
  /** `pitchStructureSignature` of the phrases `segments` were aligned to. */
  signature: string | null;
  /** The block's pitches when the voice was attached, the fallback target. */
  basePitches: number[];
  mapping: PitchMapping;
  /** Where the voice plays from, in seconds of the trimmed recording. */
  playbackStart: number;
  /** The style the last applied pitches were mapped for. */
  styleId: number | null;
  /** The scale that fit the speaker's contour to the voice when last applied. */
  fittedScale: number | null;
  aligning: boolean;
  error: string | null;
};

export type VoiceRecordingState = {
  blockId: string;
  /** Opening the microphone, recording, or loading the stopped recording. */
  phase: "starting" | "recording" | "loading";
  peak: number;
  seconds: number;
};

const createVoiceImportStore = () => {
  const {
    textStore,
    setTextStore,
    projectPresetStore,
    queryPending,
    markQueryDurationModified,
    markQueryPitchModified,
  } = useTextStore()!;
  const { metas } = useMetaStore()!;
  const { range, voiceImportEnabled } = useConfigStore()!;
  const [sessions, setSessions] = createStore<Record<string, VoiceSession>>({});
  const [recording, setRecording] = createStore<{
    state: VoiceRecordingState | null;
  }>({ state: null });
  // Read through a function: an await can change it, which narrowing ignores.
  const currentRecording = (): VoiceRecordingState | null => recording.state;
  /** Latest request per block; older responses are ignored. */
  const requests = new Map<string, number>();
  let requestSequence = 0;
  const nextRequest = (blockId: string) => {
    const token = ++requestSequence;
    requests.set(blockId, token);
    return token;
  };
  const isCurrent = (blockId: string, token: number) =>
    requests.get(blockId) === token;

  const blockIndex = (blockId: string) =>
    textStore.findIndex((block) => block.id === blockId);
  const blockStyleId = (blockId: string) => {
    const block = textStore[blockIndex(blockId)];
    const preset = findPresetById(projectPresetStore, block?.preset_id);
    return preset !== null && findPresetStyle(preset, metas) !== null
      ? preset.style_id
      : null;
  };

  const setError = (blockId: string, error: unknown) =>
    setSessions(blockId, { aligning: false, error: String(error) });

  /** Writes the voice's timing and mapped pitch into the block's query. */
  const apply = async (blockId: string) => {
    const session = sessions[blockId];
    const index = blockIndex(blockId);
    const phrases = textStore[index]?.query?.accent_phrases;
    if (session?.segments == null || phrases == null) return;
    const token = nextRequest(blockId);
    const snapshot = structuredClone(unwrap(phrases));
    const signature = pitchStructureSignature(snapshot);
    if (signature !== session.signature) return;
    const segments = structuredClone(unwrap(session.segments));
    const voiceId = session.voiceId;
    const result = await commands.voiceAccentPhrases(
      voiceId,
      snapshot,
      segments,
    );
    if (!isCurrent(blockId, token) || sessions[blockId]?.voiceId !== voiceId)
      return;
    if (result.status === "error") return setError(blockId, result.error);
    const current = blockIndex(blockId);
    const currentPhrases = textStore[current]?.query?.accent_phrases;
    if (
      currentPhrases == null ||
      pitchStructureSignature(currentPhrases) !== signature
    )
      return;
    const styleId = blockStyleId(blockId);
    const styleRange = styleId === null ? undefined : range()?.[styleId];
    const target = targetSpread(styleRange, sessions[blockId].basePitches);
    const pitches = moraPitches(result.data);
    const user = pitchSpread(pitches);
    const fitted =
      user === null || target === null ? null : fitScale(user, target);
    const mapped =
      target === null
        ? pitches
        : mapPitches(
            pitches,
            target,
            sessions[blockId].mapping,
            pitchBounds(styleRange),
          );
    batch(() => {
      setTextStore(
        current,
        "query",
        "accent_phrases",
        withPitches(result.data, mapped),
      );
      markQueryDurationModified(current);
      markQueryPitchModified(current);
      setSessions(blockId, { styleId, fittedScale: fitted, error: null });
    });
  };

  /** Aligns the voice to the block's current phonemes, then applies it. */
  const align = async (blockId: string) => {
    const session = sessions[blockId];
    const phrases = textStore[blockIndex(blockId)]?.query?.accent_phrases;
    if (session === undefined || phrases == null || phrases.length === 0)
      return;
    const token = nextRequest(blockId);
    const snapshot = structuredClone(unwrap(phrases));
    const voiceId = session.voiceId;
    setSessions(blockId, { aligning: true, error: null });
    const result = await commands.alignVoice(voiceId, snapshot);
    if (!isCurrent(blockId, token) || sessions[blockId]?.voiceId !== voiceId)
      return;
    if (result.status === "error") return setError(blockId, result.error);
    setSessions(blockId, {
      segments: result.data,
      signature: pitchStructureSignature(snapshot),
      aligning: false,
    });
    await apply(blockId);
  };

  /** Forgets the block's voice; the timing and pitch it wrote stay. */
  const removeVoice = (blockId: string) => {
    const session = sessions[blockId];
    if (session === undefined) return;
    requests.delete(blockId);
    setSessions(produce((all) => delete all[blockId]));
    void commands.removeVoice(session.voiceId);
  };

  /** Attaches a loaded voice to the block, replacing its voice, and aligns it. */
  const attachVoice = async (blockId: string, loaded: LoadedVoice) => {
    const index = blockIndex(blockId);
    if (index === -1) {
      void commands.removeVoice(loaded.voice_id);
      return;
    }
    removeVoice(blockId);
    setSessions(blockId, {
      voiceId: loaded.voice_id,
      analysis: preparePostAnalysis(loaded.analysis),
      segments: null,
      signature: null,
      basePitches: moraPitches(textStore[index].query?.accent_phrases ?? []),
      // A copy: the store merges later mappings into this object.
      mapping: { ...DEFAULT_PITCH_MAPPING },
      playbackStart: 0,
      styleId: null,
      fittedScale: null,
      aligning: false,
      error: null,
    });
    await align(blockId);
  };

  /** Loads an audio file as the block's voice; returns an error message. */
  const loadFile = async (blockId: string, path: string) => {
    const token = nextRequest(blockId);
    const result = await commands.loadVoiceFile(path);
    if (result.status === "error") return result.error;
    if (!isCurrent(blockId, token)) {
      void commands.removeVoice(result.data.voice_id);
      return null;
    }
    await attachVoice(blockId, result.data);
    return null;
  };

  const startRecording = async (blockId: string) => {
    if (recording.state !== null) return null;
    setRecording("state", { blockId, phase: "starting", peak: 0, seconds: 0 });
    const result = await commands.startVoiceRecording();
    if (result.status === "error") {
      setRecording("state", null);
      return result.error;
    }
    // Cancelled while the microphone was opening.
    if (currentRecording()?.blockId !== blockId) {
      void commands.cancelVoiceRecording();
      return null;
    }
    setRecording("state", "phase", "recording");
    return null;
  };

  /** Stops recording and attaches the recording; returns an error message. */
  const stopRecording = async () => {
    const state = recording.state;
    if (state === null || state.phase !== "recording") return null;
    setRecording("state", "phase", "loading");
    const result = await commands.stopVoiceRecording();
    setRecording("state", null);
    if (result.status === "error") return result.error;
    await attachVoice(state.blockId, result.data);
    return null;
  };

  const cancelRecording = () => {
    if (recording.state === null) return;
    setRecording("state", null);
    void commands.cancelVoiceRecording();
  };

  const setMapping = (blockId: string, mapping: PitchMapping) => {
    if (sessions[blockId] === undefined) return;
    setSessions(blockId, "mapping", reconcile({ ...mapping }));
    void apply(blockId);
  };

  /** Replaces the segments while a boundary is dragged, without applying. */
  const setSegments = (blockId: string, segments: VoiceSegment[]) => {
    if (sessions[blockId]?.segments == null) return;
    setSessions(blockId, "segments", reconcile(segments));
  };

  const setPlaybackStart = (blockId: string, seconds: number) => {
    const session = sessions[blockId];
    if (session === undefined) return;
    setSessions(
      blockId,
      "playbackStart",
      Math.min(Math.max(seconds, 0), session.analysis.duration),
    );
  };

  onMount(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void events.voiceRecordingLevelEvent
      .listen(({ payload }) => {
        if (recording.state?.phase !== "recording") return;
        batch(() => {
          setRecording("state", "peak", payload.peak);
          setRecording("state", "seconds", payload.seconds);
        });
        if (payload.full) void stopRecording();
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      });
    onCleanup(() => {
      disposed = true;
      unlisten?.();
    });
  });

  // Voices of deleted blocks are forgotten, and every voice once the
  // feature is switched off.
  createEffect(() => {
    const ids = new Set(textStore.map((block) => block.id));
    const enabled = voiceImportEnabled();
    untrack(() => {
      for (const blockId of Object.keys(sessions)) {
        if (!enabled || !ids.has(blockId)) removeVoice(blockId);
      }
      if (!enabled) cancelRecording();
    });
  });

  // Accent and phoneme edits realign the voice; style changes remap it.
  createEffect(() => {
    for (const [blockId, session] of Object.entries(sessions)) {
      const block = textStore[blockIndex(blockId)];
      const phrases = block?.query?.accent_phrases;
      if (
        block === undefined ||
        phrases == null ||
        phrases.length === 0 ||
        queryPending[block.id] !== undefined ||
        session.aligning ||
        session.signature === null
      )
        continue;
      if (pitchStructureSignature(phrases) !== session.signature) {
        untrack(() => void align(blockId));
      } else if (
        session.styleId !== null &&
        blockStyleId(blockId) !== session.styleId
      ) {
        untrack(() => void apply(blockId));
      }
    }
  });

  return {
    voiceSessions: sessions,
    voiceRecording: () => recording.state,
    attachVoice,
    loadVoiceFile: loadFile,
    removeVoice,
    startVoiceRecording: startRecording,
    stopVoiceRecording: stopRecording,
    cancelVoiceRecording: cancelRecording,
    setVoiceMapping: setMapping,
    setVoiceSegments: setSegments,
    commitVoiceSegments: (blockId: string) => void apply(blockId),
    setVoicePlaybackStart: setPlaybackStart,
    realignVoice: (blockId: string) => void align(blockId),
  };
};

const [VoiceImportProvider, useVoiceImportStore] = createContextProvider(
  createVoiceImportStore,
);

export { VoiceImportProvider, useVoiceImportStore };
