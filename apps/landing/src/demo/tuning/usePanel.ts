// Pruned from src/layout/bottomPanel/tuning/usePanel.ts. Edits stay in memory;
// project stores, native commands, synthesis jobs, and caching are removed.
import { createMemo, createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { sampleQuery } from "../sample";
import type { DraggingMode } from "../types";

export function useTuningPanel() {
  const [query, setQuery] = createStore(sampleQuery());
  const [scale, setScaleValue] = createSignal(360);
  const minScale = 100;
  const maxScale = 1500;
  const setScale = (value: number) =>
    setScaleValue(Math.min(maxScale, Math.max(minScale, Math.floor(value))));
  let scrollAreaRef: HTMLDivElement | undefined;
  const currentText = createMemo(() => ({ query }));
  const [draggingData, setDraggingData] = createSignal<{
    apIndex: number;
    moraIndex: number;
    originData: number;
    mode: DraggingMode;
  } | null>(null);
  const [dragStartX, setStartX] = createSignal<number | null>(null);

  const setDuration = (
    i: number,
    j: number,
    mode: DraggingMode,
    value: number,
  ) => {
    const length = Math.max(mode === "pause" ? 0 : 0.01, value);
    if (mode === "pause")
      setQuery("accent_phrases", i, "pause_mora", "vowel_length", length);
    else
      setQuery(
        "accent_phrases",
        i,
        "moras",
        j,
        mode === "consonant" ? "consonant_length" : "vowel_length",
        length,
      );
  };
  const setPauseLength = (i: number, value: number) =>
    setDuration(i, -1, "pause", value);
  const setPitch = (i: number, j: number, value: number) => {
    setQuery(
      "accent_phrases",
      i,
      "moras",
      j,
      "pitch",
      Math.min(6.2, Math.max(4.5, value)),
    );
  };
  const handleDragFinish = () => {
    setDraggingData(null);
    setStartX(null);
  };
  const handleDragging = (event: MouseEvent) => {
    const dragging = draggingData();
    const startX = dragStartX();
    if (dragging === null || startX === null) return;
    setDuration(
      dragging.apIndex,
      dragging.moraIndex,
      dragging.mode,
      dragging.originData + (event.clientX - startX) / scale(),
    );
  };
  const handleWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setScale(scale() + (event.deltaY > 0 ? -50 : 50));
  };
  const reset = () => {
    handleDragFinish();
    setQuery(reconcile(sampleQuery()));
    setScale(360);
    if (scrollAreaRef) scrollAreaRef.scrollLeft = 0;
  };

  return {
    currentText,
    queryExists: () => true,
    minPitch: () => 4.5,
    maxPitch: () => 6.2,
    scale,
    setScale,
    minScale,
    maxScale,
    setScrollAreaRef: (element: HTMLDivElement) => {
      scrollAreaRef = element;
    },
    handleScroll: () => {},
    draggingData,
    setDraggingData,
    setStartX,
    setPitch,
    setDuration,
    setPauseLength,
    handleDragFinish,
    handleDragging,
    handleWheel,
    reset,
  };
}
