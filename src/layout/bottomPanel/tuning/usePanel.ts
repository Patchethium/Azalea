import { type AudioQuery, commands, type SpectrogramPreview } from "$binding";
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
import { getModifiedQuery } from "$utils";
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
    beginSpectrogramRequest,
    isLatestSpectrogramRequest,
  } = useSpectrogramStore()!;

  const scale = () => config.ui_config?.bottom_scale ?? DEFAULT_BOTTOM_SCALE;
  const setScale = (value: number) => {
    setConfig("ui_config", "bottom_scale", Math.floor(value));
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

  const refreshSpectrogram = async (
    blockId: string,
    audioQuery: AudioQuery,
    speakerId: number,
  ) => {
    const request = beginSpectrogramRequest(blockId);
    const requestKey = getCacheKey(audioQuery, speakerId);
    if (currentText()?.id === blockId) {
      setSpectrogramStale(spectrogram() !== null);
    }
    try {
      const result = await commands.getSpectrogramPreview(
        audioQuery,
        speakerId,
      );
      if (!isLatestSpectrogramRequest(blockId, request)) return;
      if (result.status === "ok") {
        cacheSpectrogram(blockId, audioQuery, speakerId, result.data);
        const currentQuery = currentModifiedQuery();
        const preset = currentPreset();
        if (
          mounted &&
          currentText()?.id === blockId &&
          currentQuery !== null &&
          preset !== null &&
          getCacheKey(currentQuery, preset.style_id) === requestKey
        ) {
          setSpectrogram(result.data);
          setSpectrogramStale(false);
        }
      } else {
        console.error("Failed to create spectrogram preview:", result.error);
      }
    } catch (error) {
      console.error("Failed to create spectrogram preview:", error);
    }
  };

  let scheduledSpectrogramRefresh:
    | Scheduled<[string, AudioQuery, number]>
    | undefined;
  const clearScheduledSpectrogramRefresh = () => {
    scheduledSpectrogramRefresh?.clear();
    scheduledSpectrogramRefresh = undefined;
  };
  const scheduleSpectrogramRefresh = (
    blockId: string,
    audioQuery: AudioQuery,
    speakerId: number,
  ) => {
    clearScheduledSpectrogramRefresh();
    const configuredDelay =
      config.ui_config.synthesis_delay_ms ?? DEFAULT_SYNTHESIS_DELAY_MS;
    const delay = Math.min(
      Math.max(Math.trunc(configuredDelay), 0),
      MAX_SYNTHESIS_DELAY_MS,
    );
    scheduledSpectrogramRefresh = debounce(
      (scheduledBlockId, scheduledQuery, scheduledSpeakerId) => {
        void refreshSpectrogram(
          scheduledBlockId,
          scheduledQuery,
          scheduledSpeakerId,
        );
      },
      delay,
    );
    scheduledSpectrogramRefresh(blockId, audioQuery, speakerId);
  };

  createEffect(() => {
    const block = currentText();
    const query = currentModifiedQuery();
    const preset = currentPreset();
    const bufferRender = config.ui_config.buffer_render;
    const previewEnabled = spectrogramPreviewEnabled();
    clearScheduledSpectrogramRefresh();
    if (!previewEnabled) {
      setSpectrogram(null);
      setSpectrogramStale(false);
      clearSpectrogramCache();
      return;
    }
    if (block === null) {
      setSpectrogram(null);
      setSpectrogramStale(false);
      return;
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
    if (bufferRender && query !== null && preset !== null) {
      scheduleSpectrogramRefresh(block.id, query, preset.style_id);
    }
  });

  createEffect(
    on(waveformSynthesisNotice, (notice) => {
      if (
        notice === null ||
        config.ui_config.buffer_render ||
        !spectrogramPreviewEnabled()
      ) {
        return;
      }
      void refreshSpectrogram(
        notice.blockId,
        notice.audioQuery,
        notice.speakerId,
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

  onMount(() => {
    scrollAreaRef?.scroll({ left: uiStore.bottom_scroll_pos });
  });
  onCleanup(() => {
    mounted = false;
    clearScheduledSpectrogramRefresh();
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
    minScale,
    maxScale,
    scale,
    setScale,
  };
}
