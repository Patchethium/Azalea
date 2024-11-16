import _ from "lodash";
// the bottom panel where users do most of their tuning
import { For, createMemo, createSignal } from "solid-js";
import { useTextStore } from "../store/text";
import { useUIStore } from "../store/ui";
import { Button } from "@kobalte/core/button";
import { commands } from "../binding";

function BottomPanel() {
  const { textStore, setTextStore } = useTextStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const [draggingIdx, setDraggingIdx] = createSignal<number | null>(null);
  const [scale, setScale] = createSignal(360);

  const epsilon = 0.01;

  let scrollAreaRef!: HTMLDivElement;

  const currentText = () => textStore[uiStore.selectedTextBlockIndex];
  const selectedIdx = () => uiStore.selectedTextBlockIndex;

  const durStore = createMemo(() => {
    if (currentText().query == null) return [];
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
                v
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
                v
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
              v
            );
          },
        ]);
      }
    });
    return durs;
  });

  const phonemes = () => {
    if (currentText().query == null) return [];
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
    }, [])
  );

  const handleDragStart = (e: MouseEvent) => {
    if (
      currentText().query === undefined ||
      currentText().query?.accent_phrases.length === 0
    ) {
      console.log("no query");
      setDraggingIdx(null);
      return;
    }
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

  const focusNext= () => {
    if (uiStore.selectedTextBlockIndex < textStore.length - 1) {
      setUIStore("selectedTextBlockIndex", uiStore.selectedTextBlockIndex + 1);
    }
  }

  const focusPrev = () => {
    if (uiStore.selectedTextBlockIndex > 0) {
      setUIStore("selectedTextBlockIndex", uiStore.selectedTextBlockIndex - 1);
    }
  }

  const speak = () => {
    commands.synthesize(currentText().query!, currentText().styleId!);
  }

  const playable = createMemo(() => {
    return currentText().query != null && currentText().query!.accent_phrases.length > 0;
  });

  return (
    <div class="wfull hfull flex flex-col">
      {/* Control bar */}
      <div class="h-8 p2 flex flex-row items-center justify-center gap-1 b-t b-slate-2">
        <Button class="group h-5 w-5 bg-transparent rounded-md ui-disabled:cursor-not-allowed" onClick={focusPrev}>
          <div class="i-lucide:skip-back w-full h-full group-hover:bg-blue-5 group-active:bg-blue-6" />
        </Button>
        <Button class="group h-6 w-6 bg-transparent rounded-md ui-disabled:cursor-not-allowed" onClick={speak} disabled={!playable()}>
          <div class="i-lucide:play w-full h-full group-hover:bg-blue-5 group-active:bg-blue-6" />
        </Button>
        <Button class="group h-5 w-5 bg-transparent rounded-md ui-disabled:cursor-not-allowed" onClick={focusNext}>
          <div class="i-lucide:skip-forward w-full h-full group-hover:bg-blue-5 group-active:bg-blue-6" />
        </Button>
      </div>
      <div
        ref={scrollAreaRef}
        class="w-full h-full relative flex left-0 top-0 overflow-scroll"
      >
        <div
          class="w-full h-full flex flex-row select-none active:cursor-default"
          style="min-width: min-content"
          classList={{ "!cursor-ew-resize": draggingIdx() !== null }}
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
                <div class="h-full w-1px bg-slate-4 pointer-events-none" />
              </>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

export { BottomPanel };
