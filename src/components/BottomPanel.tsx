import { Tabs } from "@kobalte/core";
import { Button } from "@kobalte/core/button";
import { Slider } from "@kobalte/core/slider";
import { debounce } from "@solid-primitives/scheduled";
import _ from "lodash";
// the bottom panel where users do most of their tuning
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { produce, unwrap } from "solid-js/store";
import { AccentPhrase, Mora, commands } from "../binding";
import { useConfigStore } from "../contexts/config";
import { usei18n } from "../contexts/i18n";
import { useTextStore } from "../contexts/text";
import { useUIStore } from "../contexts/ui";
import { getModifiedQuery, useSideEffect } from "../utils";

type DraggingMode = "consonant" | "vowel" | "pause";

function BottomPanel() {
  const { t1 } = usei18n()!;
  return (
    <Tabs.Root
      aria-label="Bottom Panel Tabs"
      class="size-full flex flex-col bg-white border border-slate-2 rounded-lg overflow-hidden outline-none select-none"
      orientation="horizontal"
      defaultValue="accent"
    >
      <ControlBar />
      <div class="absolute">
        <Tabs.List class="w-full flex flex-row items-center relative p-1 outline-none select-none">
          <Tabs.Trigger
            class="bg-transparent hover:bg-slate-1 px-2 rounded-md outline-none select-none"
            value="accent"
          >
            {t1("main_page.bottom.accent")}
          </Tabs.Trigger>
          <Tabs.Trigger
            class="bg-transparent hover:bg-slate-1 px-2 rounded-md outline-none select-none"
            value="tuning"
          >
            {t1("main_page.bottom.tuning")}
          </Tabs.Trigger>
          <Tabs.Indicator class="bg-blue-5 h-1px absolute transition-all bottom-0 left-0" />
        </Tabs.List>
      </div>

      <Tabs.Content class="flex-1 size-full" value="accent">
        <PhonemePanel />
      </Tabs.Content>
      <Tabs.Content class="flex-1 size-full" value="tuning">
        <TuningPanel />
      </Tabs.Content>
    </Tabs.Root>
  );
}

function ControlBar() {
  const { textStore, projectPresetStore } = useTextStore()!;
  const { uiStore, setUIStore } = useUIStore()!;

  const currentText = () => textStore[uiStore.selectedTextBlockIndex];
  const nowPlayable = () => {
    const currentQuery = currentText().query;
    if (currentQuery === null) return false;
    if (currentQuery.accent_phrases.length === 0) return false;
    return true;
  };

  const prevExists = createMemo(
    () => uiStore.selectedTextBlockIndex > 0 && textStore.length > 1,
  );

  const nextExists = createMemo(
    () =>
      uiStore.selectedTextBlockIndex < textStore.length - 1 &&
      textStore.length > 1,
  );

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

  const currentPreset = createMemo(() => {
    if (projectPresetStore.length === 0 || currentText().preset_id === null) {
      return null;
    }
    return projectPresetStore[currentText().preset_id ?? 0];
  });

  const speak = () => {
    const _currentPreset = unwrap(currentPreset());
    if (_currentPreset == null) return;
    commands.playAudio(
      getModifiedQuery(unwrap(currentText().query!), _currentPreset),
      _currentPreset.style_id,
    );
  };

  return (
    <div class="w-full h-8 p2 flex m-l-auto flex-row items-center justify-center gap-1 b-b b-slate-3 select-none">
      <div class="flex-1" />
      <Button
        class="group h-5 w-5 bg-transparent rounded-md ui-disabled:(cursor-not-allowed opacity-50)"
        onClick={focusPrev}
        disabled={!prevExists()}
      >
        <div class="i-lucide:skip-back size-full group-hover:bg-blue-5 group-active:bg-blue-6" />
      </Button>
      <Button
        class="group h-6 w-6 bg-transparent rounded-md ui-disabled:(cursor-not-allowed opacity-50)"
        onClick={speak}
        disabled={!nowPlayable()}
      >
        <div class="i-lucide:play size-full group-hover:bg-blue-5 group-active:bg-blue-6" />
      </Button>
      <Button
        class="group h-5 w-5 bg-transparent rounded-md ui-disabled:(cursor-not-allowed opacity-50)"
        onClick={focusNext}
        disabled={!nextExists()}
      >
        <div class="i-lucide:skip-forward size-full group-hover:bg-blue-5 group-active:bg-blue-6" />
      </Button>
      <div class="flex-1" />
    </div>
  );
}

