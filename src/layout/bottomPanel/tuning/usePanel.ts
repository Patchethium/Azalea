import {
  type AccentPhrase,
  type AudioQuery,
  commands,
  events,
  type SpectrogramJobRequest,
  type SpectrogramPreview,
} from "$binding";
import {
  DEFAULT_BOTTOM_SCALE,
  DEFAULT_PITCH_DRIFT_RANGE,
  DEFAULT_PITCH_NOISE_SIGMA,
  DEFAULT_PITCH_SCALE,
  DEFAULT_PITCH_TUNING_MODE,
  DEFAULT_SYNTHESIS_DELAY_MS,
  MAX_PITCH_DRIFT_RANGE,
  MAX_SYNTHESIS_DELAY_MS,
  MAX_RENDER_ATTEMPTS,
  MIN_PITCH_DRIFT_RANGE,
  RENDER_RETRY_DELAY_MS,
} from "$constants";
import { useConfigStore } from "@contexts/config";
import { useMetaStore } from "@contexts/meta";
import {
  createPitchBaselineCache,
  usePitchBaselineStore,
} from "@contexts/pitchBaseline";
import { useSpectrogramStore } from "@contexts/spectrogram";
import {
  findPresetById,
  findPresetStyle,
  isQueryModified,
  useTextStore,
} from "@contexts/text";
import { useUIStore } from "@contexts/ui";
import type {
  DraggingMode,
  WaveformSynthesisNotice,
} from "@layout/bottomPanel/types";
import { getModifiedQuery, renderRequestFingerprint } from "$utils";
import { debounce, type Scheduled } from "@solid-primitives/scheduled";
import _ from "lodash";
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";

import { unwrap } from "solid-js/store";

import { createDriftScale, createPitchScale } from "./pitchScale";

let spectrogramGenerationSequence = 0;

// Pitch prediction depends on phonemes and accents but not on pitch or
// duration values, so tuning edits keep the same baseline.
const pitchStructureSignature = (phrases: readonly AccentPhrase[]) =>
  JSON.stringify(
    phrases.map((phrase) => [
      phrase.accent,
      phrase.is_interrogative,
      phrase.pause_mora !== null,
      phrase.moras.map((mora) => [
        mora.text,
        mora.consonant ?? null,
        mora.vowel,
      ]),
    ]),
  );

type ActiveSpectrogramRequest = {
  request: SpectrogramJobRequest;
  signature: string;
  submitted: boolean;
  buffered: boolean;
  attempt: number;
  settled: boolean;
};

