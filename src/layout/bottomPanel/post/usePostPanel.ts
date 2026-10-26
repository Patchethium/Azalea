import { commands, type PostF0Analysis } from "$binding";
import { DEFAULT_BOTTOM_SCALE } from "$constants";
import { useConfigStore } from "@contexts/config";
import { useMetaStore } from "@contexts/meta";
import {
  createPostAnalysisCache,
  type PreparedPostAnalysis,
  usePostAnalysisStore,
} from "@contexts/postAnalysis";
import { findPresetById, findPresetStyle, useTextStore } from "@contexts/text";
import { useUIStore } from "@contexts/ui";
import { getModifiedQuery, postEditBase } from "$utils";
import _ from "lodash";
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import {
  activePostEdit,
  contourFromEdit,
  decodeSpectrogram,
  drawLine,
  editFromContour,
  moraSpans,
  restoreFrames,
  type StrokePoint,
} from "./postEdit";

/** Waits for query edits to settle before analyzing the new waveform. */
export const POST_ANALYSIS_DELAY_MS = 300;
/** Frames on each side of the pointer restored by a right-button drag. */
export const RESTORE_RADIUS_FRAMES = 2;
const MIN_SCALE = 100;
const MAX_SCALE = 1500;

export const preparePostAnalysis = (
  analysis: PostF0Analysis,
): PreparedPostAnalysis => ({
  ...analysis,
  spectrogram: {
    rows: analysis.spectrogram.rows,
    minHz: analysis.spectrogram.min_hz,
    maxHz: analysis.spectrogram.max_hz,
    values: decodeSpectrogram(analysis.spectrogram.data),
  },
});

type Stroke = {
  blockId: string;
  base: string;
  mode: "pencil" | "line" | "restore";
  start: StrokePoint;
  last: StrokePoint;
  /** The contour before the stroke, which line strokes redraw from. */
  origin: number[];
};

