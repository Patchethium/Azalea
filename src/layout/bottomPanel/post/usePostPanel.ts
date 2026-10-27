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
  addAnchor,
  buildPostEdit,
  contourFromEdit,
  decodeSpectrogram,
  drawLine,
  f0Segments,
  moraSpans,
  moveAnchor,
  phonemeSpans,
  removeAnchor,
  restoreFrames,
  type StrokePoint,
  timeMap,
} from "./postEdit";
import type { PostTimeAnchor } from "$binding";

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

type TimeDrag = {
  blockId: string;
  base: string;
  index: number;
  /** The anchors when the drag started, a newly added anchor included. */
  origin: PostTimeAnchor[];
};

export function usePostPanel() {
  const {
    selectedTextBlock,
    selectedTextBlockIndex,
    projectPresetStore,
    queryPending,
    commitPostEdit,
  } = useTextStore()!;
  const { metas } = useMetaStore()!;
  const { config, setConfig } = useConfigStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
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
  const phonemes = createMemo(() => {
    const query = modifiedQuery();
    return query === null ? [] : phonemeSpans(query);
  });
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

  const activeEdit = createMemo(() => {
    const block = selectedTextBlock();
    const query = modifiedQuery();
    const preset = currentPreset();
    return block === null || query === null || preset === null
      ? null
      : activePostEdit(block, query, preset.style_id);
  });
  const committedContour = createMemo(() => {
    const current = analysis();
    return current === null ? [] : contourFromEdit(current.f0, activeEdit());
  });
  const [draft, setDraft] = createSignal<number[] | null>(null);
  const contour = () => draft() ?? committedContour();
  const [draftAnchors, setDraftAnchors] = createSignal<PostTimeAnchor[] | null>(
    null,
  );
  const anchors = () => draftAnchors() ?? activeEdit()?.time ?? [];
  /** Where each point of the synthesized waveform plays in the output. */
  const map = createMemo(() => timeMap(anchors()));
  const edited = () => activeEdit() !== null;

  /** Where playback starts, in output seconds; 0 when unset. */
  const playbackStart = () => {
    const start = uiStore.postPlaybackStart;
    return start !== null &&
      start.blockId === selectedTextBlock()?.id &&
      start.base === base()
      ? map().toTarget(start.seconds)
      : 0;
  };
  /**
   * Starts playback at `output` seconds. The point is kept on the synthesized
   * waveform so it follows its sound when the timing changes.
   */
  const setPlaybackStart = (output: number) => {
    const block = selectedTextBlock();
    const key = base();
    if (block === null || key === null) return;
    const seconds = map().toSource(Math.max(0, output));
    setUIStore(
      "postPlaybackStart",
      seconds > 0 ? { blockId: block.id, base: key, seconds } : null,
    );
  };

  /**
   * Saves the block's post edit as an undoable step, unless its content
   * changed since the edit began.
   */
  const commit = (
    started: { blockId: string; base: string },
    nextContour: readonly number[],
    nextAnchors: PostTimeAnchor[],
  ) => {
    const current = analysis();
    if (
      current === null ||
      selectedTextBlock()?.id !== started.blockId ||
      base() !== started.base
    ) {
      return;
    }
    commitPostEdit(
      selectedTextBlockIndex(),
      started.base,
      buildPostEdit(
        started.base,
        f0Segments(current.f0, nextContour),
        nextAnchors,
      ),
    );
  };

  let stroke: Stroke | null = null;
  let timeDrag: TimeDrag | null = null;

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

  const startedOn = () => {
    const block = selectedTextBlock();
    const key = base();
    return block === null || key === null || analysis() === null
      ? null
      : { blockId: block.id, base: key };
  };

  /** Starts a pitch stroke: the primary button draws, the secondary one restores. */
  const beginStroke = (point: StrokePoint, restore: boolean) => {
    const started = startedOn();
    if (started === null) return false;
    stroke = {
      ...started,
      mode:
        restore || uiStore.postTool === "time" ? "restore" : uiStore.postTool,
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

  /**
   * Starts a time edit at `source` seconds of the synthesized waveform. On an
   * anchor (`hit`), the primary button drags it and the secondary one removes
   * it; elsewhere the primary button adds an anchor there and drags it.
   */
  const beginTimeEdit = (
    source: number,
    hit: number | null,
    remove: boolean,
  ) => {
    const started = startedOn();
    if (started === null) return false;
    if (remove) {
      if (hit === null) return false;
      commit(started, contour(), removeAnchor(anchors(), hit));
      return false;
    }
    if (hit !== null) {
      timeDrag = { ...started, index: hit, origin: [...anchors()] };
    } else {
      const added = addAnchor(anchors(), source);
      if (added === null) return false;
      timeDrag = { ...started, index: added.index, origin: added.anchors };
    }
    setDraftAnchors(timeDrag.origin);
    return true;
  };

  /** Moves the dragged anchor so its point plays at `target` output seconds. */
  const moveTimeEdit = (target: number) => {
    if (timeDrag === null) return;
    setDraftAnchors(moveAnchor(timeDrag.origin, timeDrag.index, target));
  };

  /** Saves the stroke or time edit in progress as the block's post edit. */
  const endStroke = () => {
    const finishedStroke = stroke;
    const drawn = draft();
    const finishedDrag = timeDrag;
    const dragged = draftAnchors();
    stroke = null;
    timeDrag = null;
    setDraft(null);
    setDraftAnchors(null);
    if (finishedStroke !== null && drawn !== null) {
      commit(finishedStroke, drawn, [...anchors()]);
    } else if (finishedDrag !== null && dragged !== null) {
      commit(finishedDrag, contour(), dragged);
    }
  };

  const cancelStroke = () => {
    stroke = null;
    timeDrag = null;
    setDraft(null);
    setDraftAnchors(null);
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
    anchors,
    map,
    edited,
    playbackStart,
    setPlaybackStart,
    phonemes,
    moras,
    beginStroke,
    moveStroke,
    beginTimeEdit,
    moveTimeEdit,
    endStroke,
    cancelStroke,
    scale,
    handleWheel,
  };
}
