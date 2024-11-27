import { Button } from "@kobalte/core/button";
import _ from "lodash";
// the bottom panel where users do most of their tuning
import { For, Show, createMemo, createSignal } from "solid-js";
import { Mora, commands } from "../binding";
import { useConfigStore } from "../store/config";
import { useSystemStore } from "../store/system";
import { useTextStore } from "../store/text";
import { useUIStore } from "../store/ui";
import { usei18n } from "../store/i18n";

type DraggingMode = "consonant" | "vowel" | "pause";

function BottomPanel() {
  const { textStore, setTextStore } = useTextStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const { systemStore } = useSystemStore()!;
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;
  const { range } = useConfigStore()!;

  const scale = () => config.ui_config?.bottom_scale ?? 360;
  const setScale = (s: number) => {
    setConfig("ui_config", "bottom_scale", Math.floor(s));
  };

  const epsilon = 0.01;
  const maxScale = 1500;

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

  const minPitch = createMemo(() => Math.max(computedRange()[0], 0.0));
  const maxPitch = createMemo(() => Math.min(computedRange()[1], 6.5));

  const [draggingData, setDraggingData] = createSignal<{
    apIndex: number;
    moraIndex: number;
    originData: number;
    mode: DraggingMode;
  } | null>(null);

  const [dragStartX, setStartX] = createSignal<number | null>(null);

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

  const handleDragFinish = (_e: MouseEvent) => {
    setDraggingData(null);
    setStartX(null);
  };

  const handleDragging = (e: MouseEvent) => {
    if (draggingData() === null || dragStartX() === null) return;
    const dx = e.clientX - dragStartX()!;
    switch (draggingData()!.mode) {
      case "consonant": {
        const newDur = Math.max(
          epsilon,
          draggingData()!.originData + dx / scale(),
        );
        setConsonantLength(
          draggingData()!.apIndex,
          draggingData()!.moraIndex,
          newDur,
        );
        break;
      }
      case "vowel": {
        const newDur = Math.max(
          epsilon,
          draggingData()!.originData + dx / scale(),
        );
        setVowelLength(
          draggingData()!.apIndex,
          draggingData()!.moraIndex,
          newDur,
        );
        break;
      }
      case "pause": {
        const newDur = Math.max(0, draggingData()!.originData + dx / scale());
        setPauseLength(draggingData()!.apIndex, newDur);
        break;
      }
    }
  };

  const handleWheel = (e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      let newScale = scale() + (e.deltaY > 0 ? -50 : 50);
      newScale = Math.max(100, newScale);
      newScale = Math.min(maxScale, newScale);
      setScale(newScale);
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
      const x = e.offsetX;
      const width = (e.currentTarget as HTMLElement).clientWidth;
      const newScale = (x / width) * maxScale;
      if (newScale > 100 && newScale < maxScale) setScale(newScale);
    }
  };

  return (
    <div class="size-full flex flex-col bg-white border border-slate-2 rounded-lg">
      {/* Control bar */}
      <div class="h-8 p2 flex flex-row items-center justify-center gap-1 b-b b-slate-2 select-none">
        <div class="flex-1">
          {/* Scale  */}
          <Show when={queryExists()}>
            <div
              class="w-25% h-6 bg-transparent flex items-center justify-center active:cursor-ew-resize"
              onMouseDown={() => setScalebarDragging(true)}
              onMouseUp={() => setScalebarDragging(false)}
              onMouseLeave={() => setScalebarDragging(false)}
              onMouseMove={handleScalebarDrag}
            >
              <div class="bg-slate-3 h-1 w-full pointer-events-none">
                <div
                  class="bg-blue-5 size-full pointer-events-none"
                  style={{ width: `${(scale() / maxScale) * 100}%` }}
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
          <div class="i-lucide:skip-back size-full group-hover:bg-blue-5 group-active:bg-blue-6" />
        </Button>
        <Button
          class="group h-6 w-6 bg-transparent rounded-md ui-disabled:cursor-not-allowed"
          onClick={speak}
          disabled={!playable()}
        >
          <div class="i-lucide:play size-full group-hover:bg-blue-5 group-active:bg-blue-6" />
        </Button>
        <Button
          class="group h-5 w-5 bg-transparent rounded-md ui-disabled:cursor-not-allowed"
          onClick={focusNext}
          disabled={!nextExists()}
        >
          <div class="i-lucide:skip-forward size-full group-hover:bg-blue-5 group-active:bg-blue-6" />
        </Button>
        <div class="flex-1" />
      </div>
      <div
        ref={scrollAreaRef}
        onWheel={handleWheel}
        class="size-full relative flex flex-col left-0 top-0 overflow-x-auto overflow-y-hidden"
        classList={{
          "!overflow-x-hidden": draggingData() !== null,
          "cursor-ew-resize": draggingData() !== null,
        }}
      >
        <Show
          when={queryExists()}
          fallback={
            <div class="flex size-full items-center justify-center select-none cursor-default">
              {t1("main_page.bottom.no_query")}
            </div>
          }
        >
          <div
            class="flex flex-row flex-1"
            onMouseDown={(e) => {
              setStartX(e.clientX);
            }}
            onMouseUp={handleDragFinish}
            onMouseLeave={handleDragFinish}
            onMouseMove={handleDragging}
            style={{ "min-width": "min-content" }}
          >
            <For each={currentText().query!.accent_phrases}>
              {(ap, i) => (
                <>
                  <For each={ap.moras}>
                    {(m, j) => (
                      <TuningItems
                        mora={m}
                        startDraggingDur={(
                          origin: number,
                          mode: DraggingMode,
                        ) => {
                          setDraggingData({
                            apIndex: i(),
                            moraIndex: j(),
                            originData: origin,
                            mode,
                          });
                        }}
                        setPitch={(pitch) => {
                          if (draggingData() == null) setPitch(i(), j(), pitch);
                        }}
                        minPitch={minPitch()}
                        maxPitch={maxPitch()}
                      />
                    )}
                  </For>
                  <Show when={ap.pause_mora != null}>
                    <TuningItems
                      mora={ap.pause_mora!}
                      startDraggingDur={(origin, _mode) => {
                        setDraggingData({
                          apIndex: i(),
                          moraIndex: -1,
                          originData: origin,
                          mode: "pause",
                        });
                      }}
                      setPitch={(pitch) => setPauseLength(i(), pitch)}
                      minPitch={0}
                      maxPitch={0}
                    />
                  </Show>
                </>
              )}
            </For>
          </div>
        </Show>
        {/* Leave some space for the scrollbar on WebkitGTK */}
        <Show when={systemStore.os === "Linux"}>
          <div class="h-5" />
        </Show>
      </div>
    </div>
  );
}