function TuningPanel() {
  const { textStore, setTextStore, projectPresetStore } = useTextStore()!;
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
  const selectedIdx = () => uiStore.selectedTextBlockIndex;

  const nowPlayable = () => {
    const currentQuery = currentText().query;
    if (currentQuery === null) return false;
    if (currentQuery.accent_phrases.length === 0) return false;
    return true;
  };

  const currentPreset = createMemo(() => {
    if (projectPresetStore.length === 0 || currentText().preset_id === null) {
      return null;
    }
    return projectPresetStore[currentText().preset_id ?? 0];
  });

  const computedRange = createMemo(() => {
    const RELAX_RATIO = 0.3; // to give some room for user adjustments
    const id = currentPreset()?.style_id;
    const r = range();
    if (id === undefined || r === null) return [0, 0];
    let [min, max] = r[id] ?? [0, 0];
    const relax = (max - min) * RELAX_RATIO;
    min = _.clamp(min - relax, 0, 6.5);
    max = _.clamp(max + relax, 0, 6.5);
    return [min, max];
  });

  const minPitch = createMemo(() => computedRange()[0]);
  const maxPitch = createMemo(() => computedRange()[1]);

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

  onMount(() => {
    if (scrollAreaRef) {
      scrollAreaRef.scroll({
        left: uiStore.bottom_scroll_pos,
      });
    }
  });

  onCleanup(() => {
    if (scrollAreaRef) {
      setUIStore("bottom_scroll_pos", scrollAreaRef.scrollLeft);
    }
  });

  return (
    <>
      <div
        ref={scrollAreaRef}
        onWheel={handleWheel}
        class="size-full relative flex flex-col left-0 top-0 overflow-x-auto overflow-y-hidden cursor-default"
        classList={{
          "!overflow-x-hidden !cursor-ew-resize": draggingData() !== null,
        }}
      >
        <Show
          when={nowPlayable()}
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
      <div class="h-6 w-full b-dashed b-slate-3 flex items-center px-2 justify-between">
        <Show when={nowPlayable()}>
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
    </>
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

// the panel for phoneme-level editing
// including editing phoneme text(insert/delete/mutate)
// and combining/splitting accent phrases
function PhonemePanel() {
  const { textStore, setTextStore, projectPresetStore } = useTextStore()!;
  const { uiStore } = useUIStore()!;

  const currentText = () => textStore[uiStore.selectedTextBlockIndex];
  const currentPreset = createMemo(() => {
    if (textStore.length === 0 || currentText().preset_id === null) {
      return null;
    }
    return projectPresetStore[currentText().preset_id ?? 0];
  });

  const setPhrase = (index: number, p: AccentPhrase) => {
    setTextStore(
      uiStore.selectedTextBlockIndex,
      "query",
      "accent_phrases",
      index,
      p,
    );
  };

  const refreshMoraData = debounce(async () => {
    const ap = currentText().query?.accent_phrases;
    const p = currentPreset();
    if (!ap || !p) return;
    const new_ap = await commands.replaceMora(ap, p.style_id);
    if (new_ap.status === "ok") {
      setTextStore(
        uiStore.selectedTextBlockIndex,
        "query",
        "accent_phrases",
        new_ap.data,
      );
    }
  }, 300);

  const splitPhrase = useSideEffect((apIndex: number, moraIndex: number) => {
    const aps = currentText().query?.accent_phrases;
    if (aps == null) {
      console.error("No accent phrases to split");
      return;
    }
    // edge case checks
    if (moraIndex <= 0 || moraIndex >= aps[apIndex].moras.length) {
      console.error("Invalid mora index to split");
      return;
    }
    // split the accent phrase
    const left = aps[apIndex].moras.slice(0, moraIndex);
    const right = aps[apIndex].moras.slice(moraIndex);
    // for now we assign 1 to each new phrase's accent
    // TODO: call commands to get better accent positions
    const leftAp = {
      ...aps[apIndex],
      moras: left,
      accent: 1,
      pause_mora: null,
    };
    const rightAp = {
      ...aps[apIndex],
      moras: right,
      accent: 1,
      // right ap will inherit the pause mora
    };
    setTextStore(
      uiStore.selectedTextBlockIndex,
      "query",
      "accent_phrases",
      produce((draft) => {
        draft.splice(apIndex, 1, leftAp, rightAp);
      }),
    );
  }, refreshMoraData);

  const combinePhrase = useSideEffect((apIndex: number) => {
    const aps = currentText().query?.accent_phrases;
    if (aps == null) {
      console.error("No accent phrases to combine");
      return;
    }
    // edge case checks
    if (apIndex < 0 || apIndex >= aps.length - 1) {
      console.error("Invalid accent phrase index to combine");
      return;
    }
    // combine the accent phrases
    const left = aps[apIndex];
    const right = aps[apIndex + 1];
    const combinedAp = {
      ...left,
      moras: left.moras.concat(right.moras),
      // for now we assign 1 to the new phrase's accent
      // TODO: call commands to get better accent positions
      accent: 1,
      pause_mora: right.pause_mora,
    };
    setTextStore(
      uiStore.selectedTextBlockIndex,
      "query",
      "accent_phrases",
      produce((draft) => {
        draft.splice(apIndex, 2, combinedAp);
      }),
    );
  }, refreshMoraData);

  return (
    <div class="size-full relative flex flex-row left-0 top-0 overflow-x-auto overflow-y-hidden cursor-default p-2">
      <For each={currentText().query?.accent_phrases}>
        {(phrase, i) => (
          <AccentPhraseItem
            phrase={phrase}
            setPhrase={(p) => setPhrase(i(), p)}
            refreshMoraData={refreshMoraData}
            onSplit={(moraIndex) => splitPhrase(i(), moraIndex)}
            onCombine={() => combinePhrase(i())}
          />
        )}
      </For>
    </div>
  );
}

function AccentPhraseItem(props: {
  phrase: AccentPhrase;
  setPhrase: (p: AccentPhrase) => void;
  refreshMoraData: () => void;
  onSplit: (index: number) => void;
  onCombine: () => void;
}) {
  const [hovered, setHovered] = createSignal(-1);
  const setAccent = useSideEffect((accent: number) => {
    props.setPhrase({
      ...props.phrase,
      accent: accent,
    });
  }, props.refreshMoraData);
  const [phonemeHovered, setPhonemeHovered] = createSignal(false);
  const [pauseMoraHovered, setPauseMoraHovered] = createSignal(false);

  const togglePauseMora = useSideEffect(() => {
    props.setPhrase({
      ...props.phrase,
      pause_mora:
        props.phrase.pause_mora == null
          ? ({
              text: "、",
              consonant: null,
              consonant_length: null,
              vowel: "pau",
              pitch: 0,
              vowel_length: 0.3, // just a placeholder, will be replaced on refresh
            } as Mora)
          : null,
    });
  }, props.refreshMoraData);
  const [editMode, setEditMode] = createSignal(false);
  // TODO: implement edit mode
  const toggleEditPhonemeMode = useSideEffect(() => {
    setEditMode(!editMode());
  }, props.refreshMoraData);

  return (
    <div class="flex flex-col h-full items-center justify-center">
      <Slider
        class="relative flex flex-col w-full select-none items-center py1 pr12"
        minValue={1}
        maxValue={props.phrase.moras.length}
        step={1}
        value={[props.phrase.accent]}
        onChange={(v) => setAccent(v[0])}
      >
        <div class="w-full flex p1">
          <Slider.Track class="w-full h-2 bg-slate-2 rounded-full relative ui-disabled:cursor-not-allowed">
            <Slider.Fill class="absolute bg-blue-5 rounded-full h-full ui-disabled:bg-blue-2" />
            <Slider.Thumb class="block w-2 h-4 bg-blue-5 ui-disabled:bg-blue-2 rounded-sm -top-1 outline-none">
              <Slider.Input />
            </Slider.Thumb>
          </Slider.Track>
        </div>
      </Slider>
      <div class="flex flex-row">
        <For each={props.phrase.moras}>
          {(mora, i) => {
            const isHigh = (idx: number) => {
              if (props.phrase.accent === 1) {
                return idx === 0;
              }
              return idx >= 1 && idx < props.phrase.accent;
            };
            const high = () => isHigh(i());
            const nextHigh = () => isHigh(i() + 1);
            const lastMora = () => i() === props.phrase.moras.length - 1;
            const strokeDashArray = () => {
              if (hovered() === i()) return "4 2";
              return "0";
            };

            return (
              <div class="flex justify-center items-center flex-row rounded-md">
                <div
                  class="size-8 bg-blue-1 items-center justify-center flex rounded-md cursor-pointer text-sm"
                  classList={{
                    "mt-10": !high(),
                    "mb-10": high(),
                    "b b-blue-3": phonemeHovered(),
                  }}
                  onMouseEnter={() => setPhonemeHovered(true)}
                  onMouseLeave={() => setPhonemeHovered(false)}
                >
                  {mora.text}
                </div>
                <Show
                  when={!lastMora()}
                  fallback={
                    /* Pause mora area, this shouldn't be highlighted when button is hovered */
                    <div
                      class="m-2 w-8 h-full rounded-md flex items-center justify-center hover:(bg-blue-1) cursor-pointer"
                      classList={{
                        "!bg-transparent": pauseMoraHovered(),
                      }}
                      onClick={() => {
                        if (!pauseMoraHovered()) props.onCombine();
                      }}
                    >
                      {/* Pause mora toggle button */}
                      <div
                        class="size-8 items-center justify-center flex rounded-md text-sm"
                        classList={{
                          "bg-transparent text-transparent b-dashed":
                            props.phrase.pause_mora == null,
                          "bg-blue-1 hover:(b b-blue-3)":
                            props.phrase.pause_mora != null,
                          "text-black b b-blue-3": pauseMoraHovered(),
                        }}
                        onMouseEnter={() => setPauseMoraHovered(true)}
                        onMouseLeave={() => setPauseMoraHovered(false)}
                        onClick={togglePauseMora}
                      >
                        {props.phrase.pause_mora?.text}
                      </div>
                    </div>
                  }
                >
                  <div
                    class="bg-transparent w-4 flex items-center justify-center flex hover:bg-blue-1 rounded-md h-24 cursor-pointer"
                    onMouseEnter={() => setHovered(i())}
                    onMouseLeave={() => setHovered(-1)}
                    onClick={() => props.onSplit(i() + 1)}
                  >
                    {/* biome-ignore lint/a11y/noSvgWithoutTitle: <explanation> */}
                    <svg
                      aria-label="Accent connection line"
                      class="top-0 text-blue-3"
                    >
                      <line
                        x1="0"
                        y1={high() ? "56" : "96"}
                        x2="16"
                        y2={nextHigh() ? "56" : "96"}
                        stroke="currentColor"
                        stroke-dasharray={strokeDashArray()}
                        stroke-width="2"
                      />
                    </svg>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

export { BottomPanel };
