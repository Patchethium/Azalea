import { IconButton } from "@components/iconButton";
import { createSignal, onCleanup, Show } from "solid-js";

/** Distance from a scroll container edge, in pixels, that starts auto-scroll. */
const AUTO_SCROLL_EDGE = 40;
/** Maximum auto-scroll speed in pixels per animation frame. */
const AUTO_SCROLL_SPEED = 12;

interface DragState {
  from: number;
  /** Insertion point among the items, in the range `0..=count`. */
  insert: number;
}

interface SortableItem {
  element: HTMLElement;
  index: () => number;
}

export type DropIndicator = "before" | "after";

export interface Sortable {
  /** Registers an item's element; call it from a `ref` callback. */
  registerItem: (element: HTMLElement, index: () => number) => void;
  isDragging: (index: number) => boolean;
  dropIndicator: (index: number) => DropIndicator | null;
  startDrag: (event: PointerEvent, index: number) => void;
}

const findScrollContainer = (element: HTMLElement) => {
  for (
    let current = element.parentElement;
    current !== null;
    current = current.parentElement
  ) {
    const { overflowY } = getComputedStyle(current);
    if (overflowY === "auto" || overflowY === "scroll") return current;
  }
  return null;
};

/**
 * Pointer-driven vertical reordering for a list. Pointer events are used
 * instead of HTML drag-and-drop, which the Tauri webview intercepts for file
 * drops on some platforms.
 */
export function createSortable(options: {
  count: () => number;
  onMove: (from: number, to: number) => void;
}): Sortable {
  const items = new Set<SortableItem>();
  const [drag, setDrag] = createSignal<DragState | null>(null);
  let stopDrag: (() => void) | null = null;
  onCleanup(() => stopDrag?.());

  const sortedItems = () =>
    [...items].sort((left, right) => left.index() - right.index());

  const insertionAt = (clientY: number) =>
    sortedItems().filter(({ element }) => {
      const rect = element.getBoundingClientRect();
      return rect.top + rect.height / 2 < clientY;
    }).length;

  const finalIndex = (state: DragState) =>
    state.insert > state.from ? state.insert - 1 : state.insert;

  const registerItem = (element: HTMLElement, index: () => number) => {
    const item = { element, index };
    items.add(item);
    onCleanup(() => items.delete(item));
  };

  const startDrag = (event: PointerEvent, index: number) => {
    if (event.button !== 0 || stopDrag !== null) return;
    const handle = event.currentTarget as HTMLElement;
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    const scrollContainer = findScrollContainer(handle);
    let clientY = event.clientY;
    let frame: number | null = null;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    setDrag({ from: index, insert: index });

    const updateInsert = () =>
      setDrag((state) =>
        state === null ? null : { ...state, insert: insertionAt(clientY) },
      );
    const autoScroll = () => {
      frame = null;
      if (scrollContainer === null) return;
      const rect = scrollContainer.getBoundingClientRect();
      const distance =
        clientY < rect.top + AUTO_SCROLL_EDGE
          ? clientY - (rect.top + AUTO_SCROLL_EDGE)
          : clientY > rect.bottom - AUTO_SCROLL_EDGE
            ? clientY - (rect.bottom - AUTO_SCROLL_EDGE)
            : 0;
      if (distance === 0) return;
      const step =
        Math.sign(distance) *
        Math.min(AUTO_SCROLL_SPEED, Math.ceil(Math.abs(distance) / 2));
      const previousScrollTop = scrollContainer.scrollTop;
      scrollContainer.scrollTop += step;
      if (scrollContainer.scrollTop === previousScrollTop) return;
      updateInsert();
      frame = requestAnimationFrame(autoScroll);
    };
    const onPointerMove = (moveEvent: PointerEvent) => {
      clientY = moveEvent.clientY;
      updateInsert();
      if (frame === null) frame = requestAnimationFrame(autoScroll);
    };
    const onPointerUp = () => {
      const state = drag();
      stop();
      if (state === null) return;
      const to = finalIndex(state);
      if (to !== state.from) options.onMove(state.from, to);
    };
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      stop();
    };
    const stop = () => {
      stopDrag = null;
      if (frame !== null) cancelAnimationFrame(frame);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", stop);
      handle.removeEventListener("lostpointercapture", stop);
      window.removeEventListener("keydown", onKeyDown, true);
      if (handle.hasPointerCapture?.(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setDrag(null);
    };
    stopDrag = stop;
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", stop);
    handle.addEventListener("lostpointercapture", stop);
    window.addEventListener("keydown", onKeyDown, true);
  };

  const dropIndicator = (index: number): DropIndicator | null => {
    const state = drag();
    if (
      state === null ||
      state.insert === state.from ||
      state.insert === state.from + 1
    ) {
      return null;
    }
    if (state.insert === index) return "before";
    if (state.insert === index + 1 && index === options.count() - 1) {
      return "after";
    }
    return null;
  };

  return {
    registerItem,
    isDragging: (index) => drag()?.from === index,
    dropIndicator,
    startDrag,
  };
}

/**
 * A grip button that starts a drag. With `visible` false it stays transparent
 * unless focused or dragging.
 */
export function SortableHandle(props: {
  sortable: Sortable;
  index: number;
  label: string;
  visible?: boolean;
  class?: string;
}) {
  const hidden = () =>
    props.visible === false && !props.sortable.isDragging(props.index);
  return (
    <IconButton
      icon="i-lucide:grip-vertical"
      size="sm"
      iconSize="sm"
      label={props.label}
      class={`cursor-grab touch-none ${hidden() ? "opacity-0 focus-visible:opacity-100" : ""} ${props.class ?? ""}`}
      onPointerDown={(event) => props.sortable.startDrag(event, props.index)}
      // Keep the handle from activating clickable ancestors such as cards.
      onClick={(event) => event.stopPropagation()}
    />
  );
}

/** The line drawn where a dragged item will land. */
export function SortableDropIndicator(props: {
  sortable: Sortable;
  index: number;
}) {
  return (
    <Show when={props.sortable.dropIndicator(props.index)}>
      {(side) => (
        <div
          aria-hidden="true"
          data-drop-indicator={side()}
          class="pointer-events-none absolute inset-x-0 z-20 h-0.5 rounded-full bg-primary-5"
          classList={{
            "top-0 -translate-y-1/2": side() === "before",
            "bottom-0 translate-y-1/2": side() === "after",
          }}
        />
      )}
    </Show>
  );
}
