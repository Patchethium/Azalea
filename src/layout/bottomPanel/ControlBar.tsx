import { IconButton } from "@components/iconButton";
import { Tooltip } from "@components/tooltip";
import { useConfigStore } from "@contexts/config";
import { PlaybackTimeline } from "@layout/bottomPanel/PlaybackTimeline";
import type { WaveformSynthesisNotice } from "@layout/bottomPanel/types";
import { usePlaybackControls } from "@layout/bottomPanel/usePlaybackControls";
import { useQueryReset } from "@layout/bottomPanel/useQueryReset";
import { usei18n } from "@contexts/i18n";
import { Show } from "solid-js";

export function ControlBar(props: {
  onWaveformSynthesized: (notice: WaveformSynthesisNotice) => void;
}) {
  const { t1 } = usei18n()!;
  const { playbackTimelineEnabled } = useConfigStore()!;
  const controls = usePlaybackControls(props.onWaveformSynthesized);
  const { canReset, resetEdits, resetLabel } = useQueryReset();

  return (
    <div class="w-full flex flex-col b-b b-slate-3 dark:b-slate-6 select-none">
      <div class="h-8 w-full px-2 flex m-l-auto flex-row items-center justify-center gap-1">
        <div class="flex-1" />
        <IconButton
          icon="i-lucide:skip-back"
          label={t1("bottom.previous")}
          size="sm"
          onClick={controls.focusPrev}
          disabled={!controls.prevExists()}
        />
        <IconButton
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
          aria-busy={controls.playRequestPending()}
          onClick={controls.togglePlayback}
          disabled={
            controls.playRequestPending() ||
            (!controls.isPlaying() && !controls.canPlay())
          }
        />
        <IconButton
          icon="i-lucide:skip-forward"
          label={t1("bottom.next")}
          size="sm"
          onClick={() => controls.focusNext()}
          disabled={!controls.nextExists()}
        />
        <div class="flex flex-1 items-center justify-end gap-1">
          <Tooltip content={resetLabel()}>
            <button
              type="button"
              aria-label={resetLabel()}
              onClick={() => void resetEdits()}
              disabled={!canReset()}
              class="size-8 flex items-center justify-center rounded-md bg-transparent outline-none hover:bg-slate-1 focus-visible:(ring-2 ring-primary-2) disabled:(cursor-not-allowed opacity-50) dark:hover:bg-slate-7"
            >
              <div class="i-lucide:rotate-ccw size-4" />
            </button>
          </Tooltip>
          <IconButton
            icon="i-lucide:list-video"
            label={t1("bottom.play_all_from_selection")}
            onClick={controls.speakAllFromSelection}
            disabled={controls.playableFromSelection().length === 0}
          />
        </div>
      </div>
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
