import { Tooltip } from "@components/tooltip";
import { useConfigStore } from "@contexts/config";
import { useTextStore } from "@contexts/text";
import { useUIStore } from "@contexts/ui";
import { NumberField } from "@kobalte/core/number-field";
import { PlaybackTimeline } from "@layout/bottomPanel/PlaybackTimeline";
import type { WaveformSynthesisNotice } from "@layout/bottomPanel/types";
import { usePlaybackControls } from "@layout/bottomPanel/usePlaybackControls";
import { useQueryReset } from "@layout/bottomPanel/useQueryReset";
import { usei18n } from "@contexts/i18n";
import { Show } from "solid-js";

function ToolbarButton(props: {
  icon: string;
  label: string;
  ariaBusy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip content={props.label}>
      <button
        type="button"
        aria-label={props.label}
        aria-busy={props.ariaBusy}
        onClick={() => props.onClick?.()}
        disabled={props.disabled}
        class="size-8 flex items-center justify-center rounded-md bg-transparent outline-none hover:bg-slate-1 focus-visible:(ring-2 ring-primary-2) disabled:(cursor-not-allowed opacity-50) dark:hover:bg-slate-7"
      >
        <div class={`${props.icon} size-4`} />
      </button>
    </Tooltip>
  );
}

export function ControlBar(props: {
  onWaveformSynthesized: (notice: WaveformSynthesisNotice) => void;
}) {
  const { t1 } = usei18n()!;
  const { config, playbackTimelineEnabled } = useConfigStore()!;
  const { selectedTextBlock, selectedTextBlockIndex, setTextStore } =
    useTextStore()!;
  const { uiStore } = useUIStore()!;
  const controls = usePlaybackControls(props.onWaveformSynthesized);
  const { canReset, resetEdits, resetLabel } = useQueryReset();

  return (
    <div class="w-full flex flex-col b-b b-slate-3 dark:b-slate-6 select-none">
      <div class="h-8 w-full px-2 flex m-l-auto flex-row items-center justify-center">
        <div class="flex-1" />
        <ToolbarButton
          icon="i-lucide:skip-back"
          label={t1("bottom.previous")}
          onClick={controls.focusPrev}
          disabled={!controls.prevExists()}
        />
        <ToolbarButton
          icon={
            controls.playRequestPending()
              ? "i-lucide:loader-circle animate-spin"
              : controls.isPlaying()
                ? "i-lucide:square"
                : "i-lucide:play"
          }
          label={
            controls.playRequestPending()
              ? t1("loading")
              : t1(controls.isPlaying() ? "bottom.stop" : "bottom.play")
          }
          ariaBusy={controls.playRequestPending()}
          onClick={controls.togglePlayback}
          disabled={
            controls.playRequestPending() ||
            (!controls.isPlaying() && !controls.canPlay())
          }
        />
        <ToolbarButton
          icon="i-lucide:skip-forward"
          label={t1("bottom.next")}
          onClick={() => controls.focusNext()}
          disabled={!controls.nextExists()}
        />
        <div class="flex flex-1 items-center justify-end">
          <ToolbarButton
            icon="i-lucide:rotate-ccw"
            label={resetLabel()}
            onClick={() => void resetEdits()}
            disabled={!canReset()}
          />
          <ToolbarButton
            icon="i-lucide:list-video"
            label={t1("bottom.play_all_from_selection")}
            onClick={controls.speakAllFromSelection}
            disabled={controls.playableFromSelection().length === 0}
          />
        </div>
      </div>
      <Show
        when={config.ui.pitch_noise_enabled && uiStore.bottomPanel === "tuning"}
      >
        <NumberField
          minValue={0}
          maxValue={4294967295}
          step={1}
          value={selectedTextBlock()?.pitch_noise_seed}
          onRawValueChange={(seed) => {
            if (Number.isInteger(seed) && seed >= 0 && seed <= 4294967295) {
              setTextStore(selectedTextBlockIndex(), "pitch_noise_seed", seed);
            }
          }}
          format={false}
          class="flex items-center justify-end gap2 px2 py1 text-sm"
        >
          <NumberField.Label>{t1("config.pitch_noise_seed")}</NumberField.Label>
          <NumberField.Input class="h-6 w-28 rounded b b-slate-2 px1 outline-none focus:b-primary-3 dark:(b-slate-6 bg-slate-8)" />
        </NumberField>
      </Show>
      <Show when={playbackTimelineEnabled()}>
        <PlaybackTimeline
          phrases={controls.playbackPhrases()}
          anchorIndex={controls.playbackAnchorIndex()}
          setAnchorIndex={controls.setPlaybackAnchorIndex}
        />
      </Show>
    </div>
  );
}