export function usePostPanel() {
  const {
    selectedTextBlock,
    selectedTextBlockIndex,
    projectPresetStore,
    queryPending,
    setPostEdit,
  } = useTextStore()!;
  const { metas } = useMetaStore()!;
  const { config, setConfig } = useConfigStore()!;
  const { uiStore } = useUIStore()!;
  const cache = usePostAnalysisStore() ?? createPostAnalysisCache();

  const scale = () => config.ui?.bottom_scale ?? DEFAULT_BOTTOM_SCALE;
  const setScale = (value: number) =>
    setConfig("ui", "bottom_scale", Math.floor(value));

  const currentPreset = createMemo(() => {
    const preset = findPresetById(
      projectPresetStore,
      selectedTextBlock()?.preset_id,
    );
    return preset !== null && findPresetStyle(preset, metas) !== null
      ? preset
      : null;
  });
  const modifiedQuery = createMemo(() => {
    const query = selectedTextBlock()?.query;
    const preset = currentPreset();
    return query == null || preset === null || query.accent_phrases.length === 0
      ? null
      : getModifiedQuery(query, preset);
  });
  const queryExists = () => modifiedQuery() !== null;
  const base = createMemo(() => {
    const query = modifiedQuery();
    const preset = currentPreset();
    return query === null || preset === null
      ? null
      : postEditBase(query, preset.style_id);
  });
  const analysis = () => {
    const key = base();
    return key === null ? null : cache.getPostAnalysis(key);
  };
  const moras = createMemo(() => {
    const query = modifiedQuery();
    return query === null ? [] : moraSpans(query);
  });

  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let request = 0;
  let analysisTimer: ReturnType<typeof setTimeout> | undefined;

  const analyze = async () => {
    const key = base();
    const query = modifiedQuery();
    const preset = currentPreset();
    if (key === null || query === null || preset === null) return;
    if (cache.getPostAnalysis(key) !== null) return;
    const id = ++request;
    setLoading(true);
    setError(null);
    try {
      const result = await commands.analyzePostF0(query, preset.style_id);
      if (id !== request) return;
      if (result.status === "ok") {
        cache.setPostAnalysis(key, preparePostAnalysis(result.data));
      } else {
        console.error("Failed to analyze f0:", result.error);
        setError(result.error);
      }
    } catch (failure) {
      if (id !== request) return;
      console.error("Failed to analyze f0:", failure);
      setError(String(failure));
    } finally {
      if (id === request) setLoading(false);
    }
  };

  createEffect(
    on(
      () => [base(), queryPending[selectedTextBlock()?.id ?? ""]] as const,
      ([key, pending]) => {
        clearTimeout(analysisTimer);
        request += 1;
        setLoading(false);
        setError(null);
        if (key === null || pending || cache.getPostAnalysis(key) !== null) {
          return;
        }
        setLoading(true);
        analysisTimer = setTimeout(
          () => void analyze(),
          POST_ANALYSIS_DELAY_MS,
        );
      },
    ),
  );
  onCleanup(() => {
    clearTimeout(analysisTimer);
    request += 1;
  });

  const committedContour = createMemo(() => {
    const current = analysis();
    const block = selectedTextBlock();
    const query = modifiedQuery();
    const preset = currentPreset();
    if (current === null || block === null || query === null || !preset) {
      return [];
    }
    return contourFromEdit(
      current.f0,
      activePostEdit(block, query, preset.style_id),
    );
  });
  const [draft, setDraft] = createSignal<number[] | null>(null);
  const contour = () => draft() ?? committedContour();
  const edited = () => {
    const block = selectedTextBlock();
    const query = modifiedQuery();
    const preset = currentPreset();
    return (
      block !== null &&
      query !== null &&
      preset !== null &&
      activePostEdit(block, query, preset.style_id) !== null
    );
  };

  let stroke: Stroke | null = null;

  const applyStroke = (current: Stroke, point: StrokePoint) => {
    const analyzed = analysis()?.f0 ?? [];
    const drawUnvoiced = uiStore.postDrawUnvoiced;
    if (current.mode === "line") {
      setDraft(
        drawLine(current.origin, analyzed, current.start, point, drawUnvoiced),
      );
    } else if (current.mode === "pencil") {
      setDraft(
        drawLine(contour(), analyzed, current.last, point, drawUnvoiced),
      );
    } else {
      setDraft(
        restoreFrames(
          contour(),
          analyzed,
          current.last.frame,
          point.frame,
          RESTORE_RADIUS_FRAMES,
        ),
      );
    }
    current.last = point;
  };

  /** Starts a stroke: the primary button draws, the secondary one restores. */
  const beginStroke = (point: StrokePoint, restore: boolean) => {
    const block = selectedTextBlock();
    const key = base();
    if (block === null || key === null || analysis() === null) return false;
    stroke = {
      blockId: block.id,
      base: key,
      mode: restore ? "restore" : uiStore.postTool,
      start: point,
      last: point,
      origin: [...contour()],
    };
    applyStroke(stroke, point);
    return true;
  };

  const moveStroke = (point: StrokePoint) => {
    if (stroke !== null) applyStroke(stroke, point);
  };

  /** Saves the stroke as the block's post edit, unless its content changed meanwhile. */
  const endStroke = () => {
    const finished = stroke;
    const drawn = draft();
    stroke = null;
    setDraft(null);
    const current = analysis();
    if (
      finished === null ||
      drawn === null ||
      current === null ||
      selectedTextBlock()?.id !== finished.blockId ||
      base() !== finished.base
    ) {
      return;
    }
    setPostEdit(
      selectedTextBlockIndex(),
      editFromContour(finished.base, current.f0, drawn),
    );
  };

  const cancelStroke = () => {
    stroke = null;
    setDraft(null);
  };
  onCleanup(cancelStroke);
  createEffect(on(base, cancelStroke, { defer: true }));

  const handleWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setScale(
      _.clamp(scale() + (event.deltaY > 0 ? -50 : 50), MIN_SCALE, MAX_SCALE),
    );
  };

  return {
    queryExists,
    analysis,
    loading,
    error,
    retry: () => void analyze(),
    contour,
    edited,
    moras,
    beginStroke,
    moveStroke,
    endStroke,
    cancelStroke,
    scale,
    setScale,
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
    handleWheel,
  };
}
