import { IconButton } from "@components/iconButton";
import type { WaveformSynthesisNotice } from "@layout/bottomPanel/types";
import { usePlaybackControls } from "@layout/bottomPanel/usePlaybackControls";
import { usei18n } from "@contexts/i18n";

export function ControlBar(props: {
  onWaveformSynthesized: (notice: WaveformSynthesisNotice) => void;
}) {
  const { t1 } = usei18n()!;
  const controls = usePlaybackControls(props.onWaveformSynthesized);

  return (
    <div class="w-full h-8 p2 flex m-l-auto flex-row items-center justify-center gap-1 b-b b-slate-3 dark:b-slate-6 select-none">
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
      <div class="flex flex-1 justify-end">
        <IconButton
          icon="i-lucide:list-video"
          label={t1("bottom.play_all_from_selection")}
          onClick={controls.speakAllFromSelection}
          disabled={controls.playableFromSelection().length === 0}
        />
      </div>
    </div>
  );
}