export function useTuningPanel(
  waveformSynthesisNotice: Accessor<WaveformSynthesisNotice | null>,
) {
  const {
    textStore,
    setTextStore,
    markQueryDurationModified,
    markQueryPitchModified,
    projectPresetStore,
    selectedTextBlock,
    selectedTextBlockIndex,
    queryPending,
  } = useTextStore()!;
  const { metas } = useMetaStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const {
    config,
    setConfig,
    spectrogramPreviewEnabled,
    pitchCompletionActive,
    range,
    coreRevision,
  } = useConfigStore()!;
  const {
    getCacheKey,
    getCachedSpectrogram,
    getLastCachedSpectrogram,
    cacheSpectrogram,
    clearSpectrogramCache,
  } = useSpectrogramStore()!;

  const scale = () => config.ui?.bottom_scale ?? DEFAULT_BOTTOM_SCALE;
  const setScale = (value: number) => {
    setConfig("ui", "bottom_scale", Math.floor(value));
  };
  const minScale = 100;
  const maxScale = 1500;
  let scrollAreaRef: HTMLDivElement | undefined;
  const currentText = selectedTextBlock;
  const selectedIdx = () =>
    currentText() === null ? null : selectedTextBlockIndex();
  const queryExists = () => {
    const query = currentText()?.query;
    return (
      query !== null && query !== undefined && query.accent_phrases.length > 0
    );
  };

  const currentPreset = createMemo(() => {
    const preset = findPresetById(projectPresetStore, currentText()?.preset_id);
    return preset !== null && findPresetStyle(preset, metas) !== null
      ? preset
      : null;
  });
  const currentModifiedQuery = createMemo(() => {
    const query = currentText()?.query;
    const preset = currentPreset();
    return query == null || preset === null
      ? null
      : getModifiedQuery(query, preset);
  });
  const timelineDuration = createMemo(() =>
    (currentText()?.query?.accent_phrases ?? []).reduce(
      (total, phrase) =>
        total +
        phrase.moras.reduce(
          (phraseTotal, mora) =>
            phraseTotal + (mora.consonant_length ?? 0) + mora.vowel_length,
          0,
        ) +
        (phrase.pause_mora?.vowel_length ?? 0),
      0,
    ),
  );

  const getCurrentSpectrogram = () => {
    const block = currentText();
    const query = currentModifiedQuery();
    const preset = currentPreset();
    if (block === null || query === null || preset === null) return null;
    return getCachedSpectrogram(block.id, query, preset.style_id);
  };
  const [spectrogram, setSpectrogram] = createSignal<SpectrogramPreview | null>(
    null,
  );
  const [spectrogramStale, setSpectrogramStale] = createSignal(false);
  let mounted = true;
  let activeSpectrogramRequest: ActiveSpectrogramRequest | null = null;
  let lastSpectrogramSignature: string | null = null;
  let unlistenSpectrogram: (() => void) | undefined;
  let listenerReady: Promise<void> = Promise.resolve();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelSpectrogramRequest = (
    activeRequest: ActiveSpectrogramRequest | null,
  ) => {
    clearTimeout(retryTimer);
    if (!activeRequest?.submitted) return;
    void commands
      .cancelSpectrogramPreview(
        activeRequest.request.blockId,
        activeRequest.request.generationId,
      )
      .then((result) => {
        if (result.status === "error") {
          console.error("Failed to cancel spectrogram preview:", result.error);
        }
      });
  };

  const retrySpectrogram = (activeRequest: ActiveSpectrogramRequest) => {
    if (
      !mounted ||
      activeSpectrogramRequest !== activeRequest ||
      activeRequest.settled
    )
      return;
    activeRequest.settled = true;
    if (activeRequest.attempt >= MAX_RENDER_ATTEMPTS) return;
    retryTimer = setTimeout(() => {
      const next: ActiveSpectrogramRequest = {
        ...activeRequest,
        request: {
          ...activeRequest.request,
          generationId: ++spectrogramGenerationSequence,
        },
        attempt: activeRequest.attempt + 1,
        submitted: false,
        settled: false,
      };
      activeSpectrogramRequest = next;
      void submitSpectrogramRequest(next.request, next);
    }, RENDER_RETRY_DELAY_MS);
  };

  const submitSpectrogramRequest = async (
    request: SpectrogramJobRequest,
    activeRequest: ActiveSpectrogramRequest,
  ) => {
    if (!mounted || activeSpectrogramRequest !== activeRequest) return;
    // Submitting before the event listener is attached can lose the worker's
    // Completed event, leaving the previous canvas grayed out forever.
    await listenerReady;
    if (!mounted || activeSpectrogramRequest !== activeRequest) return;
    activeRequest.submitted = true;
    try {
      const result = await commands.requestSpectrogramPreview(request);
      if (!mounted || activeSpectrogramRequest !== activeRequest) {
        if (result.status === "ok") {
          void commands.cancelSpectrogramPreview(
            request.blockId,
            request.generationId,
          );
        }
        return;
      }
      if (result.status === "error") {
        retrySpectrogram(activeRequest);
        console.error("Failed to queue spectrogram preview:", result.error);
      }
    } catch (error) {
      retrySpectrogram(activeRequest);
      console.error("Failed to queue spectrogram preview:", error);
    }
  };

  let scheduledSpectrogramRefresh:
    | Scheduled<[SpectrogramJobRequest, ActiveSpectrogramRequest]>
    | undefined;
  let scheduledSpectrogramRefreshDelay: number | null = null;
  const clearScheduledSpectrogramRefresh = () => {
    scheduledSpectrogramRefresh?.clear();
    scheduledSpectrogramRefresh = undefined;
    scheduledSpectrogramRefreshDelay = null;
  };
  const scheduleSpectrogramRefresh = (
    request: SpectrogramJobRequest,
    activeRequest: ActiveSpectrogramRequest,
    delay: number,
  ) => {
    // Reuse the scheduler across edits unless the configured delay changed.
    if (
      scheduledSpectrogramRefresh === undefined ||
      scheduledSpectrogramRefreshDelay !== delay
    ) {
      clearScheduledSpectrogramRefresh();
      scheduledSpectrogramRefresh = debounce(submitSpectrogramRequest, delay);
      scheduledSpectrogramRefreshDelay = delay;
    } else {
      scheduledSpectrogramRefresh.clear();
    }
    scheduledSpectrogramRefresh(request, activeRequest);
  };
  const startSpectrogramRequest = (
    blockId: string,
    audioQuery: AudioQuery,
    speakerId: number,
    buffered: boolean,
  ) => {
    cancelSpectrogramRequest(activeSpectrogramRequest);
    const { hash, signature } = renderRequestFingerprint(
      audioQuery,
      speakerId,
      coreRevision(),
    );
    spectrogramGenerationSequence += 1;
    const request: SpectrogramJobRequest = {
      blockId,
      generationId: spectrogramGenerationSequence,
      audioQuery,
      speakerId,
      hash,
    };
    const activeRequest: ActiveSpectrogramRequest = {
      request,
      signature: `${blockId}:${signature}`,
      submitted: false,
      buffered,
      attempt: 1,
      settled: false,
    };
    activeSpectrogramRequest = activeRequest;
    lastSpectrogramSignature = activeRequest.signature;
    if (currentText()?.id === blockId) {
      setSpectrogramStale(spectrogram() !== null);
    }

    if (!buffered) {
      clearScheduledSpectrogramRefresh();
      void submitSpectrogramRequest(request, activeRequest);
      return;
    }
    const configuredDelay =
      config.ui.synthesis_delay_ms ?? DEFAULT_SYNTHESIS_DELAY_MS;
    const delay = Math.min(
      Math.max(Math.trunc(configuredDelay), 0),
      MAX_SYNTHESIS_DELAY_MS,
    );
    scheduleSpectrogramRefresh(request, activeRequest, delay);
  };

  onMount(() => {
    listenerReady = events.spectrogramJobEvent
      .listen(({ payload }) => {
        const activeRequest = activeSpectrogramRequest;
        if (
          activeRequest === null ||
          activeRequest.settled ||
          payload.blockId !== activeRequest.request.blockId ||
          payload.generationId !== activeRequest.request.generationId ||
          payload.hash !== activeRequest.request.hash
        ) {
          return;
        }
        if (payload.state === "Failed") {
          retrySpectrogram(activeRequest);
          console.error("Failed to create spectrogram preview:", payload.error);
          return;
        }
        if (payload.state !== "Completed") return;
        if (payload.preview === null) {
          retrySpectrogram(activeRequest);
          console.error(
            "Failed to create spectrogram preview:",
            "completed job returned no preview",
          );
          return;
        }
        activeRequest.settled = true;
        activeSpectrogramRequest = null;
        const { blockId, audioQuery, speakerId } = activeRequest.request;
        cacheSpectrogram(blockId, audioQuery, speakerId, payload.preview);
        const currentQuery = currentModifiedQuery();
        const preset = currentPreset();
        if (
          mounted &&
          currentText()?.id === blockId &&
          currentQuery !== null &&
          preset !== null &&
          getCacheKey(currentQuery, preset.style_id) ===
            getCacheKey(audioQuery, speakerId)
        ) {
          setSpectrogram(payload.preview);
          setSpectrogramStale(false);
        }
      })
      .then((unlisten) => {
        if (!mounted) unlisten();
        else unlistenSpectrogram = unlisten;
      })
      .catch((error) => {
        console.error("Failed to listen for spectrogram events:", error);
      });
  });

  createEffect(() => {
    const block = currentText();
    const query = currentModifiedQuery();
    const preset = currentPreset();
    const bufferRender = config.ui.buffer_render;
    const previewEnabled = spectrogramPreviewEnabled();
    if (!previewEnabled) {
      clearScheduledSpectrogramRefresh();
      cancelSpectrogramRequest(activeSpectrogramRequest);
      activeSpectrogramRequest = null;
      lastSpectrogramSignature = null;
      setSpectrogram(null);
      setSpectrogramStale(false);
      clearSpectrogramCache();
      return;
    }
    if (block === null || query === null || preset === null) {
      clearScheduledSpectrogramRefresh();
      cancelSpectrogramRequest(activeSpectrogramRequest);
      activeSpectrogramRequest = null;
      lastSpectrogramSignature = null;
      setSpectrogram(null);
      setSpectrogramStale(false);
      return;
    }
    if (queryPending[block.id]) {
      clearScheduledSpectrogramRefresh();
      cancelSpectrogramRequest(activeSpectrogramRequest);
      activeSpectrogramRequest = null;
      lastSpectrogramSignature = null;
      setSpectrogram(getLastCachedSpectrogram(block.id));
      setSpectrogramStale(spectrogram() !== null);
      return;
    }
    const { signature } = renderRequestFingerprint(
      query,
      preset.style_id,
      coreRevision(),
    );
    const blockSignature = `${block.id}:${signature}`;
    if (blockSignature !== lastSpectrogramSignature) {
      scheduledSpectrogramRefresh?.clear();
      cancelSpectrogramRequest(activeSpectrogramRequest);
      activeSpectrogramRequest = null;
      lastSpectrogramSignature = blockSignature;
    }
    const cachedSpectrogram = getCurrentSpectrogram();
    if (cachedSpectrogram !== null) {
      setSpectrogram(cachedSpectrogram);
      setSpectrogramStale(false);
      return;
    }
    const lastSpectrogram = getLastCachedSpectrogram(block.id);
    setSpectrogram(lastSpectrogram);
    setSpectrogramStale(lastSpectrogram !== null);
    if (!bufferRender) {
      if (activeSpectrogramRequest?.buffered) {
        clearScheduledSpectrogramRefresh();
        cancelSpectrogramRequest(activeSpectrogramRequest);
        activeSpectrogramRequest = null;
      }
      return;
    }
    if (activeSpectrogramRequest === null) {
      startSpectrogramRequest(block.id, query, preset.style_id, true);
    }
  });

  createEffect(
    on(waveformSynthesisNotice, (notice) => {
      if (
        notice === null ||
        queryPending[notice.blockId] ||
        config.ui.buffer_render ||
        !spectrogramPreviewEnabled()
      ) {
        return;
      }
      startSpectrogramRequest(
        notice.blockId,
        notice.audioQuery,
        notice.speakerId,
        false,
      );
    }),
  );

  const pitchScale = createMemo(() => {
    const id = currentPreset()?.style_id;
    return createPitchScale(
      id === undefined ? undefined : range()?.[id],
      config.ui.pitch_scale ?? DEFAULT_PITCH_SCALE,
    );
  });
  const tuningMode = () =>
    config.ui.pitch_tuning_mode ?? DEFAULT_PITCH_TUNING_MODE;
  const driftScale = createMemo(() =>
    createDriftScale(
      _.clamp(
        config.ui.pitch_drift_range ?? DEFAULT_PITCH_DRIFT_RANGE,
        MIN_PITCH_DRIFT_RANGE,
        MAX_PITCH_DRIFT_RANGE,
      ),
    ),
  );

  // The baseline is the seeded prediction for the current phonemes and
  // accents. It is deterministic, so results are cached by key across panel
  // mounts and never persisted; pitch completion does not rebase it. Relative
  // sliders center on it and absolute mode draws it as a ghost.
  const { getPitchBaseline, setPitchBaseline } =
    usePitchBaselineStore() ?? createPitchBaselineCache();
  const pendingPitchBaselines = new Set<string>();
  const pitchBaselineKey = createMemo(() => {
    const block = currentText();
    const preset = currentPreset();
    const phrases = block?.query?.accent_phrases;
    if (!block || preset === null || !phrases?.length) return null;
    return JSON.stringify([
      block.id,
      preset.style_id,
      block.pitch_noise_seed,
      config.ui.pitch_noise_enabled ?? false,
      config.ui.pitch_noise_sigma ?? DEFAULT_PITCH_NOISE_SIGMA,
      coreRevision(),
      pitchStructureSignature(phrases),
    ]);
  });
  const currentQueryPending = () => {
    const block = currentText();
    return block === null ? undefined : queryPending[block.id];
  };
  createEffect(
    on([pitchBaselineKey, currentQueryPending], async ([key, pending]) => {
      if (
        key === null ||
        pending !== undefined ||
        untrack(() => getPitchBaseline(key)) !== null ||
        pendingPitchBaselines.has(key)
      )
        return;
      const block = currentText();
      const preset = currentPreset();
      if (!block?.query || preset === null) return;
      if (block.pitch_is_modified !== true) {
        // Record the seeded prediction only after a regenerated query for
        // this key has settled. Until then the query still holds pitches
        // from the previous seed.
        setPitchBaseline(
          key,
          block.query.accent_phrases.map((phrase) =>
            phrase.moras.map((mora) => mora.pitch),
          ),
          false,
        );
        return;
      }
      const phrases = structuredClone(unwrap(block.query.accent_phrases));
      pendingPitchBaselines.add(key);
      try {
        const result = await commands.replaceMoraPitch(
          phrases,
          preset.style_id,
          block.pitch_noise_seed,
        );
        if (result.status === "error") {
          if (mounted)
            console.error("Failed to predict pitch baseline:", result.error);
          return;
        }
        // The result is valid for its own key even if the block has changed
        // since, so it is cached rather than discarded.
        setPitchBaseline(
          key,
          result.data.map((phrase) => phrase.moras.map((mora) => mora.pitch)),
        );
      } catch (error) {
        if (mounted) console.error("Failed to predict pitch baseline:", error);
      } finally {
        pendingPitchBaselines.delete(key);
      }
    }),
  );
  const pitchBaseline = createMemo(() => {
    const key = pitchBaselineKey();
    if (key === null) return null;
    const cached = getPitchBaseline(key);
    if (cached !== null) return cached;
    const block = currentText();
    const query = block?.query;
    if (!query || block.pitch_is_modified === true) return null;
    // The effect above caches this once the generated query settles. Return
    // the live snapshot meanwhile so sliders keep their mapping without
    // storing pitches that may still belong to the previous seed.
    return query.accent_phrases.map((phrase) =>
      phrase.moras.map((mora) => mora.pitch),
    );
  });
  const baselineFor = (phraseIndex: number, moraIndex: number) =>
    pitchBaseline()?.[phraseIndex]?.[moraIndex] ?? null;

  const [draggingData, setDraggingData] = createSignal<{
    apIndex: number;
    moraIndex: number;
    originData: number;
    mode: DraggingMode;
  } | null>(null);
  const [dragStartX, setStartX] = createSignal<number | null>(null);

  const setConsonantLength = (i: number, j: number, value: number) => {
    const index = selectedIdx();
    if (index === null) return;
    setTextStore(
      index,
      "query",
      "accent_phrases",
      i,
      "moras",
      j,
      "consonant_length",
      value,
    );
    markQueryDurationModified(index);
  };
  const setVowelLength = (i: number, j: number, value: number) => {
    const index = selectedIdx();
    if (index === null) return;
    setTextStore(
      index,
      "query",
      "accent_phrases",
      i,
      "moras",
      j,
      "vowel_length",
      value,
    );
    markQueryDurationModified(index);
  };
  const setPauseLength = (i: number, value: number) => {
    const index = selectedIdx();
    if (index === null) return;
    setTextStore(
      index,
      "query",
      "accent_phrases",
      i,
      "pause_mora",
      "vowel_length",
      value,
    );
    markQueryDurationModified(index);
  };
  let pitchCompletionRevision = 0;
  const completePitch = debounce(
    async (index: number, i: number, j: number) => {
      const block = textStore[index];
      const preset = currentPreset();
      if (!block?.query?.accent_phrases[i]?.moras[j] || preset === null) return;
      const styleId = preset.style_id;
      const phrases = structuredClone(unwrap(block.query.accent_phrases));
      const prefix = phrases
        .slice(0, i)
        .flatMap((phrase) => [
          ...phrase.moras.map((mora) => mora.pitch),
          ...(phrase.pause_mora === null ? [] : [phrase.pause_mora.pitch]),
        ]);
      prefix.push(
        ...phrases[i].moras.slice(0, j + 1).map((mora) => mora.pitch),
      );
      const seed = block.pitch_noise_seed;
      const blockId = block.id;
      const revision = pitchCompletionRevision;
      try {
        const result = await commands.completeMoraPitch(
          phrases,
          styleId,
          prefix,
          seed,
        );
        const current = textStore[index];
        if (
          !mounted ||
          revision !== pitchCompletionRevision ||
          current?.id !== blockId ||
          !isQueryModified(current) ||
          currentPreset()?.style_id !== styleId ||
          JSON.stringify(current.query?.accent_phrases) !==
            JSON.stringify(phrases)
        )
          return;
        if (result.status === "error") {
          console.error("Failed to complete pitch:", result.error);
          return;
        }
        setTextStore(index, "query", "accent_phrases", result.data);
      } catch (error) {
        if (mounted && revision === pitchCompletionRevision)
          console.error("Failed to complete pitch:", error);
      }
    },
    100,
  );
  createEffect(
    on(
      () => [
        currentText()?.id,
        currentPreset()?.style_id,
        currentText()?.pitch_noise_seed,
        config.ui.pitch_completion_enabled,
        config.ui.pitch_completion_locked,
        config.ui.pitch_noise_enabled,
        config.ui.pitch_noise_sigma,
      ],
      () => {
        ++pitchCompletionRevision;
        completePitch.clear();
      },
      { defer: true },
    ),
  );
  const setPitch = (i: number, j: number, value: number) => {
    const index = selectedIdx();
    if (index === null) return;
    ++pitchCompletionRevision;
    completePitch.clear();
    batch(() => {
      setTextStore(
        index,
        "query",
        "accent_phrases",
        i,
        "moras",
        j,
        "pitch",
        value,
      );
      markQueryPitchModified(index);
    });
    if (pitchCompletionActive()) completePitch(index, i, j);
  };

  const handleDragFinish = () => {
    setDraggingData(null);
    setStartX(null);
  };
  const handleDragging = (event: MouseEvent) => {
    const dragging = draggingData();
    const startX = dragStartX();
    if (dragging === null || startX === null) return;
    const delta = event.clientX - startX;
    if (dragging.mode === "consonant") {
      setConsonantLength(
        dragging.apIndex,
        dragging.moraIndex,
        Math.max(0.01, dragging.originData + delta / scale()),
      );
    } else if (dragging.mode === "vowel") {
      setVowelLength(
        dragging.apIndex,
        dragging.moraIndex,
        Math.max(0.01, dragging.originData + delta / scale()),
      );
    } else {
      setPauseLength(
        dragging.apIndex,
        Math.max(0, dragging.originData + delta / scale()),
      );
    }
  };
  const handleWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setScale(_.clamp(scale() + (event.deltaY > 0 ? -50 : 50), 100, maxScale));
  };

  createEffect(() => {
    const scrollLeft = uiStore.bottom_scroll_pos;
    if (scrollAreaRef && scrollAreaRef.scrollLeft !== scrollLeft) {
      scrollAreaRef.scrollLeft = scrollLeft;
    }
  });
  onCleanup(() => {
    mounted = false;
    completePitch.clear();
    clearScheduledSpectrogramRefresh();
    cancelSpectrogramRequest(activeSpectrogramRequest);
    activeSpectrogramRequest = null;
    unlistenSpectrogram?.();
    if (scrollAreaRef) {
      setUIStore("bottom_scroll_pos", scrollAreaRef.scrollLeft);
    }
  });

  return {
    setScrollAreaRef: (element: HTMLDivElement) => {
      scrollAreaRef = element;
    },
    currentText,
    queryExists,
    currentModifiedQuery,
    timelineDuration,
    spectrogram,
    spectrogramStale,
    pitchScale,
    tuningMode,
    driftScale,
    baselineFor,
    draggingData,
    setDraggingData,
    setStartX,
    setPitch,
    setPauseLength,
    handleDragFinish,
    handleDragging,
    handleWheel,
    handleScroll: (event: Event & { currentTarget: HTMLDivElement }) => {
      const scrollLeft = event.currentTarget.scrollLeft;
      if (uiStore.bottom_scroll_pos !== scrollLeft) {
        setUIStore("bottom_scroll_pos", scrollLeft);
      }
    },
    minScale,
    maxScale,
    scale,
    setScale,
  };
}
