import _ from "lodash";
// the bottom panel where users do most of their tuning
import { For, createMemo, createSignal } from "solid-js";
import { useTextStore } from "../store/text";
import { useUIStore } from "../store/ui";

function BottomPanel() {
  const { textStore, setTextStore } = useTextStore()!;
  const { uiStore } = useUIStore()!;
  const [draggingIdx, setDraggingIdx] = createSignal<number | null>(null);
  const [scale, setScale] = createSignal(360);

  const epsilon = 0.01;

  let scrollAreaRef!: HTMLDivElement;

  const currentText = () => textStore[uiStore.selectedTextBlockIndex];
  const selectedIdx = () => uiStore.selectedTextBlockIndex;

  const durStore = () => {
    const durs: [number, (v: number) => void][] = [];
    currentText().query?.accent_phrases.forEach((ap, i) => {
      ap.moras.forEach((m, j) => {
        if (m.consonant_length != null) {
          durs.push([
            m.consonant_length,
            (v: number) => {
              // I wish there's a better way to do this, but this kinda looks good enough
              // I mean, at least it reminds that you are using `solid-js`.
              setTextStore(
                selectedIdx(),
                "query",
                "accent_phrases",
                i,
                "moras",
                j,
                "consonant_length",
                v,
              );
            },
          ]);
        }
        if (m.vowel_length != null) {
          durs.push([
            m.vowel_length,
            (v) => {
              setTextStore(
                selectedIdx(),
                "query",
                "accent_phrases",
                i,
                "moras",
                j,
                "vowel_length",
                v,
              );
            },
          ]);
        }
      });
      if (ap.pause_mora != null) {
        durs.push([
          ap.pause_mora.vowel_length,
          (v) => {
            setTextStore(
              selectedIdx(),
              "query",
              "accent_phrases",
              i,
              "pause_mora",
              "vowel_length",
              v,
            );
          },
        ]);
      }
    });
    return durs;
  };

  const phonemes = () => {
    const phs: string[] = [];
    currentText().query?.accent_phrases.forEach((ap) => {
      ap.moras.forEach((m) => {
        if (m.consonant != null) {
          phs.push(m.consonant);
        }
        phs.push(m.vowel);
      });
      if (ap.pause_mora != null) {
        phs.push("pau");
      }
    });
    return phs;
  };

  const accumulatedDur = createMemo(() =>
    durStore().reduce((acc: number[], [d, _], i) => {
      if (i === 0) return [d];
      acc.push(d + acc[i - 1]);
      return acc;
    }, []),
  );

  const handleDragStart = (e: MouseEvent) => {
    if (currentText().query == null) return;
    let located = _.sortedIndex(accumulatedDur(), e.offsetX / scale());
    if (located === durStore().length) {
      located = durStore().length - 1;
    }
    setDraggingIdx(located);
    handleDrag(e);
  };

  const handleDrag = (e: MouseEvent) => {
    const dragged = draggingIdx();
    if (dragged == null || e.buttons !== 1) return;
    const x = e.offsetX / scale();
    const offset = dragged === 0 ? 0 : accumulatedDur()[dragged - 1];
    const newDur = x - offset;
    if (newDur > epsilon) {
      const setter = durStore()[dragged][1];
      setter(newDur);
    }
  };

  const handleDragFinish = (_e: MouseEvent) => {
    setDraggingIdx(null);
  };

  const handleWheel = (e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      setScale(scale() - Math.floor(e.deltaY / 10));
    } else if (!e.shiftKey) {
      e.preventDefault();
      scrollAreaRef.scrollLeft += e.deltaY > 0 ? 100 : -100;
    }
  };

  return (
    <div class="p3 wfull hfull flex flex-col gap1">
      <div class="m-none p-none flex flex-row gap2">
        <div class="w-20">Scale: {scale()}</div>
        <input
          class="w-50"
          type="range"
          value={scale()}
          min={100}
          max={1000}
          onInput={(e) => setScale(Number.parseInt(e.target.value))}
        />
      </div>
      <div
        ref={scrollAreaRef}
        class="w-full h-auto relative flex left-0 top-0 overflow-scroll
        border border-dashed border-cyan"
      >
        <div
          class="w-full h-16 flex flex-row select-none overflow-hidden"
          style="min-width: min-content"
          classList={{ "cursor-ew-resize": draggingIdx() !== null }}
          onMouseMove={handleDrag}
          onMouseDown={handleDragStart}
          onMouseUp={handleDragFinish}
          onMouseEnter={handleDragFinish}
          onMouseLeave={handleDragFinish}
          onWheel={handleWheel}
        >
          <For each={durStore()}>
            {(d, i) => (
              <>
                <div
                  class="items-center justify-center flex pointer-events-none"
                  style={{ width: `${d[0] * scale() - 1}px` }}
                >
                  {phonemes()[i()]}
                </div>
                <div class="h-full w-1px bg-blue-8 pointer-events-none" />
              </>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

export { BottomPanel };
