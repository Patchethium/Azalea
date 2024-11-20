import { Button } from "@kobalte/core/button";
import _ from "lodash";
// the bottom panel where users do most of their tuning
import { For, Show, createMemo, createSignal } from "solid-js";
import { commands } from "../binding";
import { useConfigStore } from "../store/config";
import { useTextStore } from "../store/text";
import { useUIStore } from "../store/ui";

function BottomPanel() {
  const { textStore, setTextStore } = useTextStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const [draggingIdx, setDraggingIdx] = createSignal<number | null>(null);
  const { range } = useConfigStore()!;

  const scale = () => uiStore.tunableScale;
  const setScale = (v: number) => {
    setUIStore("tunableScale", v);
  };

  const epsilon = 0.01;

  let scrollAreaRef!: HTMLDivElement;

  const currentText = () => textStore[uiStore.selectedTextBlockIndex];
  const queryExists = () =>
    currentText().query !== undefined &&
    currentText().query!.accent_phrases.length > 0;
  const selectedIdx = () => uiStore.selectedTextBlockIndex;

  const computedRange = createMemo(() => {
    const id = currentText().styleId;
    const r = range();
    if (id === undefined || r === null) return [0, 0];
    const [mean, std] = r[id];
    return [mean - 3 * std, mean + 3 * std];
  });

  const minPitch = createMemo(() => computedRange()[0]);
  const maxPitch = createMemo(() => computedRange()[1]);

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

  const durs = createMemo(() => {
    if (currentText().query == null) return [];
    const durs: number[] = [];
    currentText().query?.accent_phrases.forEach((ap) => {
      ap.moras.forEach((m) => {
        if (m.consonant_length != null) {
          durs.push(m.consonant_length);
        }
        if (m.vowel_length != null) {
          durs.push(m.vowel_length);
        }
      });
      if (ap.pause_mora != null) {
        durs.push(ap.pause_mora.vowel_length);
      }
    });
    return durs;
  });

  const setDurs = createMemo(() => {
    if (currentText().query == null) return [];
    const setters: ((dur: number) => void)[] = [];
    currentText().query?.accent_phrases.forEach((ap, i) => {
      ap.moras.forEach((m, j) => {
        if (m.consonant_length != null) {
          setters.push((dur) => {
            setConsonantLength(i, j, dur);
          });
        }
        setters.push((dur) => {
          setVowelLength(i, j, dur);
        });
      });
      if (ap.pause_mora != null) {
        setters.push((dur) => {
          setPauseLength(i, dur);
        });
      }
    });
    return setters;
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
    durs().reduce((acc: number[], d, i) => {
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
    if (located === durs().length) {
      located = durs().length - 1;
    }
    setDraggingIdx(located);
  };

  const handleDragDur = (e: MouseEvent) => {
    const dragged = draggingIdx();
    if (dragged == null || e.buttons !== 1) return;
    const x = e.offsetX / scale();
    const offset = dragged === 0 ? 0 : accumulatedDur()[dragged - 1];
    const newDur = x - offset;
    if (newDur > epsilon) {
      setDurs()[dragged](newDur);
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
    if (setter) setter(pitch);
  };

  const handleDragFinish = (_e: MouseEvent) => {
    setDraggingIdx(null);
  };

  const handleWheel = (e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      let newScale = scale() + (e.deltaY > 0 ? -50 : 50);
      newScale = Math.max(100, newScale);
      newScale = Math.min(2000, newScale);
      setScale(newScale);
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

  const prevExists = createMemo(
    () => uiStore.selectedTextBlockIndex > 0 && textStore.length > 1,
  );

  const nextExists = createMemo(
    () =>
      uiStore.selectedTextBlockIndex < textStore.length - 1 &&
      textStore.length > 1,
  );

  const [scalebarDragging, setScalebarDragging] = createSignal(false);

  const handleScalebarDrag = (e: MouseEvent) => {
    if (scalebarDragging()) {
      console.log("scalebar draging");
      const x = e.offsetX;
      const width = (e.currentTarget as HTMLElement).clientWidth;
      const newScale = (x / width) * 2000;
      if (newScale > 100 && newScale < 2000) setScale(newScale);
    }
  };

  return (
    <div class="wfull hfull flex flex-col bg-white border border-slate-2 rounded-lg">
      {/* Control bar */}
      <div class="h-8 p2 flex flex-row items-center justify-center gap-1 b-b b-slate-2 select-none">
        <div class="flex-1">
          {/* Scale  */}
          <Show when={queryExists()}>
            <div
              class="w-30% h-6 bg-transparent flex items-center justify-center active:cursor-ew-resize"
              onMouseDown={() => setScalebarDragging(true)}
              onMouseUp={() => setScalebarDragging(false)}
              onMouseLeave={() => setScalebarDragging(false)}
              onMouseEnter={(e) => {
                if (e.buttons === 1) setScalebarDragging(true);
              }}
              onMouseMove={handleScalebarDrag}
            >
              <div class="bg-slate-3 h-1 w-full pointer-events-none">
                <div
                  class="bg-blue-5 size-full pointer-events-none"
                  style={{ width: `${scale() / 20}%` }}
                />
              </div>
            </div>
          </Show>
        </div>
        <Button
          class="group h-5 w-5 bg-transparent rounded-md ui-disabled:cursor-not-allowed"
          onClick={focusPrev}
          disabled={!prevExists()}
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
          disabled={!nextExists()}
        >
          <div class="i-lucide:skip-forward w-full h-full group-hover:bg-blue-5 group-active:bg-blue-6" />
        </Button>
        <div class="flex-1" />
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
          <Show when={!(minPitch() === 0 && maxPitch() === 0)}>
            <For each={pitches()}>
              {(p, i) => (
                <>
                  <div
                    class="h-full flex flex-col justify-end pointer-events-none content-empty b-r b-r-slate-4"
                    style={{ width: `${moraDurs()[i()] * scale()}px` }}
                  >
                    <div
                      class="h-full b-t b-slate-4 pointer-events-none text-sm flex items-center justify-center"
                      classList={{ "b-none": p < minPitch() }}
                      style={{
                        height: `${pitchRatio()[i()]}%`,
                      }}
                    >
                      {p.toFixed(2)}
                    </div>
                  </div>
                </>
              )}
            </For>
          </Show>
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
          <For each={durs()}>
            {(d, i) => (
              <>
                <div
                  class="items-center justify-center flex pointer-events-none b-r b-r-slate-4 b-b b-b-slate-2 b-t b-t-slate-2"
                  style={{ width: `${d * scale()}px` }}
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
