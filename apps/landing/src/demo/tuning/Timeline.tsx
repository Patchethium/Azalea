// Adapted from TuningItem in src/layout/bottomPanel/tuning/Timeline.tsx.
import type { Mora, DraggingMode } from "../types";
import { Slider } from "@kobalte/core/slider";
import { Show } from "solid-js";

export function TuningItem(props: {
  mora: Mora;
  scale: number;
  setDuration: (mode: DraggingMode, value: number) => void;
  startDraggingDur: (origin: number, mode: DraggingMode) => void;
  setPitch: (pitch: number) => void;
  minPitch: number;
  maxPitch: number;
  isPause?: boolean;
}) {
  const unvoiced = () => props.mora.pitch === 0;
  const whisper = () => props.maxPitch === 0 && props.minPitch === 0;
  const scale = () => props.scale;
  const consonantPixels = (): number | null =>
    props.mora.consonant == null
      ? null
      : props.mora.consonant_length! * scale();
  const vowelPixels = () => props.mora.vowel_length * scale();
  const totalPixels = () => (consonantPixels() ?? 0) + vowelPixels();

  const adjustDuration = (
    event: KeyboardEvent,
    mode: DraggingMode,
    value: number,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    props.setDuration(
      mode,
      value + (event.key === "ArrowRight" ? 0.01 : -0.01),
    );
  };

  return (
    <div
      class="flex flex-none flex-col b-dashed b-r b-slate-3 dark:b-slate-6 h-100% select-none relative z-1"
      style={{ width: `${totalPixels()}px` }}
    >
      <Show when={!whisper()}>
        <Show
          when={!unvoiced()}
          fallback={
            <div class="flex-1 content-empty b-dashed b-b b-slate-3 dark:b-slate-6" />
          }
        >
          <Slider
            class="flex-1 b-b b-slate-3 dark:b-slate-6 b-dashed overflow-hidden"
            minValue={props.minPitch}
            maxValue={props.maxPitch}
            step={0.01}
            value={[props.mora.pitch]}
            onChange={(value) => props.setPitch(value[0])}
            orientation="vertical"
          >
            <Slider.Track class="size-full bg-transparent relative group">
              <Slider.Fill class="absolute bg-transparent w-full group-hover:!bg-primary-50 dark:group-hover:!bg-primary-9" />
              <Slider.Thumb
                aria-label={`${props.mora.text} pitch`}
                class="block h-1px w-full bg-slate-4 outline-none group-hover:!bg-primary-5 focus-visible:!bg-primary-5"
              >
                <Slider.Input aria-hidden="true" />
              </Slider.Thumb>
            </Slider.Track>
          </Slider>
        </Show>
      </Show>
      <div
        class="group relative flex flex-row bg-white dark:bg-slate-8"
        classList={{ "h-full": whisper(), "h-12": !whisper() }}
      >
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center group-hover:invisible group-focus-within:invisible">
          {props.isPause ? "" : props.mora.text}
        </div>
        <Show when={consonantPixels() != null}>
          <div
            class="opacity-0 flex items-center justify-center b-dashed b-r b-slate3 group-hover:opacity-100 group-focus-within:opacity-100 dark:b-slate-6 hover:!bg-primary-50 dark:hover:!bg-primary-9"
            role="spinbutton"
            tabIndex={0}
            aria-label={`${props.mora.text} consonant duration`}
            aria-valuenow={props.mora.consonant_length ?? 0}
            aria-valuemin={0.01}
            onKeyDown={(event) =>
              adjustDuration(
                event,
                "consonant",
                props.mora.consonant_length ?? 0,
              )
            }
            onMouseDown={() =>
              props.startDraggingDur(props.mora.consonant_length!, "consonant")
            }
            style={{ width: `${consonantPixels()}px` }}
          >
            {props.mora.consonant}
          </div>
        </Show>
        <div
          class="opacity-0 flex items-center justify-center group-hover:opacity-100 group-focus-within:opacity-100 hover:!bg-primary-50 dark:hover:!bg-primary-9"
          role="spinbutton"
          tabIndex={0}
          aria-label={
            props.isPause
              ? "Pause duration"
              : `${props.mora.text} vowel duration`
          }
          aria-valuenow={props.mora.vowel_length}
          aria-valuemin={props.isPause ? 0 : 0.01}
          onKeyDown={(event) =>
            adjustDuration(
              event,
              props.isPause ? "pause" : "vowel",
              props.mora.vowel_length,
            )
          }
          onMouseDown={() =>
            props.startDraggingDur(props.mora.vowel_length, "vowel")
          }
          style={{ width: `${vowelPixels()}px` }}
        >
          {props.isPause ? "" : props.mora.vowel}
        </div>
      </div>
    </div>
  );
}
