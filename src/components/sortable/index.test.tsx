import {
  createSortable,
  type Sortable,
  SortableDropIndicator,
  SortableHandle,
} from "@components/sortable";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, For } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moveItem } from "$utils";

const ITEM_HEIGHT = 30;

const rect = (top: number, height: number) =>
  ({
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 100,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

const renderList = (initial = ["a", "b", "c"]) => {
  const [items, setItems] = createSignal(initial);
  const onMove = vi.fn((from: number, to: number) =>
    setItems((current) => moveItem(current, from, to)),
  );
  let sortable!: Sortable;
  let scroller: HTMLDivElement | undefined;
  render(() => {
    sortable = createSortable({ count: () => items().length, onMove });
    return (
      <div
        ref={(element) => (scroller = element)}
        style={{ "overflow-y": "auto" }}
      >
        <For each={items()}>
          {(item, index) => (
            <div
              ref={(element) => {
                sortable.registerItem(element, index);
                // Lay items out by their current index, offset by scrolling.
                element.getBoundingClientRect = () =>
                  rect(
                    index() * ITEM_HEIGHT - scroller!.scrollTop,
                    ITEM_HEIGHT,
                  );
              }}
              data-testid={`item-${item}`}
              data-dragging={sortable.isDragging(index()) || undefined}
            >
              <SortableDropIndicator sortable={sortable} index={index()} />
              <SortableHandle
                sortable={sortable}
                index={index()}
                label={`Reorder ${item}`}
              />
            </div>
          )}
        </For>
      </div>
    );
  });
  scroller!.getBoundingClientRect = () => rect(0, 3 * ITEM_HEIGHT);
  return { items, onMove, scroller: scroller!, sortable };
};

const handle = (item: string) =>
  screen.getByRole("button", { name: `Reorder ${item}` });

const indicators = () =>
  [...document.querySelectorAll("[data-drop-indicator]")].map((element) => [
    element.closest("[data-testid]")?.getAttribute("data-testid"),
    element.getAttribute("data-drop-indicator"),
  ]);

// jsdom lacks PointerEvent, so testing-library would dispatch plain Events.
class PointerEventStub extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

describe("createSortable", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", PointerEventStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  it("moves an item to where it is dropped and shows the drop line", () => {
    const { items, onMove } = renderList();

    fireEvent.pointerDown(handle("a"), { button: 0, pointerId: 1, clientY: 5 });
    expect(screen.getByTestId("item-a")).toHaveAttribute("data-dragging");
    expect(document.body.style.cursor).toBe("grabbing");
    expect(document.body.style.userSelect).toBe("none");
    // Over its own slot nothing would change, so no line is shown.
    expect(indicators()).toEqual([]);

    fireEvent.pointerMove(handle("a"), { pointerId: 1, clientY: 50 });
    expect(indicators()).toEqual([["item-c", "before"]]);
    fireEvent.pointerMove(handle("a"), { pointerId: 1, clientY: 80 });
    expect(indicators()).toEqual([["item-c", "after"]]);

    fireEvent.pointerUp(handle("a"), { pointerId: 1, clientY: 80 });
    expect(onMove).toHaveBeenCalledWith(0, 2);
    expect(items()).toEqual(["b", "c", "a"]);
    expect(indicators()).toEqual([]);
    expect(screen.getByTestId("item-a")).not.toHaveAttribute("data-dragging");
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    fireEvent.pointerDown(handle("a"), {
      button: 0,
      pointerId: 2,
      clientY: 75,
    });
    fireEvent.pointerMove(handle("a"), { pointerId: 2, clientY: 10 });
    expect(indicators()).toEqual([["item-b", "before"]]);
    fireEvent.pointerUp(handle("a"), { pointerId: 2, clientY: 10 });
    expect(items()).toEqual(["a", "b", "c"]);
  });

  it("ignores drops in place, secondary buttons and nested drags", () => {
    const { onMove } = renderList();

    fireEvent.pointerDown(handle("b"), { button: 2, pointerId: 1 });
    expect(screen.getByTestId("item-b")).not.toHaveAttribute("data-dragging");

    fireEvent.pointerDown(handle("b"), {
      button: 0,
      pointerId: 1,
      clientY: 45,
    });
    fireEvent.pointerDown(handle("c"), {
      button: 0,
      pointerId: 2,
      clientY: 75,
    });
    expect(screen.getByTestId("item-c")).not.toHaveAttribute("data-dragging");
    fireEvent.pointerMove(handle("b"), { pointerId: 1, clientY: 55 });
    fireEvent.pointerUp(handle("b"), { pointerId: 1, clientY: 55 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it.each([
    ["Escape", () => fireEvent.keyDown(window, { key: "Escape" })],
    [
      "pointer cancel",
      (target: HTMLElement) =>
        fireEvent.pointerCancel(target, { pointerId: 1 }),
    ],
    [
      "lost capture",
      (target: HTMLElement) =>
        fireEvent(target, new Event("lostpointercapture")),
    ],
  ])("cancels the drag on %s", (_name, cancel) => {
    const { onMove } = renderList();
    const target = handle("a");

    fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientY: 5 });
    fireEvent.pointerMove(target, { pointerId: 1, clientY: 80 });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(indicators()).toHaveLength(1);
    cancel(target);
    expect(indicators()).toEqual([]);
    expect(document.body.style.cursor).toBe("");

    fireEvent.pointerMove(target, { pointerId: 1, clientY: 80 });
    fireEvent.pointerUp(target, { pointerId: 1, clientY: 80 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("scrolls the list while dragging near its edges", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
    const { scroller } = renderList();
    let scrollTop = 0;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.min(Math.max(value, 0), 60);
      },
    });

    fireEvent.pointerDown(handle("a"), { button: 0, pointerId: 1, clientY: 5 });
    fireEvent.pointerMove(handle("a"), { pointerId: 1, clientY: 89 });
    vi.advanceTimersToNextFrame();
    expect(scrollTop).toBeGreaterThan(0);
    vi.advanceTimersByTime(1_000);
    expect(scrollTop).toBe(60);
    // Scrolled to the end, the pointer is past the last item.
    expect(indicators()).toEqual([["item-c", "after"]]);

    fireEvent.pointerMove(handle("a"), { pointerId: 1, clientY: 1 });
    vi.advanceTimersByTime(1_000);
    expect(scrollTop).toBe(0);

    fireEvent.pointerMove(handle("a"), { pointerId: 1, clientY: 45 });
    vi.advanceTimersByTime(1_000);
    expect(scrollTop).toBe(0);
    fireEvent.pointerUp(handle("a"), { pointerId: 1, clientY: 45 });
  });

  it("hides a handle that is not visible unless it is being dragged", () => {
    const [visible, setVisible] = createSignal(false);
    render(() => {
      const sortable = createSortable({ count: () => 1, onMove: vi.fn() });
      return (
        <SortableHandle
          sortable={sortable}
          index={0}
          label="Reorder a"
          visible={visible()}
        />
      );
    });

    expect(handle("a")).toHaveClass("opacity-0", "focus-visible:opacity-100");
    setVisible(true);
    expect(handle("a")).not.toHaveClass("opacity-0");
    setVisible(false);
    fireEvent.pointerDown(handle("a"), { button: 0, pointerId: 1 });
    expect(handle("a")).not.toHaveClass("opacity-0");
    fireEvent.pointerUp(handle("a"), { pointerId: 1 });
    expect(handle("a")).toHaveClass("opacity-0");
  });

  it("keeps handle clicks from reaching the item", () => {
    const onClick = vi.fn();
    const sortableRef: { current?: Sortable } = {};
    render(() => {
      sortableRef.current = createSortable({ count: () => 1, onMove: vi.fn() });
      return (
        <div onClick={onClick}>
          <SortableHandle
            sortable={sortableRef.current}
            index={0}
            label="Grip"
          />
        </div>
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Grip" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("ends an active drag and its listeners when the list unmounts", () => {
    const removeListener = vi.spyOn(window, "removeEventListener");
    const [items] = createSignal(["a"]);
    const { unmount } = render(() => {
      const sortable = createSortable({
        count: () => items().length,
        onMove: vi.fn(),
      });
      return <SortableHandle sortable={sortable} index={0} label="Reorder a" />;
    });

    fireEvent.pointerDown(handle("a"), { button: 0, pointerId: 1 });
    expect(document.body.style.cursor).toBe("grabbing");
    unmount();
    expect(document.body.style.cursor).toBe("");
    expect(removeListener).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
      true,
    );
  });
});