function TuningItems(props: {
  mora: Mora;
  startDraggingDur: (origin: number, mode: DraggingMode) => void;
  setPitch: (pitch: number) => void;
  minPitch: number;
  maxPitch: number;
  isPause?: boolean;
}) {
  const { config } = useConfigStore()!;
  const unvoiced = () => props.mora.pitch === 0;
  const whisper = () => props.maxPitch === 0 && props.minPitch === 0;
  const scale = () => config.ui_config?.bottom_scale ?? 360;

  const consonantPixels = (): number | null => {
    if (props.mora.consonant == null) {
      return null;
    }
    return props.mora.consonant_length! * scale();
  };
  const vowelPixels = (): number => props.mora.vowel_length! * scale();
  const totalPixels = (): number => (consonantPixels() ?? 0) + vowelPixels();

  const pitchRatio = () => {
    return (
      (1 -
        (props.mora.pitch - props.minPitch) /
          (props.maxPitch - props.minPitch)) *
      100
    );
  };

  const [dragging, setDragging] = createSignal(false);

  const handleDraggingStart = (e: MouseEvent) => {
    if (e.buttons !== 1) return;
    setDragging(true);
    handleDraggingPitch(e);
  };

  const handleDraggingPitch = (e: MouseEvent) => {
    if (dragging()) {
      const y = e.offsetY;
      const height = (e.currentTarget as HTMLDivElement).clientHeight;
      const newPitch =
        props.minPitch + (1 - y / height) * (props.maxPitch - props.minPitch);
      props.setPitch(newPitch);
    }
  };

  return (
    <div
      class="flex flex-col b-r b-slate-3 h-100% select-none"
      style={{
        width: `${Math.ceil(totalPixels())}px`,
      }}
    >
      {/* Pitch */}
      <Show when={!whisper()}>
        <Show
          when={!unvoiced()}
          fallback={<div class="flex-1 content-empty b-b b-slate3" />}
        >
          <div
            class="b-b b-slate3 flex flex-1 flex-col items-center justify-start"
            classList={{ "cursor-ns-resize": dragging() }}
            onMouseDown={handleDraggingStart}
            onMouseEnter={handleDraggingStart}
            onMouseUp={() => setDragging(false)}
            onMouseLeave={() => setDragging(false)}
            onMouseMove={handleDraggingPitch}
          >
            <div
              class="b-b b-slate-3 w-full pointer-events-none"
              style={{ height: `${pitchRatio()}%` }}
            />
          </div>
        </Show>
      </Show>
      {/* Duration */}
      <div
        class="flex flex-row b-b b-slate-3 bg-white"
        classList={{ "h-full": whisper(), "h-12": !whisper() }}
      >
        <Show when={consonantPixels() != null}>
          <div
            class="flex items-center justify-center b-r b-slate3"
            onMouseDown={() =>
              props.startDraggingDur(props.mora.consonant_length!, "consonant")
            }
            style={{ width: `${consonantPixels()}px` }}
          >
            {props.mora.consonant}
          </div>
        </Show>
        <div
          class="flex items-center justify-center"
          onMouseDown={() =>
            props.startDraggingDur(props.mora.vowel_length, "vowel")
          }
          style={{ width: `${vowelPixels()}px` }}
        >
          {props.mora.vowel}
        </div>
      </div>
    </div>
  );
}

export { BottomPanel };
