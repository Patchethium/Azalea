import { Button } from "@kobalte/core/button";
import { throttle } from "@solid-primitives/scheduled";
import _, { set } from "lodash";
// the bottom panel where users do most of their tuning
import { For, createMemo, createSignal } from "solid-js";
import { commands } from "../binding";
import { useTextStore } from "../store/text";
import { useUIStore } from "../store/ui";

function BottomPanel() {
  const { textStore, setTextStore } = useTextStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const [draggingIdx, setDraggingIdx] = createSignal<number | null>(null);
  const [scale, setScale] = createSignal(360);
  const [minPitch, setMinPitch] = createSignal(4.7);
  const [maxPitch, setMaxPitch] = createSignal(6.5);

  const epsilon = 0.01;

  let scrollAreaRef!: HTMLDivElement;

  const currentText = () => textStore[uiStore.selectedTextBlockIndex];
  const selectedIdx = () => uiStore.selectedTextBlockIndex;

  const setConsonantLength = (i: number, j: number, v: number) => {
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
  };

  const setVowelLength = (i: number, j: number, v: number) => {
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
  };

  const setPauseLength = (i: number, v: number) => {
    setTextStore(
      selectedIdx(),
      "query",
      "accent_phrases",
      i,
      "pause_mora",
      "vowel_length",
      v,
    );
  };

  const setPitch = (i: number, j: number, v: number) => {
    setTextStore(
      selectedIdx(),
      "query",
      "accent_phrases",
      i,
      "moras",
      j,
      "pitch",
      v,
    );
  };

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
              setConsonantLength(i, j, v);
            },
          ]);
        }
        if (m.vowel_length != null) {
          durs.push([
            m.vowel_length,
            (v) => {
              setVowelLength(i, j, v);
            },
          ]);
        }
      });
      if (ap.pause_mora != null) {
        durs.push([
          ap.pause_mora.vowel_length,
          (v) => {
            setPauseLength(i, v);
          },
        ]);
      }
    });
    return durs;
  });

  const moraDurs = createMemo(() => {
    if (currentText().query == null) return [];
    const durs: number[] = [];
    currentText().query?.accent_phrases.forEach((ap) => {
      ap.moras.forEach((m) => {
        durs.push((m.consonant_length ?? 0) + (m.vowel_length ?? 0));
      });
      if (ap.pause_mora != null) {
        durs.push(ap.pause_mora.vowel_length);
      }
    });
    return durs;
  });

  const pitches = createMemo(() => {
    if (currentText().query == null) return [];
    const pitches: number[] = [];
    currentText().query?.accent_phrases.forEach((ap) => {
      ap.moras.forEach((m) => {
        pitches.push(m.pitch);
      });
      if (ap.pause_mora != null) {
        pitches.push(0); // no pitch for pause
      }
    });
    return pitches;
  });

  const setPitches = createMemo(() => {
    if (currentText().query == null) return [];
    const setters: ((pit: number) => void)[] = [];
    currentText().query?.accent_phrases.forEach((ap, i) => {
      ap.moras.forEach((_, j) => {
        setters.push((pit) => {
          setPitch(i, j, pit);
        });
      });
      if (ap.pause_mora != null) {
        setters.push((_) => {}); // do nothing
      }
    });
    return setters;
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

  const moraMap = createMemo(() => {
    if (currentText().query == null) return [];
    const map: Record<number, number> = {};
    let mora_idx = 0;
    let dur_idx = 0;
    currentText().query?.accent_phrases.forEach((ap) => {
      ap.moras.forEach((m) => {
        if (m.consonant_length != null) {
          map[dur_idx] = mora_idx;
          dur_idx += 1;
        }
        if (m.vowel_length != null) {
          map[dur_idx] = mora_idx;
          dur_idx += 1;
        }
        mora_idx += 1;
      });
      if (ap.pause_mora != null) {
        map[dur_idx] = mora_idx;
        dur_idx += 1;
        mora_idx += 1;
      }
    });
    return map;
  });

  const pitchRatio = createMemo(() =>
    _.map(
      pitches(),
      (pit) => ((pit - minPitch()) / (maxPitch() - minPitch())) * 100,
    ),
  );

  const accumulatedDur = createMemo(() =>
    durStore().reduce((acc: number[], [d, _], i) => {
      if (i === 0) return [d];
      acc.push(d + acc[i - 1]);
      return acc;
    }, []),
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
    // handleDragDur(e);
  };

  const handleDragDur = (e: MouseEvent) => {
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

  const handleDragPit = (e: MouseEvent) => {
    if (currentText().query === undefined) return;
    const y = e.offsetY;
    const totalHeight = (e.target! as HTMLElement).clientHeight;
    const pitch =
      minPitch() +
      ((totalHeight - y) / totalHeight) * (maxPitch() - minPitch());
    const mora_idx = moraMap()[draggingIdx()!];
    const setter = setPitches()[mora_idx];
    setter(pitch);
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

  const focusNext = () => {
    if (uiStore.selectedTextBlockIndex < textStore.length - 1) {
      setUIStore("selectedTextBlockIndex", uiStore.selectedTextBlockIndex + 1);
    }
  };

  const focusPrev = () => {
    if (uiStore.selectedTextBlockIndex > 0) {
      setUIStore("selectedTextBlockIndex", uiStore.selectedTextBlockIndex - 1);
    }
  };

  const speak = () => {
    commands.synthesize(currentText().query!, currentText().styleId!);
  };

  const playable = createMemo(() => {
    return (
      currentText().query != null &&
      currentText().query!.accent_phrases.length > 0
    );
  });

  return (
    <div class="wfull hfull flex flex-col">
      {/* Control bar */}
      <div class="h-8 p2 flex flex-row items-center justify-center gap-1 b-t b-b b-slate-2">
        <Button
          class="group h-5 w-5 bg-transparent rounded-md ui-disabled:cursor-not-allowed"
          onClick={focusPrev}
        >
          <div class="i-lucide:skip-back w-full h-full group-hover:bg-blue-5 group-active:bg-blue-6" />
        </Button>
        <Button
          class="group h-6 w-6 bg-transparent rounded-md ui-disabled:cursor-not-allowed"
          onClick={speak}
          disabled={!playable()}
        >
          <div class="i-lucide:play w-full h-full group-hover:bg-blue-5 group-active:bg-blue-6" />
        </Button>
        <Button
          class="group h-5 w-5 bg-transparent rounded-md ui-disabled:cursor-not-allowed"
          onClick={focusNext}
        >
          <div class="i-lucide:skip-forward w-full h-full group-hover:bg-blue-5 group-active:bg-blue-6" />
        </Button>
      </div>
      <div
        ref={scrollAreaRef}
        class="w-full h-full relative flex flex-col left-0 top-0 overflow-x-auto overflow-y-hidden"
        classList={{ "!overflow-x-hidden": draggingIdx() !== null }}
      >
        {/* Pitch curves */}
        <div
          class="w-full h-70% flex flex-row select-none active:cursor-default"
          style="min-width: min-content"
          onMouseMove={handleDragPit}
          onMouseDown={(e) => {
            handleDragStart(e);
            handleDragPit(e);
          }}
          onMouseUp={handleDragFinish}
          onMouseEnter={handleDragFinish}
          onMouseLeave={handleDragFinish}
          onWheel={handleWheel}
        >
          <For each={pitches()}>
            {(p, i) => (
              <>
                <div class="h-full flex flex-col justify-end pointer-events-none content-empty b-r b-r-slate-4 b-b b-b-slate-2">
                  <div
                    class="h-full b-t b-slate-4 pointer-events-none text-sm flex items-center justify-center"
                    classList={{ "b-none": p < minPitch() }}
                    style={{
                      height: `${pitchRatio()[i()]}%`,
                      width: `${moraDurs()[i()] * scale() - 1}px`,
                    }}
                  >
                    {p.toFixed(2)}
                  </div>
                </div>
              </>
            )}
          </For>
        </div>
        {/* Duration segments */}
        <div
          class="w-full h-30% flex flex-row select-none active:cursor-default"
          style="min-width: min-content"
          classList={{ "!cursor-ew-resize": draggingIdx() !== null }}
          onMouseMove={handleDragDur}
          onMouseDown={(e) => {
            handleDragStart(e);
            handleDragDur(e);
          }}
          onMouseUp={handleDragFinish}
          onMouseEnter={handleDragFinish}
          onMouseLeave={handleDragFinish}
          onWheel={handleWheel}
        >
          <For each={durStore()}>
            {(d, i) => (
              <>
                <div
                  class="items-center justify-center flex pointer-events-none b-r b-r-slate-4 b-b b-b-slate-2"
                  style={{ width: `${d[0] * scale()}px` }}
                >
                  {phonemes()[i()]}
                </div>
              </>
            )}
          </For>
          <div class="w-10 pointer-events-none" />
        </div>
        {/* Leave some space for the scrollbar on WebkitGTK */}
        <div class="h-5" />
      </div>
    </div>
  );
}

export { BottomPanel };
