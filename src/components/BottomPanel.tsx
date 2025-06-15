import { Button } from "@kobalte/core/button";
import { Slider } from "@kobalte/core/slider";
import _ from "lodash";
import path from "path-browserify";
// the bottom panel where users do most of their tuning
import {
  For,
  Show,
  Suspense,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { unwrap } from "solid-js/store";
import { VList } from "virtua/solid";
import { Mora, commands } from "../binding";
import { useConfigStore } from "../contexts/config";
import { usei18n } from "../contexts/i18n";
import { useTextStore } from "../contexts/text";
import { useUIStore } from "../contexts/ui";
import { getModifiedQuery } from "../utils";

type DraggingMode = "consonant" | "vowel" | "pause";

function BottomPanel() {
  const { textStore, setTextStore, projectPresetStore, projectPath } =
    useTextStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;
  const { range } = useConfigStore()!;

  const scale = () => config.ui_config?.bottom_scale ?? 360;
  const setScale = (s: number) => {
    setConfig("ui_config", "bottom_scale", Math.floor(s));
  };

  const epsilon = 0.01;
  const minScale = 100;
  const maxScale = 1500;

  let scrollAreaRef!: HTMLDivElement;

  const currentText = () => textStore[uiStore.selectedTextBlockIndex];
  const queryExists = () => {
    const currentQuery = currentText().query;
    if (currentQuery === null) return false;
    if (currentQuery.accent_phrases.length === 0) return false;
    return true;
  };
  const selectedIdx = () => uiStore.selectedTextBlockIndex;
  const currentPreset = createMemo(() => {
    if (
      projectPresetStore.length === 0 ||
      currentText().preset_id === null
    ) {
      return null;
    }
    return projectPresetStore[currentText().preset_id ?? 0];
  });

  const computedRange = createMemo(() => {
    const id = currentPreset()?.style_id;
    const r = range();
    if (id === undefined || r === null) return [0, 0];
    const [mean, std] = r[id];
    if (mean === 0 && std === 0) return [0, 0];
    let low = mean - 3 * std;
    let high = mean + 3 * std;
    low = Math.log(low);
    high = Math.log(high);
    return [low, high];
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
    const _currentPreset = unwrap(currentPreset());
    if (_currentPreset == null) return;
    commands.playAudio(
      getModifiedQuery(unwrap(currentText().query!), _currentPreset),
      _currentPreset.style_id,
    );
  };

  const prevExists = createMemo(
    () => uiStore.selectedTextBlockIndex > 0 && textStore.length > 1,
  );

  const nextExists = createMemo(
    () =>
      uiStore.selectedTextBlockIndex < textStore.length - 1 &&
      textStore.length > 1,
  );

  onMount(() => {
    if (scrollAreaRef !== null) {
      scrollAreaRef.scroll({
        left: uiStore.bottom_scroll_pos,
      });
    }
  });

  onCleanup(() => {
    if (scrollAreaRef !== null) {
      setUIStore("bottom_scroll_pos", scrollAreaRef.scrollLeft);
    }
  });

  return (
    <div class="size-full flex flex-col bg-white border border-slate-2 rounded-b-lg">
      {/* Control bar */}
      <div class="h-8 p2 flex flex-row items-center justify-center gap-1 b-dashed b-b b-slate-3 select-none">
        <div class="flex-1" />
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
          disabled={!queryExists()}
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
        class="size-full relative flex flex-col left-0 top-0 overflow-x-auto overflow-y-hidden cursor-default"
        classList={{
          "!overflow-x-hidden !cursor-ew-resize": draggingData() !== null,
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
            <For each={currentText().query?.accent_phrases}>
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
                      isPause={true}
                    />
                  </Show>
                </>
              )}
            </For>
          </div>
        </Show>
      </div>
      <div class="h-6 w-full b-dashed b-t b-slate-3 flex items-center px-2 justify-between">
        <div class="text-xs text-slate-6">
          {path.basename(projectPath() ?? "No project")}
        </div>
        <Show when={queryExists()}>
          <Slider
            class="relative flex flex-col w-20% select-none items-center group"
            minValue={minScale}
            maxValue={maxScale}
            value={[scale()]}
            onChange={(v) => setScale(v[0])}
          >
            <Slider.Track class="w-full h-2 bg-slate-2 rounded-full relative">
              <Slider.Fill class="absolute bg-slate-3 rounded-full h-full group-hover:bg-blue-5" />
              <Slider.Thumb class="block size-4 bg-transparent rounded-full -top-1 outline-none">
                <Slider.Input />
              </Slider.Thumb>
            </Slider.Track>
          </Slider>
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
  const [durHovered, setDurHovered] = createSignal(false);
  return (
    <div
      class="flex flex-col b-dashed b-r b-slate-3 h-100% select-none"
      style={{
        width: `${Math.ceil(totalPixels())}px`,
      }}
    >
      {/* Pitch */}
      <Show when={!whisper()}>
        <Show
          when={!unvoiced()}
          fallback={<div class="flex-1 content-empty b-dashed b-b b-slate-3" />}
        >
          <Slider
            class="flex-1 b-b b-slate-3 b-dashed overflow-hidden"
            minValue={props.minPitch}
            maxValue={props.maxPitch}
            step={0.01}
            value={[props.mora.pitch]}
            onChange={(v) => props.setPitch(v[0])}
            orientation="vertical"
          >
            <Slider.Track class="size-full bg-transparent relative group">
              <Slider.Fill class="absolute bg-transparent w-full group-hover:!bg-blue-50" />
              <Slider.Thumb class="block h-1px w-full bg-slate-4 outline-none group-hover:!bg-blue-5">
                <Slider.Input />
              </Slider.Thumb>
            </Slider.Track>
          </Slider>
        </Show>
      </Show>
      {/* Duration */}
      <div
        class="flex flex-row bg-white"
        onMouseEnter={() => {
          setDurHovered(true);
        }}
        onMouseLeave={() => {
          setDurHovered(false);
        }}
        classList={{
          "h-full": whisper(),
          "h-12": !whisper(),
        }}
      >
        <Show
          when={durHovered()}
          fallback={
            <div class="flex size-full items-center justify-center">
              {props.isPause ? "" : props.mora.text}
            </div>
          }
        >
          <Show when={consonantPixels() != null}>
            <div
              class="flex items-center justify-center b-dashed b-r b-slate3 hover:!bg-blue-50"
              onMouseDown={() =>
                props.startDraggingDur(
                  props.mora.consonant_length!,
                  "consonant",
                )
              }
              style={{ width: `${consonantPixels()}px` }}
            >
              {props.mora.consonant}
            </div>
          </Show>
          <div
            class="flex items-center justify-center hover:!bg-blue-50"
            onMouseDown={() =>
              props.startDraggingDur(props.mora.vowel_length, "vowel")
            }
            style={{ width: `${vowelPixels()}px` }}
          >
            {props.isPause ? "" : props.mora.vowel}
          </div>
        </Show>
      </div>
    </div>
  );
}

export { BottomPanel };
