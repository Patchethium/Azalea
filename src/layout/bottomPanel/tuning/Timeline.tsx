import type { Mora, SpectrogramPreview } from "$binding";
import {
  DEFAULT_BOTTOM_SCALE,
  DEFAULT_PRIMARY_COLOR,
  PRIMARY_COLOR_PATTERN,
  SEMITONE,
} from "$constants";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { Slider } from "@kobalte/core/slider";
import type { DraggingMode } from "@layout/bottomPanel/types";
import _ from "lodash";
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js";
import type { DriftScale, PitchScale } from "./pitchScale";
import styles from "./Timeline.module.css";

const PITCH_BADGE_WIDTH = 32;
const MORA_TEXT_MIN_WIDTH = 17;
const LATIN_CHAR_WIDTH = 9;

export function TuningItem(props: {
  mora: Mora;
  startDraggingDur: (origin: number, mode: DraggingMode) => void;
  setPitch: (pitch: number) => void;
  pitchScale: PitchScale;
  durationHeight: number;
  isPause?: boolean;
  /** Predicted pitch for relative tuning; absolute mapping is used when null. */
  baseline?: number | null;
  driftScale?: DriftScale;
}) {
  const { config, spectrogramPreviewEnabled } = useConfigStore()!;
  const { t2 } = usei18n()!;
  const [pitchMoving, setPitchMoving] = createSignal(false);
  const handlePitchTransition = (event: TransitionEvent) => {
    if (event.propertyName === "bottom")
      setPitchMoving(event.type === "transitionrun");
  };
  const unvoiced = () => props.mora.pitch === 0;
  const whisper = () =>
    props.isPause || (props.pitchScale.max === 0 && props.pitchScale.min === 0);
  const scale = () => config.ui?.bottom_scale ?? DEFAULT_BOTTOM_SCALE;
  const consonantPixels = (): number | null =>
    props.mora.consonant == null
      ? null
      : props.mora.consonant_length! * scale();
  const vowelPixels = () => props.mora.vowel_length * scale();
  const totalPixels = () => (consonantPixels() ?? 0) + vowelPixels();
  const moraLabel = () => (props.isPause ? "" : props.mora.text);
  const consonantLabel = () => props.mora.consonant ?? "";
  const vowelLabel = () => (props.isPause ? "" : props.mora.vowel);
  const drift = (): { scale: DriftScale; baseline: number } | null =>
    props.driftScale !== undefined &&
    props.baseline != null &&
    props.baseline > 0
      ? { scale: props.driftScale, baseline: props.baseline }
      : null;
  // Only pitch edits animate; switching modes, receiving a baseline, or
  // resizing the drift range moves the thumb immediately.
  const [instantPitch, setInstantPitch] = createSignal(false);
  let instantFrame: number | undefined;
  // Compared by value so regenerated phrases with the same mapping still
  // animate their pitch changes.
  const mapping = createMemo(() => {
    const relative = drift();
    return relative === null
      ? "absolute"
      : `${relative.baseline}:${relative.scale.max}`;
  });
  createEffect(
    on(
      mapping,
      () => {
        setInstantPitch(true);
        if (instantFrame !== undefined) cancelAnimationFrame(instantFrame);
        // Wait for the new position to be styled before restoring transitions.
        instantFrame = requestAnimationFrame(() => {
          instantFrame = requestAnimationFrame(() => {
            instantFrame = undefined;
            setInstantPitch(false);
          });
        });
      },
      { defer: true },
    ),
  );
  onCleanup(() => {
    if (instantFrame !== undefined) cancelAnimationFrame(instantFrame);
  });
  const semitones = (relative: { baseline: number }) =>
    (props.mora.pitch - relative.baseline) / SEMITONE;
  const sliderPosition = () => {
    const relative = drift();
    return relative === null
      ? props.pitchScale.toPosition(props.mora.pitch)
      : relative.scale.toPosition(semitones(relative));
  };
  const positionToPitch = (position: number) => {
    const relative = drift();
    return relative === null
      ? props.pitchScale.toPitch(position)
      : relative.baseline + relative.scale.toDrift(position) * SEMITONE;
  };
  const driftText = (relative: { baseline: number }, digits: number) => {
    const value = semitones(relative).toFixed(digits);
    // Avoid "-0.0" when the pitch sits on the prediction.
    return Number(value) > 0 ? `+${value}` : Number(value) < 0 ? value : "0";
  };
  const badgeText = () => {
    const relative = drift();
    return relative === null
      ? props.mora.pitch.toFixed(2)
      : driftText(relative, 1);
  };
  const valueText = () => {
    const relative = drift();
    return relative === null
      ? props.mora.pitch.toFixed(4)
      : t2("bottom.pitch_drift_value", { value: driftText(relative, 2) });
  };
  // In relative mode the fill spans from the prediction to the thumb.
  // Right-clicking a relative slider resets its drift to the prediction.
  const resetDrift = (event: MouseEvent) => {
    const relative = drift();
    if (relative === null) return;
    event.preventDefault();
    if (props.mora.pitch !== relative.baseline)
      props.setPitch(relative.baseline);
  };
  // Kobalte moves the value on any pointer button, so keep the secondary
  // button from reaching it before the context menu resets the drift.
  const stopSecondaryPointer = (event: PointerEvent) => {
    if (event.button !== 0 && drift() !== null) event.stopPropagation();
  };
  const fillStyle = () => {
    if (drift() === null) return undefined;
    const position = sliderPosition() * 100;
    return {
      bottom: `${Math.min(position, 50)}%`,
      top: `${100 - Math.max(position, 50)}%`,
    };
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
            class={`${styles.pitchSlider} flex-1 b-b b-slate-3 dark:b-slate-6 b-dashed overflow-hidden`}
            classList={{ [styles.instantPitch]: instantPitch() }}
            minValue={0}
            maxValue={1}
            step={0.001}
            value={[sliderPosition()]}
            onChange={(value) => props.setPitch(positionToPitch(value[0]))}
            orientation="vertical"
            ref={(element: HTMLDivElement) =>
              element.addEventListener("pointerdown", stopSecondaryPointer, {
                capture: true,
              })
            }
            onContextMenu={resetDrift}
          >
            <Slider.Track class="size-full bg-transparent relative group">
              <Show when={drift() !== null}>
                <div
                  aria-hidden="true"
                  class="pointer-events-none absolute inset-x-0 top-1/2 b-t b-dashed b-slate-3 dark:b-slate-6"
                  data-pitch-baseline
                />
              </Show>
              <Slider.Fill
                class={`${styles.pitchFill} absolute bg-transparent w-full group-hover:!bg-primary-50 dark:group-hover:!bg-primary-9`}
                classList={{ "opacity-60": spectrogramPreviewEnabled() }}
                style={fillStyle()}
              />
              <Slider.Thumb
                aria-label={props.mora.text}
                aria-valuetext={valueText()}
                class={`${styles.pitchThumb} block h-1px w-full bg-slate-4 outline-none group-hover:!bg-primary-5`}
                classList={{ "!bg-primary-5": pitchMoving() }}
                onTransitionRun={handlePitchTransition}
                onTransitionEnd={handlePitchTransition}
                onTransitionCancel={handlePitchTransition}
              >
                <Show when={totalPixels() >= PITCH_BADGE_WIDTH}>
                  <span
                    aria-hidden="true"
                    class="pointer-events-none invisible absolute left-1/2 top-1/2 w-8 -translate-x-1/2 -translate-y-1/2 rounded-md bg-white px-1 text-center text-11px leading-4 tabular-nums group-hover:visible dark:bg-slate-8"
                  >
                    {badgeText()}
                  </span>
                </Show>
                <Slider.Input aria-valuetext={valueText()} />
              </Slider.Thumb>
            </Slider.Track>
          </Slider>
        </Show>
      </Show>
      <div
        class="group relative shrink-0 flex flex-row bg-white dark:bg-slate-8"
        classList={{ "h-full": whisper() }}
        style={{ height: whisper() ? undefined : `${props.durationHeight}px` }}
      >
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center group-hover:invisible">
          <Show when={totalPixels() >= MORA_TEXT_MIN_WIDTH}>{moraLabel()}</Show>
        </div>
        <Show when={consonantPixels() != null}>
          <div
            class="invisible flex items-center justify-center b-dashed b-r b-slate3 group-hover:visible dark:b-slate-6 hover:!bg-primary-50 dark:hover:!bg-primary-9"
            onMouseDown={() =>
              props.startDraggingDur(props.mora.consonant_length!, "consonant")
            }
            style={{ width: `${consonantPixels()}px` }}
          >
            <Show
              when={
                (consonantPixels() ?? 0) >=
                consonantLabel().length * LATIN_CHAR_WIDTH
              }
            >
              {consonantLabel()}
            </Show>
          </div>
        </Show>
        <div
          class="invisible flex items-center justify-center group-hover:visible hover:!bg-primary-50 dark:hover:!bg-primary-9"
          onMouseDown={() =>
            props.startDraggingDur(props.mora.vowel_length, "vowel")
          }
          style={{ width: `${vowelPixels()}px` }}
        >
          <Show when={vowelPixels() >= vowelLabel().length * LATIN_CHAR_WIDTH}>
            {vowelLabel()}
          </Show>
        </div>
      </div>
    </div>
  );
}

