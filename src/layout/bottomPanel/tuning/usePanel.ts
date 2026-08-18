import {
  type AudioQuery,
  commands,
  events,
  type SpectrogramJobRequest,
  type SpectrogramPreview,
} from "$binding";
import {
  DEFAULT_BOTTOM_SCALE,
  DEFAULT_SYNTHESIS_DELAY_MS,
  MAX_SYNTHESIS_DELAY_MS,
} from "$constants";
import { useConfigStore } from "@contexts/config";
import { useMetaStore } from "@contexts/meta";
import { useSpectrogramStore } from "@contexts/spectrogram";
import { findPresetById, findPresetStyle, useTextStore } from "@contexts/text";
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
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";

let spectrogramGenerationSequence = 0;

type ActiveSpectrogramRequest = {
  request: SpectrogramJobRequest;
  signature: string;
  submitted: boolean;
  buffered: boolean;
};

export function useTuningPanel(
  waveformSynthesisNotice: Accessor<WaveformSynthesisNotice | null>,
) {
  const {
    setTextStore,
    markQueryModified,
    projectPresetStore,
    selectedTextBlock,
    selectedTextBlockIndex,
  } = useTextStore()!;
  const { metas } = useMetaStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const { config, setConfig, spectrogramPreviewEnabled, range } =
    useConfigStore()!;
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

  const cancelSpectrogramRequest = (
    activeRequest: ActiveSpectrogramRequest | null,
  ) => {
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

  const submitSpectrogramRequest = async (
    request: SpectrogramJobRequest,
    activeRequest: ActiveSpectrogramRequest,
  ) => {
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
        activeSpectrogramRequest = null;
        console.error("Failed to queue spectrogram preview:", result.error);
      }
    } catch (error) {
      if (activeSpectrogramRequest === activeRequest) {
        activeSpectrogramRequest = null;
      }
      console.error("Failed to queue spectrogram preview:", error);
    }
  };

  let scheduledSpectrogramRefresh:
    | Scheduled<[SpectrogramJobRequest, ActiveSpectrogramRequest]>
    | undefined;
  const clearScheduledSpectrogramRefresh = () => {
    scheduledSpectrogramRefresh?.clear();
    scheduledSpectrogramRefresh = undefined;
  };
  const startSpectrogramRequest = (
    blockId: string,
    audioQuery: AudioQuery,
    speakerId: number,
    buffered: boolean,
  ) => {
    clearScheduledSpectrogramRefresh();
    cancelSpectrogramRequest(activeSpectrogramRequest);
    const { hash, signature } = renderRequestFingerprint(audioQuery, speakerId);
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
    };
    activeSpectrogramRequest = activeRequest;
    lastSpectrogramSignature = activeRequest.signature;
    if (currentText()?.id === blockId) {
      setSpectrogramStale(spectrogram() !== null);
    }

    if (!buffered) {
      void submitSpectrogramRequest(request, activeRequest);
      return;
    }
    const configuredDelay =
      config.ui.synthesis_delay_ms ?? DEFAULT_SYNTHESIS_DELAY_MS;
    const delay = Math.min(
      Math.max(Math.trunc(configuredDelay), 0),
      MAX_SYNTHESIS_DELAY_MS,
    );
    scheduledSpectrogramRefresh = debounce(submitSpectrogramRequest, delay);
    scheduledSpectrogramRefresh(request, activeRequest);
  };

  onMount(() => {
    void events.spectrogramJobEvent
      .listen(({ payload }) => {
        const activeRequest = activeSpectrogramRequest;
        if (
          activeRequest === null ||
          payload.blockId !== activeRequest.request.blockId ||
          payload.generationId !== activeRequest.request.generationId ||
          payload.hash !== activeRequest.request.hash
        ) {
          return;
        }
        if (payload.state === "Failed") {
          activeSpectrogramRequest = null;
          console.error("Failed to create spectrogram preview:", payload.error);
          return;
        }
        if (payload.state !== "Completed") return;
        activeSpectrogramRequest = null;
        if (payload.preview === null) {
          console.error(
            "Failed to create spectrogram preview:",
            "completed job returned no preview",
          );
          return;
        }
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
    const { signature } = renderRequestFingerprint(query, preset.style_id);
    const blockSignature = `${block.id}:${signature}`;
    if (blockSignature !== lastSpectrogramSignature) {
      clearScheduledSpectrogramRefresh();
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

  const computedRange = createMemo(() => {
    const id = currentPreset()?.style_id;
    const pitchRange = range();
    if (id === undefined || pitchRange === null) return [0, 0];
    let [min, max] = pitchRange[id] ?? [0, 0];
    const relax = (max - min) * 0.3;
    min = _.clamp(min - relax, 0, 6.5);
    max = _.clamp(max + relax, 0, 6.5);
    return [min, max];
  });
  const minPitch = createMemo(() => computedRange()[0]);
  const maxPitch = createMemo(() => computedRange()[1]);
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
    markQueryModified(index);
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
    markQueryModified(index);
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
    markQueryModified(index);
  };
  const setPitch = (i: number, j: number, value: number) => {
    const index = selectedIdx();
    if (index === null) return;
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
    markQueryModified(index);
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
    minPitch,
    maxPitch,
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