export function SpectrogramCanvas(props: {
  preview: SpectrogramPreview;
  width: number;
  durationHeight: number;
  preSilence: number;
  postSilence: number;
  stale: boolean;
}) {
  const { config } = useConfigStore()!;
  let canvasRef!: HTMLCanvasElement;

  createEffect(() => {
    const { values, frameCount, melBins, durationSeconds } = props.preview;
    if (
      frameCount === 0 ||
      melBins === 0 ||
      durationSeconds <= 0 ||
      values.length !== frameCount * melBins
    ) {
      canvasRef.width = 0;
      canvasRef.height = 0;
      return;
    }
    const audibleStart = _.clamp(
      Math.floor((props.preSilence / durationSeconds) * frameCount),
      0,
      frameCount - 1,
    );
    const audibleEnd = _.clamp(
      Math.ceil(
        ((durationSeconds - props.postSilence) / durationSeconds) * frameCount,
      ),
      audibleStart + 1,
      frameCount,
    );
    const visibleFrames = audibleEnd - audibleStart;
    canvasRef.width = visibleFrames;
    canvasRef.height = melBins;

    const context = canvasRef.getContext("2d");
    if (context === null) return;
    const configuredColor = config.ui.primary_color ?? DEFAULT_PRIMARY_COLOR;
    const primaryColor = PRIMARY_COLOR_PATTERN.test(configuredColor)
      ? configuredColor
      : DEFAULT_PRIMARY_COLOR;
    const red = Number.parseInt(primaryColor.slice(1, 3), 16);
    const green = Number.parseInt(primaryColor.slice(3, 5), 16);
    const blue = Number.parseInt(primaryColor.slice(5, 7), 16);
    const pixels = context.createImageData(visibleFrames, melBins);
    for (let y = 0; y < melBins; y++) {
      const sourceBin = melBins - y - 1;
      for (let x = 0; x < visibleFrames; x++) {
        const strength =
          values[sourceBin * frameCount + audibleStart + x] / 255;
        const pixel = (y * visibleFrames + x) * 4;
        pixels.data[pixel] = red;
        pixels.data[pixel + 1] = green;
        pixels.data[pixel + 2] = blue;
        pixels.data[pixel + 3] = Math.round(
          Math.max(0, strength - 0.08) ** 1.35 * 105,
        );
      }
    }
    context.putImageData(pixels, 0, 0);
  });

  return (
    <canvas
      ref={(element) => {
        canvasRef = element;
      }}
      class="absolute left-0 top-0 pointer-events-none"
      classList={{ "opacity-55": props.stale }}
      style={{
        width: `${props.width}px`,
        height: `calc(100% - ${props.durationHeight}px)`,
        filter: props.stale ? "grayscale(1)" : undefined,
      }}
    />
  );
}
